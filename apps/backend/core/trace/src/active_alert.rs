use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ActiveAlert {
    pub id: String,
    pub project_id: String,
    pub alert_type: String,
    pub severity: String,
    pub message: String,
    pub evidence: Value,
    pub created_at: DateTime<Utc>,
}
