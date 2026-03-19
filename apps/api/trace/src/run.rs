use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::FromRow;

#[derive(Debug, Clone, Default, Serialize, Deserialize, FromRow)]
#[sqlx(default)]
pub struct Run {
    pub id: String,
    pub project_id: String,
    #[serde(default)]
    pub organization_id: Option<String>,
    #[serde(default)]
    pub user_id: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub environment: Option<String>,
    pub workflow_name: String,
    pub agent_name: String,
    pub status: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub total_input_tokens: i64,
    #[serde(default)]
    pub total_output_tokens: i64,
    #[serde(default)]
    pub total_tokens: i64,
    #[serde(default)]
    pub total_cost_usd: f64,
    #[serde(default)]
    pub success: Option<bool>,
    #[serde(default)]
    pub error_count: Option<i32>,
    #[serde(default)]
    pub avg_latency_ms: Option<f64>,
    #[serde(default)]
    pub p95_latency_ms: Option<f64>,
    #[serde(default)]
    pub success_rate: Option<f64>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub experiment_id: Option<String>,
    #[serde(default)]
    pub variant: Option<String>,
    #[serde(default)]
    pub metadata: Option<Value>,
}
