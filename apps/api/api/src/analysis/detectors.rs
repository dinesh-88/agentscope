use agentscope_trace::{Artifact, Span};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

use crate::analysis::step_transition::{build_step_transitions, is_meaningful_transition};

#[derive(Debug, Clone)]
pub struct Detection {
    pub failure_type: &'static str,
    pub confidence: f64,
    pub summary: String,
    pub span_count: usize,
    pub affected_spans: Vec<String>,
    pub evidence: Value,
}

pub fn detect_failure_types(spans: &[Span], artifacts: &[Artifact]) -> Vec<Detection> {
    let mut detections = Vec::new();

    if let Some(detection) = detect_schema_validation_error(artifacts) {
        detections.push(detection);
    }
    if let Some(detection) = detect_tool_failure(spans, artifacts) {
        detections.push(detection);
    }
    if let Some(detection) = detect_timeout(spans, artifacts) {
        detections.push(detection);
    }
    if let Some(detection) = detect_api_error(spans, artifacts) {
        detections.push(detection);
    }
    if let Some(detection) = detect_token_overflow(spans, artifacts) {
        detections.push(detection);
    }
    if let Some(detection) = detect_instruction_drift(spans) {
        detections.push(detection);
    }
    if let Some(detection) = detect_missing_output_constraint(spans, artifacts) {
        detections.push(detection);
    }
    if let Some(detection) = detect_instruction_conflict(spans) {
        detections.push(detection);
    }
    if let Some(detection) = detect_step_transition_issue(spans, artifacts) {
        detections.push(detection);
    }

    detections.sort_by(|left, right| right.confidence.total_cmp(&left.confidence));
    detections
}

fn detect_step_transition_issue(spans: &[Span], artifacts: &[Artifact]) -> Option<Detection> {
    let mut ordered = spans.iter().collect::<Vec<_>>();
    ordered.sort_by_key(|span| span.started_at);

    if ordered.len() < 2 {
        return None;
    }

    let by_span = build_step_transitions(spans, artifacts);
    let mut affected_spans = Vec::<String>::new();
    let mut transitions = Vec::<Value>::new();

    for index in 1..ordered.len() {
        let current = ordered[index];
        let failed = matches!(current.status.as_str(), "failed" | "error") || current.success == Some(false);
        if !failed {
            continue;
        }

        let Some(transition) = by_span.get(&current.id) else {
            continue;
        };
        if !is_meaningful_transition(transition) {
            continue;
        }

        affected_spans.push(current.id.clone());
        transitions.push(json!({
            "span_id": current.id,
            "previous_span_id": ordered[index - 1].id,
            "token_delta": transition.token_delta,
            "added_messages": transition.added_messages,
            "removed_messages": transition.removed_messages,
            "instruction_changes": transition.instruction_changes,
            "tool_outputs_added": transition.tool_outputs_added,
            "warnings": transition.warnings
        }));
    }

    if affected_spans.is_empty() {
        return None;
    }

    Some(Detection {
        failure_type: "STEP_TRANSITION_ISSUE",
        confidence: 0.84,
        summary: "Failure likely caused by previous step context transition.".to_string(),
        span_count: affected_spans.len(),
        affected_spans,
        evidence: json!({
            "transitions": transitions
        }),
    })
}

fn detect_instruction_drift(spans: &[Span]) -> Option<Detection> {
    let mut signatures = HashSet::new();
    let mut affected_spans = Vec::new();
    let mut span_signatures = Vec::new();

    for span in spans
        .iter()
        .filter(|span| span.span_type == "llm" || span.span_type == "llm_call")
    {
        let signature = instruction_signature(span)?;
        signatures.insert(signature.clone());
        affected_spans.push(span.id.clone());
        span_signatures.push(json!({
            "span_id": span.id,
            "signature": signature
        }));
    }

    if signatures.len() <= 1 {
        return None;
    }

    Some(Detection {
        failure_type: "INSTRUCTION_DRIFT",
        confidence: 0.86,
        summary: "Instruction stack changed across LLM spans in the same run.".to_string(),
        span_count: affected_spans.len(),
        affected_spans,
        evidence: json!({
            "unique_signatures": signatures.len(),
            "span_signatures": span_signatures
        }),
    })
}

fn detect_missing_output_constraint(spans: &[Span], artifacts: &[Artifact]) -> Option<Detection> {
    let schema_error_span_ids = artifacts
        .iter()
        .filter_map(|artifact| {
            let message = payload_message(&artifact.payload);
            if message.contains("schema")
                || message.contains("invalid json")
                || message.contains("json parse")
            {
                artifact.span_id.clone()
            } else {
                None
            }
        })
        .collect::<HashSet<_>>();

    let affected = spans
        .iter()
        .filter(|span| span.span_type == "llm" || span.span_type == "llm_call")
        .filter(|span| {
            let failed = matches!(span.status.as_str(), "failed" | "error")
                || span.error_type.as_deref() == Some("invalid_json")
                || schema_error_span_ids.contains(&span.id);
            failed && !has_output_constraint(span)
        })
        .map(|span| span.id.clone())
        .collect::<Vec<_>>();

    if affected.is_empty() {
        return None;
    }

    Some(Detection {
        failure_type: "MISSING_OUTPUT_CONSTRAINT",
        confidence: 0.83,
        summary: "LLM spans failed without explicit output-format constraints in instructions.".to_string(),
        span_count: affected.len(),
        affected_spans: affected.clone(),
        evidence: json!({
            "affected_spans": affected
        }),
    })
}

fn detect_instruction_conflict(spans: &[Span]) -> Option<Detection> {
    for span in spans
        .iter()
        .filter(|span| span.span_type == "llm" || span.span_type == "llm_call")
    {
        let Some(context) = span.instruction_context.as_ref().and_then(Value::as_object) else {
            continue;
        };
        let Some(sources) = context.get("sources").and_then(Value::as_array) else {
            continue;
        };

        let mut hashes_by_path = HashMap::<String, HashSet<String>>::new();
        for source in sources {
            let Some(object) = source.as_object() else {
                continue;
            };
            let path = object
                .get("path")
                .and_then(Value::as_str)
                .or_else(|| object.get("name").and_then(Value::as_str))
                .unwrap_or("unknown")
                .to_string();
            let hash = object
                .get("hash")
                .and_then(Value::as_str)
                .unwrap_or("-")
                .to_string();
            hashes_by_path.entry(path).or_default().insert(hash);
        }

        let conflicting = hashes_by_path
            .iter()
            .filter(|(_, hashes)| hashes.len() > 1)
            .map(|(path, _)| path.clone())
            .collect::<Vec<_>>();
        if conflicting.is_empty() {
            continue;
        }

        return Some(Detection {
            failure_type: "INSTRUCTION_CONFLICT",
            confidence: 0.9,
            summary: "Conflicting instruction sources were detected for an LLM span.".to_string(),
            span_count: 1,
            affected_spans: vec![span.id.clone()],
            evidence: json!({
                "span_id": span.id,
                "conflicting_sources": conflicting
            }),
        });
    }

    None
}

fn detect_schema_validation_error(artifacts: &[Artifact]) -> Option<Detection> {
    let artifact = artifacts.iter().find(|artifact| {
        let kind = artifact.kind.to_lowercase();
        let message = payload_message(&artifact.payload);
        kind.contains("schema")
            || message.contains("schema validation")
            || message.contains("invalid json")
            || message.contains("json parse")
            || message.contains("jsondecodeerror")
    })?;

    Some(Detection {
        failure_type: "SCHEMA_VALIDATION_ERROR",
        confidence: 0.97,
        summary: "The run produced output that could not be parsed or validated against the expected schema.".to_string(),
        span_count: artifact.span_id.as_ref().map(|_| 1).unwrap_or(0),
        affected_spans: artifact.span_id.clone().into_iter().collect(),
        evidence: artifact.payload.clone(),
    })
}

fn detect_tool_failure(spans: &[Span], artifacts: &[Artifact]) -> Option<Detection> {
    let span = spans.iter().find(|span| {
        span.span_type == "tool_call"
            && matches!(span.status.as_str(), "error" | "failed" | "timeout")
    })?;

    let evidence = artifacts
        .iter()
        .find(|artifact| {
            artifact.span_id.as_deref() == Some(span.id.as_str()) && artifact.kind.contains("error")
        })
        .map(|artifact| artifact.payload.clone())
        .unwrap_or_else(|| {
            json!({
                "span_id": span.id,
                "span_name": span.name,
                "status": span.status
            })
        });

    Some(Detection {
        failure_type: "TOOL_FAILURE",
        confidence: 0.95,
        summary: format!("Tool span {} failed during execution.", span.name),
        span_count: 1,
        affected_spans: vec![span.id.clone()],
        evidence,
    })
}

fn detect_timeout(spans: &[Span], artifacts: &[Artifact]) -> Option<Detection> {
    if let Some(span) = spans.iter().find(|span| {
        let status = span.status.to_lowercase();
        status.contains("timeout") || payload_contains_timeout(span.metadata.as_ref())
    }) {
        return Some(Detection {
            failure_type: "TIMEOUT",
            confidence: 0.94,
            summary: format!("Span {} timed out before completion.", span.name),
            span_count: 1,
            affected_spans: vec![span.id.clone()],
            evidence: json!({
                "span_id": span.id,
                "status": span.status,
                "metadata": span.metadata
            }),
        });
    }

    let artifact = artifacts
        .iter()
        .find(|artifact| payload_contains_timeout(Some(&artifact.payload)))?;

    Some(Detection {
        failure_type: "TIMEOUT",
        confidence: 0.92,
        summary: "A timeout was detected in run artifacts.".to_string(),
        span_count: artifact.span_id.as_ref().map(|_| 1).unwrap_or(0),
        affected_spans: artifact.span_id.clone().into_iter().collect(),
        evidence: artifact.payload.clone(),
    })
}

fn detect_api_error(spans: &[Span], artifacts: &[Artifact]) -> Option<Detection> {
    let artifact = artifacts.iter().find(|artifact| {
        extract_http_status(&artifact.payload).is_some_and(|status| status >= 400)
            || payload_message(&artifact.payload).contains("api error")
            || payload_message(&artifact.payload).contains("rate limit")
    })?;

    let http_status = extract_http_status(&artifact.payload);
    let span = artifact
        .span_id
        .as_ref()
        .and_then(|span_id| spans.iter().find(|span| span.id == *span_id));
    let span_id = span.map(|value| value.id.clone());
    let provider = span.and_then(|value| value.provider.clone());

    Some(Detection {
        failure_type: "API_ERROR",
        confidence: if http_status.unwrap_or_default() >= 500 {
            0.93
        } else {
            0.88
        },
        summary: match http_status {
            Some(status) => format!("An upstream API request failed with status {status}."),
            None => "An upstream API request failed.".to_string(),
        },
        span_count: span_id.as_ref().map(|_| 1).unwrap_or(0),
        affected_spans: span_id.clone().into_iter().collect(),
        evidence: json!({
            "artifact": artifact.payload,
            "span_id": span_id,
            "provider": provider
        }),
    })
}

fn detect_token_overflow(spans: &[Span], artifacts: &[Artifact]) -> Option<Detection> {
    if let Some(span) = spans.iter().find(|span| {
        span.model
            .as_deref()
            .and_then(estimate_context_window)
            .zip(span.input_tokens)
            .is_some_and(|(window, tokens)| tokens > window)
    }) {
        let model = span.model.clone().unwrap_or_else(|| "unknown".to_string());
        let window = estimate_context_window(&model).unwrap_or_default();
        return Some(Detection {
            failure_type: "TOKEN_OVERFLOW",
            confidence: 0.99,
            summary: format!(
                "Span {} exceeded the estimated context window for model {}.",
                span.name, model
            ),
            span_count: 1,
            affected_spans: vec![span.id.clone()],
            evidence: json!({
                "span_id": span.id,
                "model": model,
                "input_tokens": span.input_tokens,
                "context_window": window
            }),
        });
    }

    let artifact = artifacts.iter().find(|artifact| {
        let message = payload_message(&artifact.payload);
        message.contains("context length")
            || message.contains("maximum context")
            || message.contains("token limit")
    })?;

    Some(Detection {
        failure_type: "TOKEN_OVERFLOW",
        confidence: 0.95,
        summary: "The run exceeded the model token or context limit.".to_string(),
        span_count: artifact.span_id.as_ref().map(|_| 1).unwrap_or(0),
        affected_spans: artifact.span_id.clone().into_iter().collect(),
        evidence: artifact.payload.clone(),
    })
}

fn payload_message(payload: &Value) -> String {
    [
        payload.get("message"),
        payload.get("error"),
        payload.get("detail"),
        payload
            .get("response")
            .and_then(|value| value.get("message")),
        payload
            .get("payload")
            .and_then(|value| value.get("message")),
    ]
    .into_iter()
    .flatten()
    .find_map(Value::as_str)
    .unwrap_or_default()
    .to_lowercase()
}

fn payload_contains_timeout(payload: Option<&Value>) -> bool {
    let Some(payload) = payload else {
        return false;
    };

    payload_message(payload).contains("timeout")
        || payload
            .get("timed_out")
            .and_then(Value::as_bool)
            .unwrap_or(false)
}

fn extract_http_status(payload: &Value) -> Option<i64> {
    [
        payload.get("http_status"),
        payload.get("status"),
        payload.get("status_code"),
        payload
            .get("response")
            .and_then(|value| value.get("http_status")),
        payload
            .get("response")
            .and_then(|value| value.get("status_code")),
    ]
    .into_iter()
    .flatten()
    .find_map(Value::as_i64)
}

fn instruction_signature(span: &Span) -> Option<String> {
    let context = span.instruction_context.as_ref()?.as_object()?;
    let sources = context.get("sources")?.as_array()?;
    let mut parts = sources
        .iter()
        .filter_map(|source| {
            let object = source.as_object()?;
            let source_type = object.get("type").and_then(Value::as_str).unwrap_or("unknown");
            let path = object.get("path").and_then(Value::as_str).unwrap_or("-");
            let hash = object.get("hash").and_then(Value::as_str).unwrap_or("-");
            Some(format!("{source_type}:{path}:{hash}"))
        })
        .collect::<Vec<_>>();
    parts.sort();
    if parts.is_empty() {
        return None;
    }
    Some(parts.join("|"))
}

fn has_output_constraint(span: &Span) -> bool {
    let Some(context) = span.instruction_context.as_ref().and_then(Value::as_object) else {
        return false;
    };
    let Some(sources) = context.get("sources").and_then(Value::as_array) else {
        return false;
    };
    let combined = sources
        .iter()
        .filter_map(|source| source.as_object())
        .filter_map(|object| object.get("content"))
        .map(stringify_json)
        .collect::<Vec<_>>()
        .join("\n")
        .to_lowercase();

    ["json", "schema", "format", "must output", "respond with", "structured"]
        .iter()
        .any(|needle| combined.contains(needle))
}

fn stringify_json(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        _ => serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string()),
    }
}

pub fn estimate_context_window(model: &str) -> Option<i64> {
    let model = model.to_lowercase();

    if model.contains("gpt-4.1") || model.contains("gpt-4o") || model.contains("gpt-5") {
        return Some(128_000);
    }
    if model.contains("claude-3") || model.contains("claude-sonnet-4") {
        return Some(200_000);
    }
    if model.contains("gemini-1.5") || model.contains("gemini-2.0") {
        return Some(1_000_000);
    }
    if model.contains("llama") {
        return Some(128_000);
    }

    None
}
