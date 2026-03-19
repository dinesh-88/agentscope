use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ArtifactSearchResult {
    pub run_id: String,
    pub span_id: String,
    pub artifact_id: String,
    pub span_type: String,
    pub error_type: Option<String>,
    pub model: Option<String>,
    pub snippet: String,
    pub rank: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtifactSearchResponse {
    pub results: Vec<ArtifactSearchResult>,
    pub total: i64,
}
