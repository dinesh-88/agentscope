use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub type Message = Value;

#[derive(Debug, Clone, Deserialize)]
pub struct ChatCompletionRequest {
    pub model: String,
    #[serde(default)]
    pub messages: Vec<Message>,
    #[serde(default)]
    pub temperature: Option<f64>,
    #[serde(default)]
    pub tools: Option<Value>,
    #[serde(default)]
    pub stream: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct LlmTelemetry {
    pub request_id: String,
    pub model: String,
    pub messages: Vec<Message>,
    pub latency_ms: u128,
    pub response_text: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Usage {
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub total_tokens: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct IngestPayload {
    pub run: IngestRun,
    pub spans: Vec<IngestSpan>,
    pub artifacts: Vec<IngestArtifact>,
}

#[derive(Debug, Clone, Serialize)]
pub struct IngestRun {
    pub id: String,
    pub project_id: String,
    pub workflow_name: String,
    pub agent_name: String,
    pub status: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct IngestSpan {
    pub id: String,
    pub run_id: String,
    pub parent_span_id: Option<String>,
    pub span_type: String,
    pub name: String,
    pub status: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub total_tokens: Option<i64>,
    pub estimated_cost: Option<f64>,
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct IngestArtifact {
    pub id: String,
    pub run_id: String,
    pub span_id: Option<String>,
    pub kind: String,
    pub payload: Value,
}
