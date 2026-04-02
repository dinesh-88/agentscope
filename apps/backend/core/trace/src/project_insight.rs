use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ProjectInsight {
    pub id: String,
    pub project_id: String,
    pub insight_type: String,
    pub severity: String,
    pub message: String,
    pub evidence: Value,
    pub recommendation: String,
    pub run_count: i32,
    pub created_at: DateTime<Utc>,
}
