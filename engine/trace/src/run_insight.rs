use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct RunInsight {
    pub id: String,
    pub run_id: String,
    pub insight_type: String,
    pub severity: String,
    pub message: String,
    pub recommendation: String,
    pub created_at: DateTime<Utc>,
}
