use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct RunAnalysis {
    pub id: String,
    pub run_id: String,
    pub project_id: String,
    pub failure_types: Value,
    pub root_cause_category: String,
    pub summary: String,
    pub evidence: Value,
    pub suggested_fixes: Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
