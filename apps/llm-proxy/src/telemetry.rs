use chrono::{DateTime, Utc};
use reqwest::Client;
use serde_json::{json, Value};
use tracing::{error, info};
use uuid::Uuid;

use crate::models::{
    ChatCompletionRequest, IngestArtifact, IngestPayload, IngestRun, IngestSpan, LlmTelemetry,
    Usage,
};

#[derive(Clone)]
pub struct TelemetryClient {
    client: Client,
    ingest_base_url: String,
}

#[derive(Clone)]
pub struct TelemetryRecord {
    pub request_id: String,
    pub request: ChatCompletionRequest,
    pub latency_ms: u128,
    pub response_text: Option<String>,
    pub usage: Usage,
    pub started_at: DateTime<Utc>,
    pub ended_at: DateTime<Utc>,
}

impl TelemetryClient {
    pub fn new(client: Client, ingest_base_url: String) -> Self {
        Self {
            client,
            ingest_base_url,
        }
    }

    pub async fn send(&self, record: TelemetryRecord) {
        let telemetry = LlmTelemetry {
            request_id: record.request_id.clone(),
            model: record.request.model.clone(),
            messages: record.request.messages.clone(),
            latency_ms: record.latency_ms,
            response_text: record.response_text.clone(),
        };

        let payload = build_ingest_payload(record);
        let url = format!("{}/v1/ingest", self.ingest_base_url.trim_end_matches('/'));

        match self.client.post(url).json(&payload).send().await {
            Ok(response) if response.status().is_success() => {
                info!(
                    request_id = %telemetry.request_id,
                    model = %telemetry.model,
                    latency_ms = telemetry.latency_ms,
                    "telemetry sent"
                );
            }
            Ok(response) => {
                error!(
                    request_id = %telemetry.request_id,
                    status = %response.status(),
                    "telemetry ingest failed"
                );
            }
            Err(err) => {
                error!(
                    request_id = %telemetry.request_id,
                    error = %err,
                    "telemetry request failed"
                );
            }
        }
    }
}

fn build_ingest_payload(record: TelemetryRecord) -> IngestPayload {
    let run_id = record.request_id.clone();
    let span_id = Uuid::new_v4().to_string();
    let artifact_payload = json!({
        "request_id": record.request_id,
        "type": "llm_call",
        "provider": "openai",
        "model": record.request.model,
        "messages": record.request.messages,
        "response": record.response_text,
        "latency_ms": record.latency_ms,
        "temperature": record.request.temperature,
        "tools": record.request.tools,
    });

    IngestPayload {
        run: IngestRun {
            id: run_id.clone(),
            project_id: "llm-proxy".to_string(),
            workflow_name: "openai_chat_completions".to_string(),
            agent_name: "agentscope-llm-proxy".to_string(),
            status: "success".to_string(),
            started_at: record.started_at,
            ended_at: Some(record.ended_at),
        },
        spans: vec![IngestSpan {
            id: span_id.clone(),
            run_id: run_id.clone(),
            parent_span_id: None,
            span_type: "llm_call".to_string(),
            name: "POST /v1/chat/completions".to_string(),
            status: "success".to_string(),
            started_at: record.started_at,
            ended_at: Some(record.ended_at),
            provider: Some("openai".to_string()),
            model: Some(record.request.model),
            input_tokens: record.usage.input_tokens,
            output_tokens: record.usage.output_tokens,
            total_tokens: record.usage.total_tokens,
            estimated_cost: None,
            metadata: Some(json!({
                "temperature": record.request.temperature,
                "stream": record.request.stream,
                "tools": record.request.tools,
            })),
        }],
        artifacts: vec![IngestArtifact {
            id: Uuid::new_v4().to_string(),
            run_id,
            span_id: Some(span_id),
            kind: "llm_payload".to_string(),
            payload: artifact_payload,
        }],
    }
}

pub fn extract_usage_from_json(value: &Value) -> Usage {
    Usage {
        input_tokens: value
            .get("usage")
            .and_then(|usage| usage.get("prompt_tokens"))
            .and_then(Value::as_i64),
        output_tokens: value
            .get("usage")
            .and_then(|usage| usage.get("completion_tokens"))
            .and_then(Value::as_i64),
        total_tokens: value
            .get("usage")
            .and_then(|usage| usage.get("total_tokens"))
            .and_then(Value::as_i64),
    }
}
