use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Artifact {
    pub id: String,
    pub run_id: String,
    pub span_id: Option<String>,
    pub kind: String,
    pub payload: Value,
}
