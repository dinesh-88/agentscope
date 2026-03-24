use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::FromRow;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FixSuggestion {
    pub title: String,
    pub description: String,
    pub action_type: String,
    pub confidence: f32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, FromRow)]
#[sqlx(default)]
pub struct RunInsight {
    pub id: String,
    pub run_id: String,
    pub insight_type: String,
    pub severity: String,
    #[serde(default)]
    pub is_primary: bool,
    pub message: String,
    pub recommendation: String,
    pub created_at: DateTime<Utc>,
    #[serde(default)]
    pub evidence: Value,
    #[serde(default)]
    pub impact_score: f32,
    #[serde(default)]
    #[sqlx(default, json)]
    pub fix_suggestions: Vec<FixSuggestion>,
}
