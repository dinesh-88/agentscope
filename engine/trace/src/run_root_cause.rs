use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct RunRootCause {
    pub id: String,
    pub run_id: String,
    pub root_cause_type: String,
    pub confidence: f64,
    pub message: String,
    pub evidence: Value,
    pub suggested_fix: String,
    pub created_at: DateTime<Utc>,
}
