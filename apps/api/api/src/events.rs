use std::{collections::HashMap, convert::Infallible, sync::Arc, time::Duration};

use agentscope_trace::{Artifact, Run, Span};
use axum::{
    extract::{
        ws::{Message, WebSocket},
        Path, State, WebSocketUpgrade,
    },
    response::IntoResponse,
    response::sse::{Event, KeepAlive, Sse},
};
use futures_util::stream;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::{broadcast, RwLock};
use tracing::{debug, warn};
use uuid::Uuid;

use crate::{auth::AuthenticatedUser, ApiError, AppState};

const SPAN_EVENT_BUFFER_SIZE: usize = 1024;
const RUN_EVENT_BUFFER_SIZE: usize = 4096;

#[derive(Debug, Clone, Serialize)]
pub struct SpanEvent {
    #[serde(rename = "type")]
    event_type: &'static str,
    span: Span,
}

impl SpanEvent {
    fn span_created(span: Span) -> Self {
        Self {
            event_type: "span_created",
            span,
        }
    }
}

pub fn span_event_channel() -> broadcast::Sender<SpanEvent> {
    broadcast::channel(SPAN_EVENT_BUFFER_SIZE).0
}

pub fn publish_span_created(sender: &broadcast::Sender<SpanEvent>, span: &Span) {
    let _ = sender.send(SpanEvent::span_created(span.clone()));
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunStreamEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub data: Value,
}

impl RunStreamEvent {
    pub fn new(event_type: impl Into<String>, data: Value) -> Self {
        Self {
            event_type: event_type.into(),
            data,
        }
    }
}

#[derive(Clone, Default)]
pub struct RunEventHub {
    channels: Arc<RwLock<HashMap<String, broadcast::Sender<RunStreamEvent>>>>,
}

impl RunEventHub {
    async fn ensure_sender(&self, run_id: &str) -> broadcast::Sender<RunStreamEvent> {
        if let Some(sender) = self.channels.read().await.get(run_id).cloned() {
            return sender;
        }

        let mut channels = self.channels.write().await;
        channels
            .entry(run_id.to_string())
            .or_insert_with(|| broadcast::channel(RUN_EVENT_BUFFER_SIZE).0)
            .clone()
    }

    pub async fn subscribe(&self, run_id: &str) -> broadcast::Receiver<RunStreamEvent> {
        self.ensure_sender(run_id).await.subscribe()
    }

    pub async fn publish(&self, run_id: &str, event: RunStreamEvent) {
        let sender = self.ensure_sender(run_id).await;
        let _ = sender.send(event);
    }
}

pub async fn publish_event(hub: &RunEventHub, run_id: &str, event: RunStreamEvent) {
    hub.publish(run_id, event).await;
}

pub async fn stream(
    State(state): State<Arc<AppState>>,
) -> Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>> {
    let receiver = state.span_events.subscribe();
    let stream = stream::unfold(receiver, |mut receiver| async move {
        loop {
            match receiver.recv().await {
                Ok(message) => match Event::default().event("span_created").json_data(message) {
                    Ok(event) => return Some((Ok(event), receiver)),
                    Err(error) => {
                        warn!(error = %error, "failed to serialize span event");
                    }
                },
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    warn!(skipped, "span event subscriber lagged behind");
                }
                Err(broadcast::error::RecvError::Closed) => return None,
            }
        }
    });

    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    )
}

pub async fn run_stream(
    ws: WebSocketUpgrade,
    Path(run_id): Path<String>,
    State(state): State<Arc<AppState>>,
    axum::extract::Extension(user): axum::extract::Extension<AuthenticatedUser>,
) -> Result<impl IntoResponse, ApiError> {
    if Uuid::parse_str(&run_id).is_err() {
        return Err(ApiError::Validation("run_id must be a valid UUID".to_string()));
    }

    state
        .storage
        .get_run_for_user(&run_id, &user.id)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("run {run_id} not found")))?;

    Ok(ws.on_upgrade(move |socket| stream_run_socket(socket, state, run_id)))
}

async fn stream_run_socket(socket: WebSocket, state: Arc<AppState>, run_id: String) {
    let mut receiver = state.run_events.subscribe(&run_id).await;
    let initial_run = state.storage.get_run(&run_id).await.ok().flatten();
    let initial_spans = state.storage.get_spans(&run_id).await.unwrap_or_default();
    let initial_artifacts = state.storage.get_artifacts(&run_id).await.unwrap_or_default();

    let logs = initial_artifacts
        .iter()
        .filter(|artifact| artifact.kind == "log")
        .map(log_from_artifact)
        .collect::<Vec<_>>();

    let init_data = match initial_run {
        Some(run) => json!({
            "run": run,
            "spans": initial_spans,
            "artifacts": initial_artifacts,
            "logs": logs,
        }),
        None => json!({
            "run": Value::Null,
            "spans": [],
            "artifacts": [],
            "logs": [],
        }),
    };

    let init_event = RunStreamEvent::new("init", init_data);
    let mut socket = socket;
    if send_ws_event(&mut socket, &init_event).await.is_err() {
        return;
    }

    loop {
        tokio::select! {
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(error)) => {
                        debug!(error = %error, run_id = %run_id, "run stream socket receive error");
                        break;
                    }
                }
            }
            event = receiver.recv() => {
                match event {
                    Ok(message) => {
                        if send_ws_event(&mut socket, &message).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(skipped)) => {
                        warn!(%run_id, skipped, "run stream subscriber lagged behind");
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }
}

async fn send_ws_event(socket: &mut WebSocket, event: &RunStreamEvent) -> Result<(), ()> {
    let payload = serde_json::to_string(event).map_err(|_| ())?;
    socket.send(Message::Text(payload)).await.map_err(|_| ())
}

pub fn log_from_artifact(artifact: &Artifact) -> Value {
    let message = artifact
        .payload
        .get("message")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| artifact.payload.to_string());

    json!({
        "id": artifact.id,
        "run_id": artifact.run_id,
        "span_id": artifact.span_id,
        "level": artifact.payload.get("level").and_then(Value::as_str).unwrap_or("info"),
        "message": message,
        "timestamp": artifact.payload.get("timestamp").cloned().unwrap_or(Value::Null),
        "metadata": artifact.payload.get("metadata").cloned().unwrap_or(Value::Null),
    })
}

pub fn run_completed_event(run: &Run) -> RunStreamEvent {
    RunStreamEvent::new(
        "run_completed",
        json!({
            "event_id": format!("run_completed:{}:{}:{}", run.id, run.status, run.ended_at.map(|value| value.to_rfc3339()).unwrap_or_default()),
            "run": run
        }),
    )
}

pub fn span_lifecycle_event(span: &Span) -> RunStreamEvent {
    let event_type = match span.status.as_str() {
        "running" | "pending" => {
            let has_progress_update = span.latency_ms.is_some()
                || span.input_tokens.is_some()
                || span.output_tokens.is_some()
                || span.total_tokens.is_some()
                || span.tool_latency_ms.is_some()
                || span.metadata.is_some();
            if has_progress_update {
                "span_updated"
            } else {
                "span_started"
            }
        }
        "success" | "completed" | "failed" | "error" | "ok" => "span_completed",
        _ if span.ended_at.is_some() => "span_completed",
        _ => "span_updated",
    };

    let lifecycle_key = if event_type == "span_updated" {
        format!(
            "{}:{}:{}:{}",
            span.status,
            span.total_tokens.unwrap_or_default(),
            span.output_tokens.unwrap_or_default(),
            span.latency_ms.unwrap_or_default()
        )
    } else {
        span.ended_at
            .map(|ended| ended.to_rfc3339())
            .unwrap_or_else(|| span.started_at.to_rfc3339())
    };

    RunStreamEvent::new(
        event_type,
        json!({
            "event_id": format!("{event_type}:{}:{}:{}", span.run_id, span.id, lifecycle_key),
            "span": span
        }),
    )
}

pub fn artifact_created_event(artifact: &Artifact) -> RunStreamEvent {
    RunStreamEvent::new(
        "artifact_created",
        json!({
            "event_id": format!("artifact_created:{}:{}", artifact.run_id, artifact.id),
            "artifact": artifact
        }),
    )
}

pub fn log_event(artifact: &Artifact) -> RunStreamEvent {
    RunStreamEvent::new(
        "log",
        json!({
            "event_id": format!("log:{}:{}", artifact.run_id, artifact.id),
            "log": log_from_artifact(artifact)
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use serde_json::json;

    fn base_span(status: &str) -> Span {
        Span {
            id: "11111111-1111-4111-8111-111111111111".to_string(),
            run_id: "22222222-2222-4222-8222-222222222222".to_string(),
            parent_span_id: None,
            span_type: "llm".to_string(),
            name: "call".to_string(),
            status: status.to_string(),
            started_at: Utc::now(),
            ended_at: None,
            provider: None,
            model: None,
            input_tokens: None,
            output_tokens: None,
            total_tokens: None,
            estimated_cost: None,
            context_window: None,
            context_usage_percent: None,
            latency_ms: None,
            success: None,
            error_type: None,
            error_source: None,
            retryable: None,
            prompt_hash: None,
            prompt_template_id: None,
            temperature: None,
            top_p: None,
            max_tokens: None,
            retry_attempt: None,
            max_attempts: None,
            tool_name: None,
            tool_version: None,
            tool_latency_ms: None,
            tool_success: None,
            evaluation: None,
            metadata: None,
            error: None,
        }
    }

    #[test]
    fn classifies_span_started_without_progress() {
        let span = base_span("running");
        let event = span_lifecycle_event(&span);
        assert_eq!(event.event_type, "span_started");
    }

    #[test]
    fn classifies_span_updated_with_progress() {
        let mut span = base_span("running");
        span.total_tokens = Some(123);
        let event = span_lifecycle_event(&span);
        assert_eq!(event.event_type, "span_updated");
    }

    #[test]
    fn classifies_span_completed_for_done_status() {
        let span = base_span("success");
        let event = span_lifecycle_event(&span);
        assert_eq!(event.event_type, "span_completed");
    }

    #[test]
    fn maps_log_artifact_to_log_payload() {
        let artifact = Artifact {
            id: "33333333-3333-4333-8333-333333333333".to_string(),
            run_id: "22222222-2222-4222-8222-222222222222".to_string(),
            span_id: Some("11111111-1111-4111-8111-111111111111".to_string()),
            kind: "log".to_string(),
            payload: json!({"message": "hello", "level": "debug"}),
        };

        let payload = log_from_artifact(&artifact);
        assert_eq!(payload["message"], "hello");
        assert_eq!(payload["level"], "debug");
        assert_eq!(payload["span_id"], "11111111-1111-4111-8111-111111111111");
    }
}
