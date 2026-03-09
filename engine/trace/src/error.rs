use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorEvent {
    pub run_id: String,
    pub span_id: Option<String>,
    pub error_type: String,
    pub message: String,
}

pub type TelemetryError = ErrorEvent;
