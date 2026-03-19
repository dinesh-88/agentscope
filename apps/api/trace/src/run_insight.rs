use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::FromRow;

#[derive(Debug, Clone, Default, Serialize, Deserialize, FromRow)]
#[sqlx(default)]
pub struct RunInsight {
    pub id: String,
    pub run_id: String,
    pub insight_type: String,
    pub severity: String,
    pub message: String,
    pub recommendation: String,
    pub created_at: DateTime<Utc>,
    #[serde(default)]
    pub evidence: Value,
    #[serde(default)]
    pub impact_score: f32,
}
