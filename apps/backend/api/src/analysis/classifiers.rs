use std::collections::HashMap;

use agentscope_trace::{Artifact, Span};
use serde_json::{json, Value};

use crate::analysis::{
    causal_graph::{build_causal_graph, find_root_causes},
    detectors::Detection,
};

const MIN_GRAPH_CONFIDENCE: f64 = 0.2;

#[derive(Debug, Clone)]
pub struct Classification {
    pub root_cause_category: &'static str,
    pub summary: String,
    pub primary_cause: String,
    pub contributing_factors: Vec<String>,
    pub suggested_fixes: Vec<String>,
    pub evidence: serde_json::Value,
}

pub fn classify_root_cause(
    spans: &[Span],
    artifacts: &[Artifact],
    detections: &[Detection],
) -> Classification {
    let fallback = legacy_classification(detections);

    let Some(graph) = build_causal_graph(spans, artifacts, detections) else {
        return fallback;
    };

    let mut ordered = spans.iter().collect::<Vec<_>>();
    ordered.sort_by_key(|span| span.started_at);
    let span_order = ordered
        .iter()
        .enumerate()
        .map(|(index, span)| (span.id.clone(), index))
        .collect::<HashMap<_, _>>();

    let Some(root) = find_root_causes(&graph, &span_order) else {
        return fallback;
    };

    if root.confidence_score < MIN_GRAPH_CONFIDENCE || root.causal_chain.len() < 2 {
        return fallback;
    }

    let category = category_from_failure_type(&root.root_cause_type);
    let primary_cause = root.root_cause_type.clone();

    let contributing_factors = root
        .contributing_nodes
        .iter()
        .skip(1)
        .take(4)
        .map(|(span_id, _)| {
            graph
                .nodes
                .get(span_id)
                .and_then(primary_detection_type)
                .unwrap_or_else(|| "CONTRIBUTING_SPAN".to_string())
        })
        .collect::<Vec<_>>();

    let summary = format!(
        "Failure occurred at {} due to {} introduced in previous steps (chain length: {}).",
        root.failure_span,
        normalize_failure_label(&root.root_cause_type),
        root.causal_chain.len()
    );

    let suggested_fixes = build_fixes(&primary_cause, &contributing_factors);

    let evidence = json!({
        "root_cause_span": root.root_cause_span,
        "root_cause_type": root.root_cause_type,
        "causal_chain": root.causal_chain,
        "contributing_nodes": root
            .contributing_nodes
            .iter()
            .map(|(span_id, score)| {
                json!({
                    "span_id": span_id,
                    "score": score,
                    "node_type": graph
                        .nodes
                        .get(span_id)
                        .map(|node| node.span_type.clone())
                        .unwrap_or_default(),
                    "status": graph
                        .nodes
                        .get(span_id)
                        .map(|node| node.status.clone())
                        .unwrap_or_default(),
                })
            })
            .collect::<Vec<Value>>(),
        "confidence_score": root.confidence_score,
        "downstream_failure_type": root.downstream_failure_type,
        "graph": {
            "nodes": graph
                .nodes
                .values()
                .map(|node| {
                    json!({
                        "span_id": node.span_id,
                        "span_type": node.span_type,
                        "status": node.status,
                        "detections": node
                            .detections
                            .iter()
                            .map(|detection| {
                                json!({
                                    "failure_type": detection.failure_type,
                                    "confidence": detection.confidence,
                                    "summary": detection.summary,
                                })
                            })
                            .collect::<Vec<Value>>()
                    })
                })
                .collect::<Vec<Value>>(),
            "edges": graph
                .edges
                .iter()
                .map(|edge| {
                    json!({
                        "from": edge.from,
                        "to": edge.to,
                        "weight": edge.weight,
                        "reason": edge.reason,
                    })
                })
                .collect::<Vec<Value>>()
        }
    });

    Classification {
        root_cause_category: category,
        summary,
        primary_cause,
        contributing_factors,
        suggested_fixes,
        evidence,
    }
}

fn legacy_classification(detections: &[Detection]) -> Classification {
    if detections.is_empty() {
        return Classification {
            root_cause_category: "API_FAILURE",
            summary: "No specific failure pattern was detected from spans and artifacts.".to_string(),
            primary_cause: "UNKNOWN".to_string(),
            contributing_factors: Vec::new(),
            suggested_fixes: vec![
                "Capture richer error artifacts around failed LLM and tool steps.".to_string(),
                "Record provider status codes, timeout flags, and parser failures for future analysis."
                    .to_string(),
            ],
            evidence: json!({"detections": []}),
        };
    }

    let primary = detections
        .iter()
        .max_by(|left, right| left.confidence.total_cmp(&right.confidence))
        .expect("detections non-empty");

    let category = category_from_failure_type(primary.failure_type);
    let contributing_factors = detections
        .iter()
        .filter(|detection| detection.failure_type != primary.failure_type)
        .map(|detection| detection.failure_type.to_string())
        .collect::<Vec<_>>();

    Classification {
        root_cause_category: category,
        summary: primary.summary.clone(),
        primary_cause: primary.failure_type.to_string(),
        contributing_factors: contributing_factors.clone(),
        suggested_fixes: build_fixes(primary.failure_type, &contributing_factors),
        evidence: json!({
            "detections": detections
                .iter()
                .map(|detection| {
                    json!({
                        "failure_type": detection.failure_type,
                        "confidence": detection.confidence,
                        "span_count": detection.span_count,
                        "affected_spans": detection.affected_spans,
                        "summary": detection.summary,
                        "evidence": detection.evidence
                    })
                })
                .collect::<Vec<Value>>()
        }),
    }
}

fn primary_detection_type(node: &crate::analysis::causal_graph::CausalNode) -> Option<String> {
    node.detections
        .iter()
        .max_by(|left, right| left.confidence.total_cmp(&right.confidence))
        .map(|detection| detection.failure_type.to_string())
}

fn build_fixes(primary: &str, secondary: &[String]) -> Vec<String> {
    let mut fixes = fix_templates(primary)
        .into_iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>();

    for factor in secondary {
        for fix in fix_templates(factor) {
            if !fixes.iter().any(|existing| existing == fix) {
                fixes.push(fix.to_string());
            }
        }
    }

    fixes
}

fn category_from_failure_type(failure_type: &str) -> &'static str {
    match failure_type {
        "SCHEMA_VALIDATION_ERROR" => "LLM_OUTPUT_FORMAT_ERROR",
        "TOOL_FAILURE" => "TOOL_EXECUTION_ERROR",
        "TOKEN_OVERFLOW" => "PROMPT_TOO_LARGE",
        "HALLUCINATION_UNSUPPORTED_CLAIM" => "HALLUCINATION_UNSUPPORTED_CLAIM",
        "HALLUCINATION_CONTRADICTION" => "HALLUCINATION_CONTRADICTION",
        "HALLUCINATION_FABRICATED_CITATION" => "HALLUCINATION_FABRICATED_CITATION",
        "HALLUCINATION_INSUFFICIENT_RETRIEVAL" => "HALLUCINATION_INSUFFICIENT_RETRIEVAL",
        "HALLUCINATION_OVERCONFIDENT_INFERENCE" => "HALLUCINATION_OVERCONFIDENT_INFERENCE",
        "INSTRUCTION_DRIFT" => "INSTRUCTION_DRIFT",
        "TRANSITION_CAUSE" => "STEP_TRANSITION_CAUSE",
        "MISSING_OUTPUT_CONSTRAINT" => "INSTRUCTION_OUTPUT_CONSTRAINT_MISSING",
        "INSTRUCTION_CONFLICT" => "INSTRUCTION_CONFLICT",
        "TIMEOUT" => "TIMEOUT",
        "API_ERROR" => "API_FAILURE",
        _ => "API_FAILURE",
    }
}

fn normalize_failure_label(failure_type: &str) -> &'static str {
    match failure_type {
        "TOOL_FAILURE" => "tool output",
        "API_ERROR" => "upstream API error",
        "TRANSITION_CAUSE" => "step-transition context",
        "TOKEN_OVERFLOW" => "context overflow",
        "HALLUCINATION_UNSUPPORTED_CLAIM" => "unsupported factual claims",
        "HALLUCINATION_CONTRADICTION" => "contradictory claims",
        "HALLUCINATION_FABRICATED_CITATION" => "fabricated citations",
        "HALLUCINATION_INSUFFICIENT_RETRIEVAL" => "insufficient retrieval grounding",
        "HALLUCINATION_OVERCONFIDENT_INFERENCE" => "overconfident inference",
        "SCHEMA_VALIDATION_ERROR" => "invalid JSON",
        "MISSING_OUTPUT_CONSTRAINT" => "missing output constraints",
        _ => "upstream signal",
    }
}

fn fix_templates(failure_type: &str) -> Vec<&'static str> {
    match failure_type {
        "SCHEMA_VALIDATION_ERROR" => vec![
            "Strengthen output schema instructions and include strict JSON examples.",
            "Validate and repair model output before passing it downstream.",
        ],
        "TOOL_FAILURE" => vec![
            "Validate tool arguments before execution.",
            "Add retries or fallback behavior for transient tool errors.",
        ],
        "TOKEN_OVERFLOW" => vec![
            "Trim or summarize conversation history before the model call.",
            "Reduce retrieved context and cap examples injected into the prompt.",
        ],
        "HALLUCINATION_UNSUPPORTED_CLAIM"
        | "HALLUCINATION_CONTRADICTION"
        | "HALLUCINATION_FABRICATED_CITATION"
        | "HALLUCINATION_INSUFFICIENT_RETRIEVAL"
        | "HALLUCINATION_OVERCONFIDENT_INFERENCE" => vec![
            "Require citations tied to retrieved/tool evidence for factual claims.",
            "Constrain final answers to retrieved evidence and fail closed when retrieval quality is insufficient.",
            "Validate critical claims against tool or validator outputs before returning final response.",
        ],
        "INSTRUCTION_DRIFT" => vec![
            "Keep instruction files and runtime overrides consistent across spans in a run.",
            "Pin instruction hashes for stable run behavior.",
        ],
        "TRANSITION_CAUSE" => vec![
            "Validate tool output before injecting it into next-step context.",
            "Keep transition context minimal and remove noisy intermediate outputs.",
        ],
        "MISSING_OUTPUT_CONSTRAINT" => vec![
            "Add explicit output format constraints (for example strict JSON schema).",
            "Validate model output and retry with stricter constraints on failure.",
        ],
        "INSTRUCTION_CONFLICT" => vec![
            "Resolve conflicting instruction files and remove duplicate contradictory sources.",
            "Enforce precedence rules runtime > local > global with explicit audit logs.",
        ],
        "TIMEOUT" => vec![
            "Set shorter internal steps and fail fast on slow dependencies.",
            "Add retries with backoff only for idempotent operations.",
        ],
        "API_ERROR" => vec![
            "Retry transient upstream failures with backoff.",
            "Handle provider rate limits and 5xx responses explicitly.",
        ],
        _ => vec![
            "Capture richer error artifacts around failed LLM and tool steps.",
            "Inspect span and artifact evidence and patch the earliest failing step.",
        ],
    }
}
