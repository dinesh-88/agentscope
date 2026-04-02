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
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub cause: String,
    #[serde(default)]
    pub impact: String,
    #[serde(default)]
    #[sqlx(default, json)]
    pub fix: Vec<String>,
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
    #[serde(default)]
    pub related_transition_from_span_id: Option<String>,
    #[serde(default)]
    pub related_transition_to_span_id: Option<String>,
    #[serde(default)]
    pub cause_confidence: Option<String>,
    #[serde(default)]
    pub derived_from_transition: bool,
}
