use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct RunReplay {
    pub id: String,
    pub original_run_id: String,
    pub current_step: i32,
    pub state: Value,
    pub created_at: DateTime<Utc>,
}
