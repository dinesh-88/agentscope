use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpanError {
    #[serde(default)]
    pub error_type: Option<String>,
    #[serde(default)]
    pub error_source: Option<String>,
    #[serde(default)]
    pub retryable: Option<bool>,
    #[serde(default)]
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, FromRow)]
#[sqlx(default)]
pub struct Span {
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
    pub context_window: Option<i64>,
    pub context_usage_percent: Option<f64>,
    #[serde(default)]
    pub latency_ms: Option<f64>,
    #[serde(default)]
    pub success: Option<bool>,
    #[serde(default)]
    pub error_type: Option<String>,
    #[serde(default)]
    pub error_source: Option<String>,
    #[serde(default)]
    pub retryable: Option<bool>,
    #[serde(default)]
    pub prompt_hash: Option<String>,
    #[serde(default)]
    pub prompt_template_id: Option<String>,
    #[serde(default)]
    pub temperature: Option<f64>,
    #[serde(default)]
    pub top_p: Option<f64>,
    #[serde(default)]
    pub max_tokens: Option<i32>,
    #[serde(default)]
    pub retry_attempt: Option<i32>,
    #[serde(default)]
    pub max_attempts: Option<i32>,
    #[serde(default)]
    pub tool_name: Option<String>,
    #[serde(default)]
    pub tool_version: Option<String>,
    #[serde(default)]
    pub tool_latency_ms: Option<f64>,
    #[serde(default)]
    pub tool_success: Option<bool>,
    #[serde(default)]
    pub evaluation: Option<Value>,
    pub metadata: Option<Value>,
    #[serde(default)]
    #[sqlx(skip)]
    pub error: Option<SpanError>,
}
