use std::collections::{HashMap, HashSet};

use agentscope_trace::{Artifact, Span, StepTransition};
use serde_json::{json, Map, Value};

use crate::analysis::detectors::Detection;

pub fn build_step_transitions(
    spans: &[Span],
    artifacts: &[Artifact],
) -> HashMap<String, StepTransition> {
    build_step_transitions_with_causes(spans, artifacts, &[])
}

pub fn build_step_transitions_with_causes(
    spans: &[Span],
    artifacts: &[Artifact],
    detections: &[Detection],
) -> HashMap<String, StepTransition> {
    let mut ordered = spans.iter().collect::<Vec<_>>();
    ordered.sort_by_key(|span| span.started_at);

    if ordered.len() < 2 {
        return HashMap::new();
    }

    let artifacts_by_span = artifacts_by_span(artifacts);
    let detections_by_span = detections_by_span(detections);
    let mut by_span_id = HashMap::<String, StepTransition>::new();

    for index in 1..ordered.len() {
        let previous = ordered[index - 1];
        let current = ordered[index];
        let transition = compute_transition(
            previous,
            current,
            artifacts_by_span.get(&previous.id),
            detections_by_span.get(&current.id),
        );
        by_span_id.insert(current.id.clone(), transition);
    }

    by_span_id
}

pub fn compute_transition(
    previous: &Span,
    current: &Span,
    previous_artifacts: Option<&Vec<&Artifact>>,
    next_failures: Option<&HashSet<&'static str>>,
) -> StepTransition {
    let previous_messages = context_messages(previous);
    let current_messages = context_messages(current);
    let previous_variables = context_variables(previous);
    let current_variables = context_variables(current);

    let (added_messages, removed_messages) = message_diff(&previous_messages, &current_messages);
    let context_diff = context_diff_value(
        &previous_messages,
        &current_messages,
        &previous_variables,
        &current_variables,
    );

    let instruction_diff = instruction_diff(previous, current);
    let instruction_changes = instruction_changes(&instruction_diff);
    let instruction_changed = instruction_hash(previous) != instruction_hash(current);

    let token_delta = resolve_token_delta(previous, current);
    let tool_outputs_added = tool_outputs(previous, previous_artifacts);
    let warnings = transition_warnings(token_delta, current, !tool_outputs_added.is_empty());

    let (likely_cause, cause_confidence, cause_reason) = detect_transition_cause(
        token_delta,
        !tool_outputs_added.is_empty(),
        instruction_changed,
        previous,
        current,
        next_failures,
    );

    StepTransition {
        from_span_id: previous.id.clone(),
        to_span_id: current.id.clone(),
        token_delta,
        messages_added: added_messages.len().min(i32::MAX as usize) as i32,
        messages_removed: removed_messages.len().min(i32::MAX as usize) as i32,
        tool_outputs_added,
        instruction_changed,
        warnings,
        likely_cause,
        cause_confidence,
        cause_reason,
        context_diff,
        instruction_diff,
        added_messages,
        removed_messages,
        instruction_changes,
    }
}

pub fn detect_transition_cause(
    token_delta: i64,
    has_tool_output: bool,
    instruction_changed: bool,
    previous: &Span,
    next_span: &Span,
    next_failures: Option<&HashSet<&'static str>>,
) -> (bool, f32, Option<String>) {
    let failure_types = next_failures.cloned().unwrap_or_default();

    if failure_types.contains("SCHEMA_VALIDATION_ERROR") && has_tool_output {
        return (
            true,
            0.9,
            Some("Tool output introduced invalid JSON into context".to_string()),
        );
    }

    if failure_types.contains("TOKEN_OVERFLOW") && token_delta > 1000 {
        return (
            true,
            0.85,
            Some("Context growth caused model limit overflow".to_string()),
        );
    }

    if instruction_changed && run_behavior_changed(previous, next_span) {
        return (
            true,
            0.8,
            Some("Instruction change altered model behavior".to_string()),
        );
    }

    (false, 0.0, None)
}

fn run_behavior_changed(previous: &Span, next: &Span) -> bool {
    if previous.status != next.status {
        return true;
    }

    if previous.success != next.success {
        return true;
    }

    matches!(next.status.as_str(), "failed" | "error") || next.success == Some(false)
}

fn detections_by_span(detections: &[Detection]) -> HashMap<String, HashSet<&'static str>> {
    let mut by_span = HashMap::<String, HashSet<&'static str>>::new();

    for detection in detections {
        for span_id in detection_targets(detection) {
            by_span
                .entry(span_id)
                .or_default()
                .insert(detection.failure_type);
        }
    }

    by_span
}

fn detection_targets(detection: &Detection) -> Vec<String> {
    let mut targets = detection.affected_spans.clone();

    if let Some(span_id) = detection
        .evidence
        .as_object()
        .and_then(|obj| obj.get("span_id"))
        .and_then(Value::as_str)
    {
        targets.push(span_id.to_string());
    }

    targets.sort();
    targets.dedup();
    targets
}

fn artifacts_by_span(artifacts: &[Artifact]) -> HashMap<String, Vec<&Artifact>> {
    let mut by_span = HashMap::<String, Vec<&Artifact>>::new();
    for artifact in artifacts {
        let Some(span_id) = artifact.span_id.as_ref() else {
            continue;
        };
        by_span.entry(span_id.clone()).or_default().push(artifact);
    }
    by_span
}

fn context_messages(span: &Span) -> HashSet<String> {
    span.context
        .as_ref()
        .and_then(Value::as_object)
        .and_then(|context| context.get("messages"))
        .and_then(Value::as_array)
        .map(|messages| {
            messages
                .iter()
                .map(value_to_diff_string)
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default()
}

fn context_variables(span: &Span) -> Map<String, Value> {
    span.context
        .as_ref()
        .and_then(Value::as_object)
        .and_then(|context| context.get("variables"))
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default()
}

fn message_diff(
    previous: &HashSet<String>,
    current: &HashSet<String>,
) -> (Vec<String>, Vec<String>) {
    let mut added = current
        .difference(previous)
        .filter(|message| !message.trim().is_empty())
        .cloned()
        .collect::<Vec<_>>();
    added.sort();

    let mut removed = previous
        .difference(current)
        .filter(|message| !message.trim().is_empty())
        .cloned()
        .collect::<Vec<_>>();
    removed.sort();

    (added, removed)
}

fn context_diff_value(
    previous_messages: &HashSet<String>,
    current_messages: &HashSet<String>,
    previous_variables: &Map<String, Value>,
    current_variables: &Map<String, Value>,
) -> Value {
    let (added_messages, removed_messages) = message_diff(previous_messages, current_messages);

    let previous_keys = previous_variables.keys().cloned().collect::<HashSet<_>>();
    let current_keys = current_variables.keys().cloned().collect::<HashSet<_>>();

    let mut added = current_keys
        .difference(&previous_keys)
        .cloned()
        .collect::<Vec<_>>();
    added.sort();

    let mut removed = previous_keys
        .difference(&current_keys)
        .cloned()
        .collect::<Vec<_>>();
    removed.sort();

    let mut changed = current_keys
        .intersection(&previous_keys)
        .filter(|key| previous_variables.get(*key) != current_variables.get(*key))
        .cloned()
        .collect::<Vec<_>>();
    changed.sort();

    json!({
        "added_messages": added_messages,
        "removed_messages": removed_messages,
        "changed_variables": {
            "added": added,
            "removed": removed,
            "changed": changed
        }
    })
}

fn instruction_diff(previous: &Span, current: &Span) -> Value {
    let previous_sources = instruction_sources(previous);
    let current_sources = instruction_sources(current);

    let previous_keys = previous_sources.keys().cloned().collect::<HashSet<_>>();
    let current_keys = current_sources.keys().cloned().collect::<HashSet<_>>();

    let mut added = current_keys
        .difference(&previous_keys)
        .cloned()
        .collect::<Vec<_>>();
    added.sort();

    let mut removed = previous_keys
        .difference(&current_keys)
        .cloned()
        .collect::<Vec<_>>();
    removed.sort();

    let mut updated = current_keys
        .intersection(&previous_keys)
        .filter_map(|key| {
            let previous_hash = previous_sources.get(key)?;
            let current_hash = current_sources.get(key)?;
            if previous_hash != current_hash {
                Some(key.clone())
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    updated.sort();

    json!({
        "added_sources": added,
        "removed_sources": removed,
        "updated_sources": updated
    })
}

fn instruction_changes(diff: &Value) -> Vec<String> {
    let Some(diff_obj) = diff.as_object() else {
        return Vec::new();
    };
    let mut changes = Vec::<String>::new();

    if let Some(entries) = diff_obj.get("added_sources").and_then(Value::as_array) {
        for entry in entries {
            if let Some(value) = entry.as_str() {
                changes.push(format!("added:{value}"));
            }
        }
    }
    if let Some(entries) = diff_obj.get("removed_sources").and_then(Value::as_array) {
        for entry in entries {
            if let Some(value) = entry.as_str() {
                changes.push(format!("removed:{value}"));
            }
        }
    }
    if let Some(entries) = diff_obj.get("updated_sources").and_then(Value::as_array) {
        for entry in entries {
            if let Some(value) = entry.as_str() {
                changes.push(format!("updated:{value}"));
            }
        }
    }

    changes.sort();
    changes
}

fn instruction_sources(span: &Span) -> HashMap<String, String> {
    let mut sources = HashMap::<String, String>::new();
    let entries = span
        .instruction_context
        .as_ref()
        .and_then(Value::as_object)
        .and_then(|context| context.get("sources"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    for entry in entries {
        let Some(object) = entry.as_object() else {
            continue;
        };
        let path = object
            .get("path")
            .and_then(Value::as_str)
            .or_else(|| object.get("name").and_then(Value::as_str))
            .unwrap_or("unknown");
        let source_type = object
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let hash = object.get("hash").and_then(Value::as_str).unwrap_or("-");
        let key = format!("{source_type}:{path}");
        sources.insert(key, hash.to_string());
    }

    sources
}

fn instruction_hash(span: &Span) -> String {
    let mut parts = instruction_sources(span)
        .into_iter()
        .map(|(key, hash)| format!("{key}:{hash}"))
        .collect::<Vec<_>>();
    parts.sort();
    parts.join("|")
}

fn resolve_token_delta(previous: &Span, current: &Span) -> i64 {
    match (previous.context_tokens, current.context_tokens) {
        (Some(prev), Some(curr)) => curr - prev,
        _ => current.total_tokens.unwrap_or(0) - previous.total_tokens.unwrap_or(0),
    }
}

fn tool_outputs(previous: &Span, previous_artifacts: Option<&Vec<&Artifact>>) -> Vec<String> {
    let Some(artifacts) = previous_artifacts else {
        return Vec::new();
    };

    let mut outputs = artifacts
        .iter()
        .filter(|artifact| is_tool_output_kind(&artifact.kind))
        .filter_map(|artifact| tool_output_summary(previous, artifact))
        .collect::<Vec<_>>();

    outputs.sort();
    outputs.dedup();
    if outputs.len() > 4 {
        outputs.truncate(4);
    }
    outputs
}

fn is_tool_output_kind(kind: &str) -> bool {
    let lower = kind.to_lowercase();
    lower.contains("stdout")
        || lower.contains("stderr")
        || lower.contains("result")
        || lower.contains("response")
        || lower.contains("output")
        || lower == "tool.output"
}

fn tool_output_summary(previous: &Span, artifact: &Artifact) -> Option<String> {
    let payload = &artifact.payload;
    let hint = payload
        .get("tool")
        .or_else(|| payload.get("name"))
        .or_else(|| payload.get("command"))
        .and_then(Value::as_str)
        .unwrap_or_default();

    if !hint.is_empty() {
        return Some(format!("{} ({})", artifact.kind, truncate(hint, 64)));
    }

    if let Some(tool_name) = previous
        .tool_name
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        return Some(format!("{} ({})", artifact.kind, truncate(tool_name, 64)));
    }

    Some(artifact.kind.clone())
}

fn transition_warnings(token_delta: i64, current: &Span, has_tool_output: bool) -> Vec<String> {
    let mut warnings = Vec::<String>::new();

    if token_delta > 2000 {
        warnings.push("Context size increased significantly".to_string());
    }

    if !has_validation_hint(current) {
        warnings.push("No validation before next step".to_string());
    }

    if has_tool_output {
        warnings.push("Tool output injected into context".to_string());
    }

    warnings
}

fn has_validation_hint(span: &Span) -> bool {
    let Some(context) = span.instruction_context.as_ref().and_then(Value::as_object) else {
        return false;
    };
    let Some(sources) = context.get("sources").and_then(Value::as_array) else {
        return false;
    };

    let content = sources
        .iter()
        .filter_map(|source| source.as_object())
        .filter_map(|object| object.get("content"))
        .map(stringify_json)
        .collect::<Vec<_>>()
        .join("\n")
        .to_lowercase();

    ["validate", "schema", "json", "structured", "must output"]
        .iter()
        .any(|needle| content.contains(needle))
}

fn value_to_diff_string(value: &Value) -> String {
    match value {
        Value::String(raw) => raw.clone(),
        _ => value.to_string(),
    }
}

fn stringify_json(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        _ => serde_json::to_string(value).unwrap_or_else(|_| value.to_string()),
    }
}

fn truncate(value: &str, limit: usize) -> String {
    let mut chars = value.chars();
    let clipped = chars.by_ref().take(limit).collect::<String>();
    if chars.next().is_some() {
        format!("{clipped}...")
    } else {
        clipped
    }
}

pub fn is_meaningful_transition(transition: &StepTransition) -> bool {
    transition.messages_added > 0
        || transition.messages_removed > 0
        || !transition.tool_outputs_added.is_empty()
        || transition.instruction_changed
        || !transition.warnings.is_empty()
        || transition.token_delta.abs() >= 128
}
