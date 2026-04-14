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
    api_key: String,
}

#[derive(Clone)]
pub struct TelemetryRecord {
    pub request_id: String,
    pub trace_id: String,
    pub parent_run_id: Option<String>,
    pub root_run_id: Option<String>,
    pub request: ChatCompletionRequest,
    pub latency_ms: u128,
    pub response_text: Option<String>,
    pub usage: Usage,
    pub success: bool,
    pub started_at: DateTime<Utc>,
    pub ended_at: DateTime<Utc>,
}

impl TelemetryClient {
    pub fn new(client: Client, ingest_base_url: String, api_key: String) -> Self {
        Self {
            client,
            ingest_base_url,
            api_key,
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

        match self
            .client
            .post(url)
            .header("x-agentscope-api-key", &self.api_key)
            .json(&payload)
            .send()
            .await
        {
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
    let TelemetryRecord {
        request_id,
        trace_id,
        parent_run_id,
        root_run_id,
        request,
        latency_ms,
        response_text,
        usage,
        success,
        started_at,
        ended_at,
    } = record;

    let run_id = request_id.clone();
    let span_id = Uuid::new_v4().to_string();
    let status = if success { "success" } else { "failed" }.to_string();
    let model = request.model.clone();
    let messages = request.messages.clone();
    let temperature = request.temperature;
    let tools = request.tools.clone();
    let stream = request.stream;
    let artifact_payload = json!({
        "request_id": request_id,
        "type": "llm_call",
        "provider": "openai",
        "model": model,
        "messages": messages,
        "response": response_text,
        "usage": {
            "input_tokens": usage.input_tokens,
            "output_tokens": usage.output_tokens,
            "total_tokens": usage.total_tokens,
        },
        "latency_ms": latency_ms,
        "temperature": temperature,
        "tools": tools,
    });

    IngestPayload {
        run: IngestRun {
            id: run_id.clone(),
            project_id: "llm-proxy".to_string(),
            workflow_name: "openai_chat_completions".to_string(),
            agent_name: "agentscope-llm-proxy".to_string(),
            status: status.clone(),
            started_at: started_at.clone(),
            ended_at: Some(ended_at.clone()),
            metadata: Some(json!({
                "telemetry_source": "llm_proxy",
                "trace_id": trace_id.clone(),
                "parent_run_id": parent_run_id,
                "root_run_id": root_run_id.unwrap_or(run_id.clone()),
                "request_id": run_id.clone(),
            })),
        },
        spans: vec![IngestSpan {
            id: span_id.clone(),
            run_id: run_id.clone(),
            parent_span_id: None,
            span_type: "llm_call".to_string(),
            name: "POST /v1/chat/completions".to_string(),
            status,
            started_at,
            ended_at: Some(ended_at),
            provider: Some("openai".to_string()),
            model: Some(request.model),
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
            total_tokens: usage.total_tokens,
            estimated_cost: None,
            metadata: Some(json!({
                "telemetry_source": "llm_proxy",
                "trace_id": trace_id,
                "request_id": run_id.clone(),
                "temperature": temperature,
                "stream": stream,
                "tools": request.tools,
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
