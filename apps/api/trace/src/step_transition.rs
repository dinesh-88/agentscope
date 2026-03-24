use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SpanTransition {
    #[serde(default)]
    pub from_span_id: String,
    #[serde(default)]
    pub to_span_id: String,
    #[serde(default)]
    pub token_delta: i64,
    #[serde(default)]
    pub messages_added: i32,
    #[serde(default)]
    pub messages_removed: i32,
    #[serde(default)]
    pub tool_outputs_added: Vec<String>,
    #[serde(default)]
    pub instruction_changed: bool,
    #[serde(default)]
    pub warnings: Vec<String>,
    #[serde(default)]
    pub likely_cause: bool,
    #[serde(default)]
    pub cause_confidence: f32,
    #[serde(default)]
    pub cause_reason: Option<String>,
    #[serde(default)]
    pub context_diff: Value,
    #[serde(default)]
    pub instruction_diff: Value,
    #[serde(default)]
    pub added_messages: Vec<String>,
    #[serde(default)]
    pub removed_messages: Vec<String>,
    #[serde(default)]
    pub instruction_changes: Vec<String>,
}

pub type StepTransition = SpanTransition;
