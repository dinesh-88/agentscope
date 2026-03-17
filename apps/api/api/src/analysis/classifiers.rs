use serde_json::json;

use crate::analysis::detectors::Detection;

#[derive(Debug, Clone)]
pub struct ClassifiedRootCause {
    pub root_cause_category: &'static str,
    pub summary: String,
    pub suggested_fixes: Vec<String>,
    pub evidence: serde_json::Value,
}

pub fn classify_root_cause(detections: &[Detection]) -> ClassifiedRootCause {
    let primary = detections.first();

    match primary.map(|detection| detection.failure_type) {
        Some("SCHEMA_VALIDATION_ERROR") => ClassifiedRootCause {
            root_cause_category: "LLM_OUTPUT_FORMAT_ERROR",
            summary: primary.unwrap().summary.clone(),
            suggested_fixes: vec![
                "Strengthen the output schema instructions and include a strict JSON example.".to_string(),
                "Validate and repair model output before passing it downstream.".to_string(),
                "Lower response creativity for structured generations.".to_string(),
            ],
            evidence: primary.unwrap().evidence.clone(),
        },
        Some("TOOL_FAILURE") => ClassifiedRootCause {
            root_cause_category: "TOOL_EXECUTION_ERROR",
            summary: primary.unwrap().summary.clone(),
            suggested_fixes: vec![
                "Validate tool arguments before execution.".to_string(),
                "Add retries or fallback behavior for transient tool errors.".to_string(),
                "Emit richer tool error artifacts to isolate bad inputs from infrastructure failures.".to_string(),
            ],
            evidence: primary.unwrap().evidence.clone(),
        },
        Some("TOKEN_OVERFLOW") => ClassifiedRootCause {
            root_cause_category: "PROMPT_TOO_LARGE",
            summary: primary.unwrap().summary.clone(),
            suggested_fixes: vec![
                "Trim or summarize conversation history before the model call.".to_string(),
                "Reduce retrieved context and cap examples injected into the prompt.".to_string(),
                "Switch to a larger-context model only when prompt reduction is not enough.".to_string(),
            ],
            evidence: primary.unwrap().evidence.clone(),
        },
        Some("TIMEOUT") => ClassifiedRootCause {
            root_cause_category: "TIMEOUT",
            summary: primary.unwrap().summary.clone(),
            suggested_fixes: vec![
                "Set shorter internal steps and fail fast on slow dependencies.".to_string(),
                "Add retries with backoff only for idempotent operations.".to_string(),
                "Reduce prompt size or tool work if latency spikes are model-driven.".to_string(),
            ],
            evidence: primary.unwrap().evidence.clone(),
        },
        Some("API_ERROR") => ClassifiedRootCause {
            root_cause_category: "API_FAILURE",
            summary: primary.unwrap().summary.clone(),
            suggested_fixes: vec![
                "Retry transient upstream failures with backoff.".to_string(),
                "Handle provider rate limits and 5xx responses explicitly.".to_string(),
                "Add provider failover or queueing if the workflow is latency-sensitive.".to_string(),
            ],
            evidence: primary.unwrap().evidence.clone(),
        },
        _ => ClassifiedRootCause {
            root_cause_category: "API_FAILURE",
            summary: "No specific failure pattern was detected from spans and artifacts.".to_string(),
            suggested_fixes: vec![
                "Capture richer error artifacts around failed LLM and tool steps.".to_string(),
                "Record provider status codes, timeout flags, and parser failures for future analysis.".to_string(),
            ],
            evidence: json!({ "detections": [] }),
        },
    }
}
