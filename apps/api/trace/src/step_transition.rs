use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StepTransition {
    #[serde(default)]
    pub added_messages: Vec<String>,
    #[serde(default)]
    pub removed_messages: Vec<String>,
    #[serde(default)]
    pub token_delta: i64,
    #[serde(default)]
    pub tool_outputs_added: Vec<String>,
    #[serde(default)]
    pub instruction_changes: Vec<String>,
    #[serde(default)]
    pub context_diff: Value,
    #[serde(default)]
    pub instruction_diff: Value,
    #[serde(default)]
    pub warnings: Vec<String>,
}
