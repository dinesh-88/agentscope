use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct FailureCluster {
    pub id: String,
    pub project_id: String,
    pub cluster_key: String,
    pub error_type: String,
    pub count: i32,
    pub sample_run_ids: Vec<String>,
    pub common_span: Option<String>,
    pub created_at: DateTime<Utc>,
}
