use agentscope_trace::{Artifact, Span};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

use crate::analysis::step_transition::{
    build_step_transitions, build_step_transitions_with_causes, is_meaningful_transition,
};

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
    if let Some(detection) = detect_transition_cause(spans, artifacts, &detections) {
        detections.push(detection);
    }
    if let Some(detection) = detect_hallucination_unsupported_claim(spans, artifacts) {
        detections.push(detection);
    }
    if let Some(detection) = detect_hallucination_contradiction(spans, artifacts) {
        detections.push(detection);
    }
    if let Some(detection) = detect_hallucination_fabricated_citation(spans, artifacts) {
        detections.push(detection);
    }
    if let Some(detection) = detect_hallucination_insufficient_retrieval(spans, artifacts) {
        detections.push(detection);
    }
    if let Some(detection) = detect_hallucination_overconfident_inference(spans, artifacts) {
        detections.push(detection);
    }

    detections.sort_by(|left, right| right.confidence.total_cmp(&left.confidence));
    detections
}

fn detect_transition_cause(
    spans: &[Span],
    artifacts: &[Artifact],
    detections: &[Detection],
) -> Option<Detection> {
    let mut ordered = spans.iter().collect::<Vec<_>>();
    ordered.sort_by_key(|span| span.started_at);

    if ordered.len() < 2 {
        return None;
    }

    let by_span = build_step_transitions_with_causes(spans, artifacts, detections);
    let mut affected_spans = Vec::<String>::new();
    let mut transition_evidence = Vec::<Value>::new();
    let mut max_confidence = 0.0_f32;
    let mut primary_reason: Option<String> = None;

    for index in 1..ordered.len() {
        let current = ordered[index];
        let failed =
            matches!(current.status.as_str(), "failed" | "error") || current.success == Some(false);
        if !failed {
            continue;
        }

        let Some(transition) = by_span.get(&current.id) else {
            continue;
        };
        if !transition.likely_cause {
            continue;
        }

        affected_spans.push(current.id.clone());
        max_confidence = max_confidence.max(transition.cause_confidence);
        if primary_reason.is_none() {
            primary_reason = transition.cause_reason.clone();
        }
        transition_evidence.push(json!({
            "span_id": current.id,
            "previous_span_id": ordered[index - 1].id,
            "token_delta": transition.token_delta,
            "tool_outputs_added": transition.tool_outputs_added,
            "instruction_changed": transition.instruction_changed,
            "cause_confidence": transition.cause_confidence,
            "cause_reason": transition.cause_reason
        }));
    }

    if affected_spans.is_empty() {
        return None;
    }

    let reason = primary_reason.unwrap_or_else(|| {
        "Failure likely caused by context introduced in previous step".to_string()
    });
    let summary = if reason == "Tool output introduced invalid JSON into context" {
        "Invalid JSON caused by tool output added in previous step".to_string()
    } else if reason == "Context growth caused model limit overflow" {
        "Token overflow caused by context growth in previous step".to_string()
    } else {
        format!("Failure likely caused by previous step change: {reason}")
    };

    Some(Detection {
        failure_type: "TRANSITION_CAUSE",
        confidence: max_confidence as f64,
        summary,
        span_count: affected_spans.len(),
        affected_spans,
        evidence: json!({
            "transitions": transition_evidence
        }),
    })
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
        let failed =
            matches!(current.status.as_str(), "failed" | "error") || current.success == Some(false);
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
        summary: "LLM spans failed without explicit output-format constraints in instructions."
            .to_string(),
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

#[derive(Debug, Clone)]
struct FinalOutputSnapshot {
    text: String,
    span_id: Option<String>,
    artifact_id: String,
}

#[derive(Debug, Clone)]
struct RetrievalSnapshot {
    artifact_id: String,
    span_id: Option<String>,
    text: String,
    doc_count: usize,
}

fn detect_hallucination_unsupported_claim(
    spans: &[Span],
    artifacts: &[Artifact],
) -> Option<Detection> {
    let final_output = extract_final_output(spans, artifacts)?;
    if final_output.text.len() < 120 {
        return None;
    }

    let retrieval = collect_retrieval_outputs(artifacts);
    let tool_support = collect_support_outputs(artifacts);
    let support_text = format!(
        "{} {}",
        retrieval
            .iter()
            .map(|item| item.text.as_str())
            .collect::<Vec<_>>()
            .join(" "),
        tool_support.join(" ")
    );
    let support_text_lower = support_text.to_lowercase();
    let claims = extract_specific_claims(&final_output.text);
    if claims.is_empty() {
        return None;
    }

    let unsupported = claims
        .iter()
        .filter(|claim| !support_text_lower.contains(claim.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    if unsupported.is_empty() {
        return None;
    }

    let unsupported_ratio = unsupported.len() as f64 / claims.len() as f64;
    if unsupported_ratio < 0.35 {
        return None;
    }

    Some(Detection {
        failure_type: "HALLUCINATION_UNSUPPORTED_CLAIM",
        confidence: (0.72 + unsupported_ratio * 0.24).clamp(0.72, 0.96),
        summary: "Final response includes specific claims that are not supported by retrieved/tool evidence.".to_string(),
        span_count: final_output.span_id.as_ref().map(|_| 1).unwrap_or(0),
        affected_spans: final_output.span_id.clone().into_iter().collect(),
        evidence: json!({
            "final_output_artifact_id": final_output.artifact_id,
            "unsupported_claims": unsupported,
            "total_specific_claims": claims.len(),
            "unsupported_ratio": unsupported_ratio,
            "retrieval_artifact_ids": retrieval.iter().map(|item| item.artifact_id.clone()).collect::<Vec<_>>()
        }),
    })
}

fn detect_hallucination_contradiction(spans: &[Span], artifacts: &[Artifact]) -> Option<Detection> {
    let final_output = extract_final_output(spans, artifacts)?;
    let output_lower = final_output.text.to_lowercase();

    let contains_no_data_claim = [
        "no data",
        "no records",
        "not found",
        "none found",
        "empty result",
    ]
    .iter()
    .any(|needle| output_lower.contains(needle));
    if !contains_no_data_claim {
        return None;
    }

    let retrieval = collect_retrieval_outputs(artifacts);
    let has_non_empty_retrieval = retrieval
        .iter()
        .any(|item| item.doc_count > 0 || item.text.len() >= 60);
    let has_non_empty_tools = collect_support_outputs(artifacts)
        .iter()
        .any(|text| contains_positive_data_signal(text));
    if !(has_non_empty_retrieval || has_non_empty_tools) {
        return None;
    }

    Some(Detection {
        failure_type: "HALLUCINATION_CONTRADICTION",
        confidence: 0.89,
        summary: "Final response contradicts upstream data presence (claims no data while evidence exists).".to_string(),
        span_count: final_output.span_id.as_ref().map(|_| 1).unwrap_or(0),
        affected_spans: final_output.span_id.clone().into_iter().collect(),
        evidence: json!({
            "final_output_artifact_id": final_output.artifact_id,
            "contradiction": "output_claims_no_data_but_upstream_contains_data",
            "retrieval_artifact_ids": retrieval.iter().map(|item| item.artifact_id.clone()).collect::<Vec<_>>(),
            "retrieval_doc_counts": retrieval.iter().map(|item| item.doc_count).collect::<Vec<_>>(),
            "tool_data_present": has_non_empty_tools
        }),
    })
}

fn detect_hallucination_fabricated_citation(
    spans: &[Span],
    artifacts: &[Artifact],
) -> Option<Detection> {
    let final_output = extract_final_output(spans, artifacts)?;
    let cited_urls = extract_urls(&final_output.text);
    let citation_markers = count_citation_markers(&final_output.text);

    let retrieval = collect_retrieval_outputs(artifacts);
    let support_urls = collect_all_urls_from_artifacts(artifacts);
    let fabricated_urls = cited_urls
        .iter()
        .filter(|url| !support_urls.contains(url.as_str()))
        .cloned()
        .collect::<Vec<_>>();

    let has_fabricated_markers = citation_markers > 0 && retrieval.is_empty();
    if fabricated_urls.is_empty() && !has_fabricated_markers {
        return None;
    }

    Some(Detection {
        failure_type: "HALLUCINATION_FABRICATED_CITATION",
        confidence: if !fabricated_urls.is_empty() {
            0.93
        } else {
            0.84
        },
        summary:
            "Final response references citations or URLs not present in run context artifacts."
                .to_string(),
        span_count: final_output.span_id.as_ref().map(|_| 1).unwrap_or(0),
        affected_spans: final_output.span_id.clone().into_iter().collect(),
        evidence: json!({
            "final_output_artifact_id": final_output.artifact_id,
            "fabricated_urls": fabricated_urls,
            "citation_marker_count": citation_markers,
            "known_context_urls": support_urls
        }),
    })
}

fn detect_hallucination_insufficient_retrieval(
    spans: &[Span],
    artifacts: &[Artifact],
) -> Option<Detection> {
    let final_output = extract_final_output(spans, artifacts)?;
    if !is_detailed_factual_answer(&final_output.text) {
        return None;
    }

    let retrieval = collect_retrieval_outputs(artifacts);
    let retrieval_doc_count = retrieval.iter().map(|item| item.doc_count).sum::<usize>();
    let retrieval_chars = retrieval.iter().map(|item| item.text.len()).sum::<usize>();
    let retrieval_weak = retrieval_doc_count == 0 || retrieval_chars < 120;
    if !retrieval_weak {
        return None;
    }

    Some(Detection {
        failure_type: "HALLUCINATION_INSUFFICIENT_RETRIEVAL",
        confidence: if retrieval_doc_count == 0 { 0.91 } else { 0.82 },
        summary:
            "Retrieval evidence is empty/weak while final output provides detailed factual content."
                .to_string(),
        span_count: final_output.span_id.as_ref().map(|_| 1).unwrap_or(0),
        affected_spans: final_output.span_id.clone().into_iter().collect(),
        evidence: json!({
            "final_output_artifact_id": final_output.artifact_id,
            "retrieval_doc_count": retrieval_doc_count,
            "retrieval_total_chars": retrieval_chars,
            "retrieval_artifact_ids": retrieval.iter().map(|item| item.artifact_id.clone()).collect::<Vec<_>>(),
            "retrieval_span_ids": retrieval.iter().filter_map(|item| item.span_id.clone()).collect::<Vec<_>>()
        }),
    })
}

fn detect_hallucination_overconfident_inference(
    spans: &[Span],
    artifacts: &[Artifact],
) -> Option<Detection> {
    let final_output = extract_final_output(spans, artifacts)?;
    let certainty_markers = extract_certainty_markers(&final_output.text);
    if certainty_markers.is_empty() {
        return None;
    }

    let retrieval = collect_retrieval_outputs(artifacts);
    let support = collect_support_outputs(artifacts).join(" ").to_lowercase();
    let claims = extract_specific_claims(&final_output.text);
    let unsupported_count = claims
        .iter()
        .filter(|claim| !support.contains(claim.as_str()))
        .count();
    let weak_coverage = claims.is_empty()
        || (unsupported_count as f64 / claims.len().max(1) as f64) > 0.3
        || retrieval.is_empty();
    if !weak_coverage {
        return None;
    }

    Some(Detection {
        failure_type: "HALLUCINATION_OVERCONFIDENT_INFERENCE",
        confidence: (0.74 + (certainty_markers.len().min(6) as f64 * 0.03)).clamp(0.74, 0.92),
        summary: "Final response uses high-certainty language despite weak evidence coverage."
            .to_string(),
        span_count: final_output.span_id.as_ref().map(|_| 1).unwrap_or(0),
        affected_spans: final_output.span_id.clone().into_iter().collect(),
        evidence: json!({
            "final_output_artifact_id": final_output.artifact_id,
            "certainty_markers": certainty_markers,
            "claim_count": claims.len(),
            "unsupported_claim_count": unsupported_count,
            "retrieval_artifact_count": retrieval.len()
        }),
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

fn extract_final_output(spans: &[Span], artifacts: &[Artifact]) -> Option<FinalOutputSnapshot> {
    let span_index = spans
        .iter()
        .enumerate()
        .map(|(idx, span)| (span.id.clone(), idx))
        .collect::<HashMap<_, _>>();
    artifacts
        .iter()
        .filter(|artifact| artifact.kind == "llm.response")
        .filter_map(|artifact| {
            extract_text_from_payload(&artifact.payload).map(|text| {
                let order = artifact
                    .span_id
                    .as_ref()
                    .and_then(|id| span_index.get(id))
                    .copied()
                    .unwrap_or(0);
                (order, artifact, text)
            })
        })
        .max_by_key(|(order, _, _)| *order)
        .map(|(_, artifact, text)| FinalOutputSnapshot {
            text,
            span_id: artifact.span_id.clone(),
            artifact_id: artifact.id.clone(),
        })
}

fn collect_retrieval_outputs(artifacts: &[Artifact]) -> Vec<RetrievalSnapshot> {
    artifacts
        .iter()
        .filter(|artifact| is_retrieval_artifact(artifact))
        .map(|artifact| {
            let text = extract_text_from_payload(&artifact.payload).unwrap_or_default();
            let doc_count = infer_doc_count(&artifact.payload);
            RetrievalSnapshot {
                artifact_id: artifact.id.clone(),
                span_id: artifact.span_id.clone(),
                text,
                doc_count,
            }
        })
        .collect::<Vec<_>>()
}

fn collect_support_outputs(artifacts: &[Artifact]) -> Vec<String> {
    artifacts
        .iter()
        .filter(|artifact| {
            artifact.kind == "tool.output"
                || artifact.kind == "file.content"
                || artifact.kind == "command.stdout"
                || artifact.kind == "command.stderr"
                || artifact.kind == "validator.output"
                || is_retrieval_artifact(artifact)
        })
        .filter_map(|artifact| extract_text_from_payload(&artifact.payload))
        .collect::<Vec<_>>()
}

fn is_retrieval_artifact(artifact: &Artifact) -> bool {
    let kind = artifact.kind.to_lowercase();
    kind.contains("retriev")
        || kind == "llm.context"
        || artifact
            .payload
            .as_object()
            .is_some_and(|obj| obj.contains_key("documents") || obj.contains_key("chunks"))
}

fn extract_text_from_payload(payload: &Value) -> Option<String> {
    if let Some(text) = payload.as_str() {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    if let Some(obj) = payload.as_object() {
        for key in ["text", "content", "output", "response", "answer", "message"] {
            if let Some(value) = obj.get(key).and_then(extract_text_from_payload) {
                return Some(value);
            }
        }
    }

    if let Some(arr) = payload.as_array() {
        let parts = arr
            .iter()
            .filter_map(extract_text_from_payload)
            .collect::<Vec<_>>();
        if !parts.is_empty() {
            return Some(parts.join(" "));
        }
    }

    None
}

fn infer_doc_count(payload: &Value) -> usize {
    payload
        .get("documents")
        .and_then(Value::as_array)
        .map(|docs| docs.len())
        .or_else(|| {
            payload
                .get("chunks")
                .and_then(Value::as_array)
                .map(|chunks| chunks.len())
        })
        .or_else(|| {
            payload
                .get("results")
                .and_then(Value::as_array)
                .map(|results| results.len())
        })
        .unwrap_or(0)
}

fn extract_specific_claims(text: &str) -> Vec<String> {
    let lower = text.to_lowercase();
    let mut claims = Vec::<String>::new();

    for token in lower.split_whitespace() {
        let cleaned = token.trim_matches(|ch: char| {
            !ch.is_ascii_alphanumeric() && ch != '/' && ch != '-' && ch != '.'
        });
        if cleaned.len() >= 4 && looks_specific_token(cleaned) {
            claims.push(cleaned.to_string());
        }
    }
    claims.sort();
    claims.dedup();
    claims
}

fn looks_specific_token(token: &str) -> bool {
    let has_digit = token.chars().any(|ch| ch.is_ascii_digit());
    let has_dash = token.contains('-') || token.contains('/');
    let has_dot = token.contains('.');
    let is_common_word = COMMON_TERMS.iter().any(|value| *value == token);
    (has_digit || has_dash || has_dot) && !is_common_word
}

fn contains_positive_data_signal(text: &str) -> bool {
    let lower = text.to_lowercase();
    lower.contains("\"count\":")
        || lower.contains("count")
            && lower
                .split(|ch: char| !ch.is_ascii_digit())
                .any(|segment| segment.parse::<i64>().is_ok_and(|value| value > 0))
        || lower.contains("[{")
        || lower.contains("rows")
}

fn extract_urls(text: &str) -> Vec<String> {
    text.split_whitespace()
        .filter_map(|token| {
            let cleaned = token.trim_matches(|ch: char| {
                !ch.is_ascii_alphanumeric()
                    && ch != ':'
                    && ch != '/'
                    && ch != '.'
                    && ch != '-'
                    && ch != '?'
                    && ch != '='
                    && ch != '&'
                    && ch != '#'
            });
            if cleaned.starts_with("http://") || cleaned.starts_with("https://") {
                Some(cleaned.to_lowercase())
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
}

fn collect_all_urls_from_artifacts(artifacts: &[Artifact]) -> HashSet<String> {
    let mut urls = HashSet::new();
    for artifact in artifacts {
        if let Some(text) = extract_text_from_payload(&artifact.payload) {
            for url in extract_urls(&text) {
                urls.insert(url);
            }
        }
    }
    urls
}

fn count_citation_markers(text: &str) -> usize {
    let lower = text.to_lowercase();
    let bracket_markers = text.matches('[').count().min(text.matches(']').count());
    let source_markers = ["source:", "sources:", "citation", "according to", "ref:"]
        .iter()
        .filter(|needle| lower.contains(**needle))
        .count();
    bracket_markers + source_markers
}

fn is_detailed_factual_answer(text: &str) -> bool {
    if text.len() < 180 {
        return false;
    }
    let digits = text.chars().filter(|ch| ch.is_ascii_digit()).count();
    let sentences = text.matches('.').count() + text.matches(';').count();
    digits >= 3 || sentences >= 3
}

fn extract_certainty_markers(text: &str) -> Vec<String> {
    let lower = text.to_lowercase();
    CERTAINTY_TERMS
        .iter()
        .filter(|term| lower.contains(**term))
        .map(|term| (*term).to_string())
        .collect::<Vec<_>>()
}

const CERTAINTY_TERMS: &[&str] = &[
    "definitely",
    "certainly",
    "without doubt",
    "always",
    "never",
    "clearly",
    "proves",
    "confirmed",
    "undeniably",
];

const COMMON_TERMS: &[&str] = &[
    "this", "that", "with", "from", "have", "been", "were", "what", "when", "where", "which",
    "will", "would", "there", "their", "them", "then", "than", "into", "over", "under", "about",
    "also", "such", "many", "some", "your", "they", "because", "while", "should", "could",
];

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
            let source_type = object
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
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

    [
        "json",
        "schema",
        "format",
        "must output",
        "respond with",
        "structured",
    ]
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
