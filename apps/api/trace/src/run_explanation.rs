use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::FromRow;

#[derive(Debug, Clone, Default, Serialize, Deserialize, FromRow)]
#[sqlx(default)]
pub struct RunExplanation {
    pub run_id: String,
    pub summary: String,
    pub top_issue: String,
    pub why_it_matters: String,
    pub next_action: String,
    #[serde(default)]
    pub recommended_order: Value,
    pub created_at: DateTime<Utc>,
}
