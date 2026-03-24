use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};

use agentscope_common::errors::AgentScopeError;
use agentscope_storage::Storage;
use agentscope_trace::{
    Artifact, FixSuggestion, Run, RunInsight, RunRootCause, Span, StepTransition,
};
use chrono::Utc;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::analysis::{
    classifiers::{classify_root_cause, Classification},
    context_analyzer::{
        analyze_context, extract_context_data, final_prompt_to_text, parse_context_sources,
    },
    detectors::{detect_failure_types, estimate_context_window, Detection},
    step_transition::build_step_transitions_with_causes,
};

const RECENT_RUN_LIMIT: i64 = 50;
const SLOW_AVG_LATENCY_MS: i64 = 8_000;
const COST_REGRESSION_MULTIPLIER: f64 = 1.5;
const MIN_COST_REGRESSION_ABS: f64 = 0.01;
const HIGH_RETRY_RATE: f64 = 0.2;
const LARGE_PROMPT_TOKENS: i64 = 100_000;
const PROMPT_REGRESSION_MIN_SAMPLES: usize = 2;
const MAX_CONTEXT_INSIGHTS_PER_RUN: usize = 3;
const RUN_SUMMARY_MAX_LEN: usize = 120;

pub async fn analyze_run(
    storage: &Storage,
    run_id: &str,
) -> Result<Vec<RunInsight>, AgentScopeError> {
    let run = storage
        .get_run(run_id)
        .await?
        .ok_or_else(|| AgentScopeError::Validation(format!("run {run_id} not found")))?;
    let spans = storage.get_spans(run_id).await?;
    let artifacts = storage.get_artifacts(run_id).await?;
    let root_causes = storage.get_run_root_causes(run_id).await?;

    let detections = detect_failure_types(&spans, &artifacts);
    let transitions = build_step_transitions_with_causes(&spans, &artifacts, &detections);
    let classification = classify_root_cause(&detections);

    let recent_runs = get_recent_runs(storage, &run.project_id, RECENT_RUN_LIMIT).await?;
    let avg_cost = compute_avg_cost(&recent_runs);

    let mut insights = Vec::new();

    for detection in &detections {
        insights.push(build_detection_insight(run_id, detection, spans.len()));
    }

    if !detections.is_empty() {
        insights.push(build_root_cause_insight(run_id, &classification));
    }

    if let Some(root_cause) = root_causes.first() {
        insights.push(RunInsight {
            id: deterministic_insight_id(run_id, "ROOT_CAUSE_STORED", &root_cause.root_cause_type),
            run_id: run_id.to_string(),
            insight_type: format!("ROOT_CAUSE_{}", root_cause.root_cause_type),
            severity: if root_cause.confidence >= 0.9 {
                "high".to_string()
            } else {
                "medium".to_string()
            },
            is_primary: false,
            message: root_cause.message.clone(),
            recommendation: root_cause.suggested_fix.clone(),
            created_at: Utc::now(),
            evidence: root_cause.evidence.clone(),
            fix_suggestions: Vec::new(),
            impact_score: 0.0,
        });
    }

    if run.status == "failed" || run.status == "error" {
        insights.push(build_run_failure_insight(&run));
    }

    if let Some(latency_insight) = build_latency_insight(run_id, &spans) {
        insights.push(latency_insight);
    }

    if let Some(cost_insight) = build_cost_insight(&run, avg_cost) {
        insights.push(cost_insight);
    }

    if let Some(retry_insight) = build_retry_insight(run_id, &spans) {
        insights.push(retry_insight);
    }

    if let Some(prompt_size_insight) = build_prompt_size_insight(run_id, &spans) {
        insights.push(prompt_size_insight);
    }

    insights.extend(build_prompt_regression_insight(run_id, &spans));
    insights.extend(build_context_insights(run_id, &artifacts));
    insights.extend(build_context_runtime_insights(&run, &spans));
    insights.extend(build_instruction_insights(run_id, &spans));

    if insights.is_empty() {
        insights.push(RunInsight {
            id: deterministic_insight_id(run_id, "NO_MAJOR_ISSUES", "NO_MAJOR_ISSUES"),
            run_id: run_id.to_string(),
            insight_type: "NO_MAJOR_ISSUES".to_string(),
            severity: "low".to_string(),
            is_primary: false,
            message: "No strong failure, latency, cost, or prompt-regression issues were detected."
                .to_string(),
            recommendation: "Continue collecting traces and compare against future baselines."
                .to_string(),
            created_at: Utc::now(),
            evidence: json!({}),
            fix_suggestions: Vec::new(),
            impact_score: 0.0,
        });
    }

    let fix_suggestions = generate_fix_suggestions(&detections, &transitions, &spans);
    insights.push(generate_run_summary(
        &run,
        &spans,
        &detections,
        &root_causes,
        fix_suggestions,
    ));

    for insight in &mut insights {
        if insight.insight_type != "RUN_SUMMARY" {
            insight.is_primary = false;
        }
        insight.impact_score = compute_impact_score(insight);
    }

    sort_insights_by_impact(&mut insights);
    storage.replace_run_insights(run_id, &insights).await?;
    Ok(insights)
}

pub fn build_detection_insight(
    run_id: &str,
    detection: &Detection,
    total_spans: usize,
) -> RunInsight {
    let failure_rate = if total_spans == 0 {
        0.0
    } else {
        detection.span_count as f64 / total_spans as f64
    };
    let severity = if detection.confidence >= 0.95 || failure_rate >= 0.5 {
        "high"
    } else {
        "medium"
    };

    RunInsight {
        id: deterministic_insight_id(run_id, "DETECTION", detection.failure_type),
        run_id: run_id.to_string(),
        insight_type: detection.failure_type.to_string(),
        severity: severity.to_string(),
        is_primary: false,
        message: detection.summary.clone(),
        recommendation: recommendation_for_failure(detection.failure_type).to_string(),
        created_at: Utc::now(),
        evidence: json!({
            "failure_rate": failure_rate,
            "confidence": detection.confidence,
            "span_count": detection.span_count,
            "affected_spans": detection.affected_spans,
            "evidence": detection.evidence
        }),
        fix_suggestions: Vec::new(),
        impact_score: 0.0,
    }
}

pub fn build_root_cause_insight(run_id: &str, root_cause: &Classification) -> RunInsight {
    let recommendation = root_cause
        .suggested_fixes
        .first()
        .cloned()
        .unwrap_or_else(|| "Inspect run artifacts for targeted remediation.".to_string());

    RunInsight {
        id: deterministic_insight_id(run_id, "ROOT_CAUSE", root_cause.root_cause_category),
        run_id: run_id.to_string(),
        insight_type: root_cause.root_cause_category.to_string(),
        severity: "medium".to_string(),
        is_primary: false,
        message: root_cause.summary.clone(),
        recommendation,
        created_at: Utc::now(),
        evidence: json!({
            "root_cause_category": root_cause.root_cause_category,
            "suggested_fixes": root_cause.suggested_fixes,
            "evidence": root_cause.evidence
        }),
        fix_suggestions: Vec::new(),
        impact_score: 0.0,
    }
}

pub fn build_run_failure_insight(run: &Run) -> RunInsight {
    RunInsight {
        id: deterministic_insight_id(&run.id, "RUN_FAILURE", &run.status),
        run_id: run.id.clone(),
        insight_type: "RUN_FAILURE".to_string(),
        severity: "high".to_string(),
        is_primary: false,
        message: format!("Run ended with status `{}`.", run.status),
        recommendation:
            "Inspect failed spans first and apply the highest-confidence root-cause fix."
                .to_string(),
        created_at: Utc::now(),
        evidence: json!({
            "status": run.status,
            "started_at": run.started_at,
            "ended_at": run.ended_at
        }),
        fix_suggestions: Vec::new(),
        impact_score: 0.0,
    }
}

pub fn generate_run_summary(
    run: &Run,
    spans: &[Span],
    detections: &[Detection],
    root_causes: &[RunRootCause],
    fix_suggestions: Vec<FixSuggestion>,
) -> RunInsight {
    let is_failed = matches!(run.status.as_str(), "failed" | "error");
    let severity = if is_failed { "high" } else { "medium" };

    let message = if let Some(root_cause) = root_causes.first() {
        let qualifier = if root_cause.confidence >= 0.9 {
            "due to"
        } else {
            "likely caused by"
        };
        let cause = cause_from_root_cause_type(&root_cause.root_cause_type);
        let source = source_from_evidence(spans, Some(&root_cause.evidence), &[]);
        format_summary_sentence(is_failed, cause, qualifier, &source)
    } else if let Some(detection) = detections.first() {
        let cause = cause_from_detection_type(detection.failure_type);
        let source =
            source_from_evidence(spans, Some(&detection.evidence), &detection.affected_spans);
        format_summary_sentence(is_failed, cause, "due to", &source)
    } else if is_failed {
        "Run failed with unknown cause in execution pipeline".to_string()
    } else {
        "Run completed successfully in orchestrator".to_string()
    };

    let recommendation = if is_failed {
        "Open failing span and review insights for targeted remediation."
    } else {
        "Review insights if you need optimization opportunities."
    };

    RunInsight {
        id: deterministic_insight_id(&run.id, "RUN_SUMMARY", "PRIMARY"),
        run_id: run.id.clone(),
        insight_type: "RUN_SUMMARY".to_string(),
        severity: severity.to_string(),
        is_primary: true,
        message,
        recommendation: recommendation.to_string(),
        created_at: Utc::now(),
        evidence: json!({
            "status": run.status,
            "source": "summary_generator"
        }),
        impact_score: 1.0,
        fix_suggestions,
    }
}

fn format_summary_sentence(is_failed: bool, cause: &str, qualifier: &str, source: &str) -> String {
    let prefix = if is_failed {
        "Run failed"
    } else {
        "Run succeeded but"
    };
    clamp_summary(&format!("{prefix} {qualifier} {cause} in {source}"))
}

fn cause_from_root_cause_type(root_cause_type: &str) -> &'static str {
    match root_cause_type.to_ascii_uppercase().as_str() {
        "LLM_OUTPUT_FORMAT_ERROR" | "SCHEMA_VALIDATION_ERROR" => {
            "invalid structured output from model"
        }
        "TOOL_EXECUTION_ERROR" | "TOOL_FAILURE" => "tool execution error",
        "TIMEOUT" => "timeout in LLM call",
        "API_FAILURE" | "API_ERROR" => "upstream API error",
        "PROMPT_TOO_LARGE" | "TOKEN_OVERFLOW" => "context exceeding model limits",
        "INSTRUCTION_DRIFT" => "updated instructions",
        "INSTRUCTION_CONFLICT" => "conflicting instructions",
        "STEP_TRANSITION_ISSUE" => "step transition inconsistency",
        "STEP_TRANSITION_CAUSE" | "TRANSITION_CAUSE" => "previous step context change",
        "INSTRUCTION_OUTPUT_CONSTRAINT_MISSING" | "MISSING_OUTPUT_CONSTRAINT" => {
            "missing output validation after tool execution"
        }
        _ => "run execution error",
    }
}

fn cause_from_detection_type(failure_type: &str) -> &'static str {
    match failure_type {
        "SCHEMA_VALIDATION_ERROR" => "invalid structured output from model",
        "TOOL_FAILURE" => "tool execution error",
        "TIMEOUT" => "timeout in LLM call",
        "API_ERROR" => "upstream API error",
        "TOKEN_OVERFLOW" => "context exceeding model limits",
        "INSTRUCTION_DRIFT" => "updated instructions",
        "INSTRUCTION_CONFLICT" => "conflicting instructions",
        "STEP_TRANSITION_ISSUE" => "step transition inconsistency",
        "TRANSITION_CAUSE" => "previous step context change",
        "MISSING_OUTPUT_CONSTRAINT" => "missing output validation after tool execution",
        _ => "run execution error",
    }
}

fn source_from_evidence(
    spans: &[Span],
    evidence: Option<&Value>,
    affected_spans: &[String],
) -> String {
    let by_id = spans
        .iter()
        .map(|span| (span.id.as_str(), span))
        .collect::<HashMap<_, _>>();

    if let Some(id) = evidence
        .and_then(Value::as_object)
        .and_then(|obj| obj.get("span_id"))
        .and_then(Value::as_str)
    {
        if let Some(span) = by_id.get(id) {
            return summarize_source(span.name.as_str(), Some(span.span_type.as_str()));
        }
    }

    if let Some(id) = affected_spans.first().map(String::as_str) {
        if let Some(span) = by_id.get(id) {
            return summarize_source(span.name.as_str(), Some(span.span_type.as_str()));
        }
    }

    if let Some(name) = evidence
        .and_then(Value::as_object)
        .and_then(|obj| obj.get("span_name"))
        .and_then(Value::as_str)
    {
        return summarize_source(name, None);
    }

    if let Some(provider) = evidence
        .and_then(Value::as_object)
        .and_then(|obj| obj.get("provider"))
        .and_then(Value::as_str)
    {
        return summarize_source(provider, Some("provider"));
    }

    "orchestrator".to_string()
}

fn summarize_source(name: &str, span_type: Option<&str>) -> String {
    let mut normalized = name.trim().replace('`', "");
    if normalized.is_empty() {
        normalized = span_type.unwrap_or("orchestrator").to_string();
    }
    let normalized = normalized
        .split_whitespace()
        .take(5)
        .collect::<Vec<_>>()
        .join(" ");
    let label = if let Some(kind) = span_type {
        if kind == "llm" || kind == "llm_call" {
            format!("{normalized} LLM step")
        } else if kind == "tool_call" {
            format!("{normalized} tool_call step")
        } else {
            format!("{normalized} {kind} step")
        }
    } else {
        format!("{normalized} step")
    };
    let compact = label.trim().to_string();
    if compact.chars().count() > 34 {
        compact.chars().take(34).collect()
    } else {
        compact
    }
}

fn clamp_summary(text: &str) -> String {
    let line = text
        .replace('\n', " ")
        .replace(['.', '!', '?'], "")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if line.chars().count() <= RUN_SUMMARY_MAX_LEN {
        return line;
    }
    line.chars().take(RUN_SUMMARY_MAX_LEN).collect()
}

pub fn generate_fix_suggestions(
    detections: &[Detection],
    transitions: &HashMap<String, StepTransition>,
    spans: &[Span],
) -> Vec<FixSuggestion> {
    let mut by_key = HashMap::<String, (FixSuggestion, i32)>::new();
    let has_instruction_context = spans
        .iter()
        .any(|span| span.instruction_context.as_ref().is_some());

    for detection in detections {
        let mut candidate: Option<(FixSuggestion, i32)> = None;
        match detection.failure_type {
            "SCHEMA_VALIDATION_ERROR" => {
                candidate = Some((
                    FixSuggestion {
                        title: "Add JSON schema validation".to_string(),
                        description: "Validate tool output before passing to the next LLM call"
                            .to_string(),
                        action_type: "validation".to_string(),
                        confidence: 0.9,
                    },
                    3,
                ));
            }
            "TOOL_FAILURE" => {
                candidate = Some((
                    FixSuggestion {
                        title: "Add retry logic for tool calls".to_string(),
                        description:
                            "Retry tool execution with exponential backoff for transient errors"
                                .to_string(),
                        action_type: "retry".to_string(),
                        confidence: 0.85,
                    },
                    2,
                ));
            }
            "TIMEOUT" => {
                candidate = Some((
                    FixSuggestion {
                        title: "Reduce latency or add timeout handling".to_string(),
                        description: "Shorten prompt or add timeout + retry strategy".to_string(),
                        action_type: "config".to_string(),
                        confidence: 0.8,
                    },
                    2,
                ));
            }
            "TOKEN_OVERFLOW" => {
                candidate = Some((
                    FixSuggestion {
                        title: "Reduce context size".to_string(),
                        description:
                            "Trim messages or summarize previous steps before sending to model"
                                .to_string(),
                        action_type: "prompt".to_string(),
                        confidence: 0.9,
                    },
                    3,
                ));
            }
            "MISSING_OUTPUT_CONSTRAINT" | "INSTRUCTION_DRIFT" | "INSTRUCTION_CONFLICT" => {
                candidate = Some((
                    FixSuggestion {
                        title: "Add explicit output constraints".to_string(),
                        description: "Specify output format (e.g. JSON schema) in system prompt"
                            .to_string(),
                        action_type: "prompt".to_string(),
                        confidence: 0.85,
                    },
                    2,
                ));
            }
            "TRANSITION_CAUSE" => {
                let caused_by_tool_output = transitions.values().any(|transition| {
                    transition.likely_cause
                        && !transition.tool_outputs_added.is_empty()
                        && transition
                            .cause_reason
                            .as_deref()
                            .unwrap_or_default()
                            .to_lowercase()
                            .contains("tool output")
                });
                if caused_by_tool_output {
                    candidate = Some((
                        FixSuggestion {
                            title: "Validate tool output before reuse".to_string(),
                            description:
                                "Ensure tool responses are sanitized before injecting into context"
                                    .to_string(),
                            action_type: "validation".to_string(),
                            confidence: 0.9,
                        },
                        3,
                    ));
                }
            }
            _ => {}
        }

        if let Some((fix, severity_rank)) = candidate {
            merge_fix_candidate(&mut by_key, fix, severity_rank);
        }
    }

    if by_key.is_empty() && has_instruction_context {
        merge_fix_candidate(
            &mut by_key,
            FixSuggestion {
                title: "Add explicit output constraints".to_string(),
                description: "Specify output format (e.g. JSON schema) in system prompt"
                    .to_string(),
                action_type: "prompt".to_string(),
                confidence: 0.75,
            },
            1,
        );
    }

    let mut suggestions = by_key.into_values().collect::<Vec<_>>();
    suggestions.sort_by(|(left, left_sev), (right, right_sev)| {
        right
            .confidence
            .total_cmp(&left.confidence)
            .then_with(|| right_sev.cmp(left_sev))
            .then_with(|| left.title.cmp(&right.title))
    });

    suggestions
        .into_iter()
        .map(|(suggestion, _)| suggestion)
        .take(3)
        .collect()
}

fn merge_fix_candidate(
    by_key: &mut HashMap<String, (FixSuggestion, i32)>,
    candidate: FixSuggestion,
    severity_rank: i32,
) {
    let key = format!(
        "{}::{}",
        candidate.action_type.to_lowercase(),
        candidate.title.to_lowercase()
    );
    match by_key.get_mut(&key) {
        Some((current, current_severity)) => {
            if candidate.confidence > current.confidence {
                *current = candidate;
            }
            if severity_rank > *current_severity {
                *current_severity = severity_rank;
            }
        }
        None => {
            by_key.insert(key, (candidate, severity_rank));
        }
    }
}

pub fn build_latency_insight(run_id: &str, spans: &[Span]) -> Option<RunInsight> {
    if spans.is_empty() {
        return None;
    }

    let mut latencies = spans
        .iter()
        .map(compute_latency)
        .filter(|latency| *latency > 0)
        .collect::<Vec<_>>();
    if latencies.is_empty() {
        return None;
    }

    latencies.sort_unstable();
    let avg_latency = latencies.iter().sum::<i64>() as f64 / latencies.len() as f64;
    let p95_index = ((latencies.len() as f64 * 0.95).ceil() as usize).saturating_sub(1);
    let p95_latency = latencies[p95_index];

    if avg_latency < SLOW_AVG_LATENCY_MS as f64 && p95_latency < SLOW_AVG_LATENCY_MS {
        return None;
    }

    Some(RunInsight {
        id: deterministic_insight_id(run_id, "LATENCY", "PERFORMANCE_SLOW_SPAN"),
        run_id: run_id.to_string(),
        insight_type: "PERFORMANCE_SLOW_SPAN".to_string(),
        severity: if p95_latency >= 15_000 {
            "high".to_string()
        } else {
            "medium".to_string()
        },
        is_primary: false,
        message: format!(
            "Latency is elevated (avg {:.0} ms, p95 {} ms).",
            avg_latency, p95_latency
        ),
        recommendation: "Profile slow spans and reduce model/tool work on critical paths."
            .to_string(),
        created_at: Utc::now(),
        evidence: json!({
            "avg_latency_ms": avg_latency,
            "p95_latency_ms": p95_latency,
            "sample_size": latencies.len()
        }),
        fix_suggestions: Vec::new(),
        impact_score: 0.0,
    })
}

pub fn build_cost_insight(run: &Run, baseline_cost: f32) -> Option<RunInsight> {
    let run_cost = run.total_cost_usd;
    if run_cost <= 0.0 {
        return None;
    }

    let threshold =
        (baseline_cost as f64 * COST_REGRESSION_MULTIPLIER).max(MIN_COST_REGRESSION_ABS);
    if run_cost < threshold {
        return None;
    }

    Some(RunInsight {
        id: deterministic_insight_id(&run.id, "COST", "COST_REGRESSION"),
        run_id: run.id.clone(),
        insight_type: "COST_REGRESSION".to_string(),
        severity: if baseline_cost > 0.0 && run_cost >= baseline_cost as f64 * 2.0 {
            "high".to_string()
        } else {
            "medium".to_string()
        },
        is_primary: false,
        message: format!(
            "Run cost (${run_cost:.5}) is above baseline (${:.5}).",
            baseline_cost
        ),
        recommendation:
            "Route low-complexity tasks to cheaper models and trim unnecessary token usage."
                .to_string(),
        created_at: Utc::now(),
        evidence: json!({
            "run_cost_usd": run_cost,
            "baseline_cost_usd": baseline_cost,
            "regression_multiplier": if baseline_cost > 0.0 {
                Value::from(run_cost / baseline_cost as f64)
            } else {
                Value::Null
            }
        }),
        fix_suggestions: Vec::new(),
        impact_score: 0.0,
    })
}

pub fn build_retry_insight(run_id: &str, spans: &[Span]) -> Option<RunInsight> {
    if spans.is_empty() {
        return None;
    }

    let retry_spans = spans
        .iter()
        .filter(|span| span.retry_attempt.unwrap_or_default() > 0)
        .collect::<Vec<_>>();
    if retry_spans.is_empty() {
        return None;
    }

    let retry_rate = retry_spans.len() as f64 / spans.len() as f64;
    if retry_rate < HIGH_RETRY_RATE {
        return None;
    }

    Some(RunInsight {
        id: deterministic_insight_id(run_id, "RETRY", "HIGH_RETRY_RATE"),
        run_id: run_id.to_string(),
        insight_type: "HIGH_RETRY_RATE".to_string(),
        severity: if retry_rate >= 0.4 {
            "high".to_string()
        } else {
            "medium".to_string()
        },
        is_primary: false,
        message: format!(
            "Retries are frequent: {} of {} spans retried ({:.1}%).",
            retry_spans.len(),
            spans.len(),
            retry_rate * 100.0
        ),
        recommendation: "Stabilize flaky dependencies and reserve retries for transient failures."
            .to_string(),
        created_at: Utc::now(),
        evidence: json!({
            "retry_count": retry_spans.len(),
            "total_spans": spans.len(),
            "retry_rate": retry_rate,
            "affected_spans": retry_spans.iter().map(|span| span.id.clone()).collect::<Vec<_>>()
        }),
        fix_suggestions: Vec::new(),
        impact_score: 0.0,
    })
}

pub fn build_prompt_size_insight(run_id: &str, spans: &[Span]) -> Option<RunInsight> {
    let largest = spans
        .iter()
        .filter_map(|span| span.input_tokens.map(|tokens| (span, tokens)))
        .max_by_key(|(_, tokens)| *tokens)?;

    let (span, input_tokens) = largest;
    let model = span.model.clone().unwrap_or_else(|| "unknown".to_string());
    let context_window = estimate_context_window(&model);
    let near_limit =
        context_window.is_some_and(|window| (input_tokens as f64) >= (window as f64 * 0.8));

    if input_tokens < LARGE_PROMPT_TOKENS && !near_limit {
        return None;
    }

    Some(RunInsight {
        id: deterministic_insight_id(run_id, "PROMPT_SIZE", "PROMPT_TOO_LARGE"),
        run_id: run_id.to_string(),
        insight_type: "PROMPT_TOO_LARGE".to_string(),
        severity: if context_window.is_some_and(|window| input_tokens > window) {
            "high".to_string()
        } else {
            "medium".to_string()
        },
        is_primary: false,
        message: format!("Largest prompt used {input_tokens} input tokens on model `{model}`."),
        recommendation: "Summarize context and drop low-value prompt sections before model calls."
            .to_string(),
        created_at: Utc::now(),
        evidence: json!({
            "span_id": span.id,
            "model": model,
            "input_tokens": input_tokens,
            "estimated_context_window": context_window
        }),
        fix_suggestions: Vec::new(),
        impact_score: 0.0,
    })
}

pub fn build_prompt_regression_insight(run_id: &str, spans: &[Span]) -> Vec<RunInsight> {
    let grouped = group_by_prompt_hash(spans);
    let mut insights = Vec::new();

    for (prompt_hash, prompt_spans) in grouped {
        if prompt_spans.len() < PROMPT_REGRESSION_MIN_SAMPLES {
            continue;
        }

        let success_rate = compute_span_success_rate(&prompt_spans);
        let avg_latency = prompt_spans
            .iter()
            .map(compute_latency)
            .filter(|latency| *latency > 0)
            .sum::<i64>() as f64
            / prompt_spans.len() as f64;

        if success_rate >= 0.7 && avg_latency < SLOW_AVG_LATENCY_MS as f64 {
            continue;
        }

        insights.push(RunInsight {
            id: deterministic_insight_id(run_id, "PROMPT_REGRESSION", &prompt_hash),
            run_id: run_id.to_string(),
            insight_type: "PROMPT_REGRESSION".to_string(),
            severity: if success_rate < 0.5 { "high" } else { "medium" }.to_string(),
            is_primary: false,
            message: format!(
                "Prompt hash `{prompt_hash}` shows regression (success {:.1}%, avg latency {:.0} ms).",
                success_rate * 100.0,
                avg_latency
            ),
            recommendation:
                "Review this prompt template revision and compare it with previous successful variants."
                    .to_string(),
            created_at: Utc::now(),
            evidence: json!({
                "prompt_hash": prompt_hash,
                "sample_size": prompt_spans.len(),
                "success_rate": success_rate,
                "avg_latency_ms": avg_latency,
                "span_ids": prompt_spans.iter().map(|span| span.id.clone()).collect::<Vec<_>>()
            }),
            fix_suggestions: Vec::new(),
            impact_score: 0.0,
        });
    }

    insights
}

pub async fn get_recent_runs(
    storage: &Storage,
    project_id: &str,
    limit: i64,
) -> Result<Vec<Run>, AgentScopeError> {
    storage
        .list_recent_runs_for_project(project_id, limit)
        .await
}

pub fn compute_avg_latency(runs: &[Run]) -> f32 {
    let values = runs
        .iter()
        .filter_map(|run| run.avg_latency_ms.map(|value| value as f32))
        .filter(|value| *value > 0.0)
        .collect::<Vec<_>>();
    if values.is_empty() {
        return 0.0;
    }
    values.iter().sum::<f32>() / values.len() as f32
}

pub fn compute_avg_cost(runs: &[Run]) -> f32 {
    if runs.is_empty() {
        return 0.0;
    }
    (runs.iter().map(|run| run.total_cost_usd).sum::<f64>() / runs.len() as f64) as f32
}

pub fn compute_success_rate(runs: &[Run]) -> f32 {
    if runs.is_empty() {
        return 0.0;
    }
    let success_count = runs
        .iter()
        .filter(|run| run.status == "completed" || run.success == Some(true))
        .count();
    success_count as f32 / runs.len() as f32
}

pub fn group_by_prompt_hash(spans: &[Span]) -> HashMap<String, Vec<Span>> {
    let mut grouped = HashMap::<String, Vec<Span>>::new();
    for span in spans.iter().filter(|span| span.prompt_hash.is_some()) {
        if let Some(prompt_hash) = &span.prompt_hash {
            grouped
                .entry(prompt_hash.clone())
                .or_default()
                .push(span.clone());
        }
    }
    grouped
}

pub fn compute_span_success_rate(spans: &[Span]) -> f32 {
    if spans.is_empty() {
        return 0.0;
    }
    let success_count = spans
        .iter()
        .filter(|span| {
            span.status == "ok" || span.status == "completed" || span.success == Some(true)
        })
        .count();
    success_count as f32 / spans.len() as f32
}

pub fn compute_latency(span: &Span) -> i64 {
    if let Some(latency_ms) = span.latency_ms {
        return latency_ms as i64;
    }
    span.ended_at
        .map(|ended_at| (ended_at - span.started_at).num_milliseconds())
        .unwrap_or(0)
}

pub fn compute_impact_score(insight: &RunInsight) -> f32 {
    let severity_score = match insight.severity.as_str() {
        "high" => 0.85,
        "medium" => 0.6,
        _ => 0.35,
    };

    let type_score = if insight.insight_type.contains("RUN_FAILURE")
        || insight.insight_type.contains("ROOT_CAUSE")
    {
        0.2
    } else if insight.insight_type.contains("PROMPT")
        || insight.insight_type.contains("COST")
        || insight.insight_type.contains("LATENCY")
    {
        0.15
    } else {
        0.1
    };

    let evidence_score = insight
        .evidence
        .as_object()
        .map_or(0.0, |obj| (obj.len().min(8) as f32 / 8.0) * 0.1);

    (severity_score + type_score + evidence_score).clamp(0.0, 1.0)
}

pub fn sort_insights_by_impact(insights: &mut [RunInsight]) {
    insights.sort_by(|left, right| {
        right
            .impact_score
            .total_cmp(&left.impact_score)
            .then_with(|| left.insight_type.cmp(&right.insight_type))
            .then_with(|| left.message.cmp(&right.message))
    });
}

fn recommendation_for_failure(failure_type: &str) -> &'static str {
    match failure_type {
        "SCHEMA_VALIDATION_ERROR" => {
            "Enforce strict output schemas and validate model output before downstream use."
        }
        "TOOL_FAILURE" => "Validate tool arguments and add retries for transient failures.",
        "TIMEOUT" => "Set tighter execution budgets and add bounded retry logic.",
        "API_ERROR" => "Handle rate limits and upstream failures with backoff and fallback.",
        "TOKEN_OVERFLOW" => "Reduce prompt context and truncate low-signal content.",
        "INSTRUCTION_DRIFT" => "Stabilize instruction bundles and avoid untracked mid-run instruction changes.",
        "MISSING_OUTPUT_CONSTRAINT" => {
            "Add strict output-format constraints and validate output against the required schema."
        }
        "INSTRUCTION_CONFLICT" => {
            "Resolve contradictory instruction sources and keep a single canonical instruction set."
        }
        "STEP_TRANSITION_ISSUE" => {
            "Inspect the previous step transition, remove noisy context/tool output, and keep only required messages."
        }
        "TRANSITION_CAUSE" => {
            "Validate and sanitize previous-step context before injecting it into the failing step."
        }
        _ => "Inspect span and artifact evidence and patch the failing step.",
    }
}

fn build_context_insights(run_id: &str, artifacts: &[Artifact]) -> Vec<RunInsight> {
    let context_artifacts = artifacts
        .iter()
        .filter(|artifact| artifact.kind == "llm.context")
        .collect::<Vec<_>>();

    let mut by_type = HashMap::<String, RunInsight>::new();
    if context_artifacts.is_empty() {
        for insight in analyze_context(&[], "") {
            let key = insight.insight_type.clone();
            by_type.insert(
                key.clone(),
                RunInsight {
                    id: deterministic_insight_id(run_id, "CONTEXT", &key),
                    run_id: run_id.to_string(),
                    insight_type: key,
                    severity: insight.severity,
                    is_primary: false,
                    message: insight.message,
                    recommendation: insight.recommendation,
                    created_at: Utc::now(),
                    evidence: insight.evidence,
                    fix_suggestions: Vec::new(),
                    impact_score: 0.0,
                },
            );
        }
    } else {
        for artifact in context_artifacts {
            let data = extract_context_data(&artifact.payload);
            let sources = parse_context_sources(data.get("sources"));
            let final_prompt_text = final_prompt_to_text(data.get("final_prompt"));
            let total_context_chars = sources
                .iter()
                .map(|source| source.content.chars().count())
                .sum::<usize>();

            for insight in analyze_context(&sources, &final_prompt_text) {
                let key = insight.insight_type.clone();
                let run_insight = RunInsight {
                    id: deterministic_insight_id(run_id, "CONTEXT", &key),
                    run_id: run_id.to_string(),
                    insight_type: key.clone(),
                    severity: insight.severity,
                    is_primary: false,
                    message: insight.message,
                    recommendation: insight.recommendation,
                    created_at: Utc::now(),
                    evidence: json!({
                        "artifact_id": artifact.id,
                        "span_id": artifact.span_id,
                        "source_count": sources.len(),
                        "total_context_chars": total_context_chars,
                        "final_prompt_chars": final_prompt_text.chars().count(),
                        "details": insight.evidence
                    }),
                    fix_suggestions: Vec::new(),
                    impact_score: 0.0,
                };
                match by_type.get(&key) {
                    Some(current)
                        if severity_rank(current.severity.as_str())
                            >= severity_rank(run_insight.severity.as_str()) => {}
                    _ => {
                        by_type.insert(key, run_insight);
                    }
                }
            }
        }
    }

    let mut insights = by_type.into_values().collect::<Vec<_>>();
    insights.sort_by(|left, right| {
        severity_rank(right.severity.as_str())
            .cmp(&severity_rank(left.severity.as_str()))
            .then_with(|| left.insight_type.cmp(&right.insight_type))
    });
    insights.truncate(MAX_CONTEXT_INSIGHTS_PER_RUN);
    insights
}

fn build_context_runtime_insights(run: &Run, spans: &[Span]) -> Vec<RunInsight> {
    let mut insights = Vec::new();

    let largest_usage_span = spans
        .iter()
        .filter_map(|span| span.context_usage_percent.map(|usage| (span, usage)))
        .max_by(|(_, left), (_, right)| left.total_cmp(right));
    if let Some((span, usage)) = largest_usage_span {
        if usage >= 80.0 {
            insights.push(RunInsight {
                id: deterministic_insight_id(&run.id, "CONTEXT_RUNTIME", "CONTEXT_TOO_LARGE"),
                run_id: run.id.clone(),
                insight_type: "CONTEXT_TOO_LARGE".to_string(),
                severity: if usage >= 95.0 { "high" } else { "medium" }.to_string(),
                is_primary: false,
                message: "Context too large".to_string(),
                recommendation: "Trim messages/variables or summarize context before model calls."
                    .to_string(),
                created_at: Utc::now(),
                evidence: json!({
                    "span_id": span.id,
                    "context_usage_percent": usage,
                    "context_tokens": span.context_tokens,
                    "context_window": span.context_window
                }),
                fix_suggestions: Vec::new(),
                impact_score: 0.0,
            });
        }
    }

    let truncated_span = spans.iter().find(|span| {
        span.context
            .as_ref()
            .and_then(|context| context.get("truncation"))
            .and_then(Value::as_object)
            .and_then(|truncation| truncation.get("context_shrank_unexpectedly"))
            .and_then(Value::as_bool)
            .unwrap_or(false)
    });
    if let Some(span) = truncated_span {
        insights.push(RunInsight {
            id: deterministic_insight_id(&run.id, "CONTEXT_RUNTIME", "CONTEXT_TRUNCATED"),
            run_id: run.id.clone(),
            insight_type: "CONTEXT_TRUNCATED".to_string(),
            severity: "high".to_string(),
            is_primary: false,
            message: "Context truncated".to_string(),
            recommendation:
                "Review context assembly between spans and avoid dropping required messages."
                    .to_string(),
            created_at: Utc::now(),
            evidence: json!({
                "span_id": span.id,
                "context_tokens": span.context_tokens,
                "context_usage_percent": span.context_usage_percent
            }),
            fix_suggestions: Vec::new(),
            impact_score: 0.0,
        });
    }

    let likely_failure_span = spans.iter().find(|span| {
        let span_failed =
            matches!(span.status.as_str(), "failed" | "error") || span.success == Some(false);
        if !span_failed {
            return false;
        }

        let near_limit = span
            .context_usage_percent
            .is_some_and(|value| value >= 90.0);
        let truncated = span
            .context
            .as_ref()
            .and_then(|context| context.get("truncation"))
            .and_then(Value::as_object)
            .and_then(|truncation| truncation.get("context_shrank_unexpectedly"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        near_limit || truncated
    });
    if (run.status == "failed" || run.status == "error") && likely_failure_span.is_some() {
        let span = likely_failure_span.expect("checked above");
        insights.push(RunInsight {
            id: deterministic_insight_id(
                &run.id,
                "CONTEXT_RUNTIME",
                "CONTEXT_LIKELY_CAUSED_FAILURE",
            ),
            run_id: run.id.clone(),
            insight_type: "CONTEXT_LIKELY_CAUSED_FAILURE".to_string(),
            severity: "high".to_string(),
            is_primary: false,
            message: "Context likely caused failure".to_string(),
            recommendation:
                "Reduce context pressure and validate required context continuity before call execution."
                    .to_string(),
            created_at: Utc::now(),
            evidence: json!({
                "span_id": span.id,
                "status": span.status,
                "context_usage_percent": span.context_usage_percent,
                "context_tokens": span.context_tokens
            }),
            fix_suggestions: Vec::new(),
            impact_score: 0.0,
        });
    }

    insights
}

fn build_instruction_insights(run_id: &str, spans: &[Span]) -> Vec<RunInsight> {
    let mut insights = Vec::new();
    let llm_spans = spans
        .iter()
        .filter(|span| span.span_type == "llm" || span.span_type == "llm_call")
        .collect::<Vec<_>>();

    let spans_with_sources = llm_spans
        .iter()
        .filter(|span| {
            span.instruction_context
                .as_ref()
                .and_then(|value| value.get("sources"))
                .and_then(Value::as_array)
                .is_some_and(|sources| !sources.is_empty())
        })
        .count();
    if !llm_spans.is_empty() && spans_with_sources == 0 {
        insights.push(RunInsight {
            id: deterministic_insight_id(run_id, "INSTRUCTION", "MISSING_INSTRUCTIONS"),
            run_id: run_id.to_string(),
            insight_type: "MISSING_INSTRUCTIONS".to_string(),
            severity: "medium".to_string(),
            is_primary: false,
            message: "No instruction files or runtime instruction overrides were captured.".to_string(),
            recommendation: "Load global/local instruction files (e.g., CLAUDE.md, AGENTS.md) and include explicit runtime system prompts."
                .to_string(),
            created_at: Utc::now(),
            evidence: json!({
                "llm_spans": llm_spans.len(),
                "spans_with_instruction_sources": spans_with_sources
            }),
            fix_suggestions: Vec::new(),
            impact_score: 0.0,
        });
    }

    let conflict_span = llm_spans.iter().find_map(|span| {
        let sources = span
            .instruction_context
            .as_ref()
            .and_then(|value| value.get("sources"))
            .and_then(Value::as_array)?;
        let mut hashes_by_key = HashMap::<String, HashSet<String>>::new();
        for source in sources {
            let object = source.as_object()?;
            let key = object
                .get("path")
                .and_then(Value::as_str)
                .map(|value| value.to_string())
                .unwrap_or_else(|| {
                    object
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown")
                        .to_string()
                });
            let hash = object
                .get("hash")
                .and_then(Value::as_str)
                .unwrap_or("-")
                .to_string();
            hashes_by_key.entry(key).or_default().insert(hash);
        }
        let conflicted = hashes_by_key
            .iter()
            .filter(|(_, hashes)| hashes.len() > 1)
            .map(|(key, _)| key.clone())
            .collect::<Vec<_>>();
        if conflicted.is_empty() {
            None
        } else {
            Some((span, conflicted))
        }
    });
    if let Some((span, conflicted)) = conflict_span {
        insights.push(RunInsight {
            id: deterministic_insight_id(run_id, "INSTRUCTION", "INSTRUCTION_CONFLICT"),
            run_id: run_id.to_string(),
            insight_type: "INSTRUCTION_CONFLICT".to_string(),
            severity: "high".to_string(),
            is_primary: false,
            message: "Conflicting instruction sources were detected in span context.".to_string(),
            recommendation:
                "Deduplicate instruction files and resolve conflicting overrides using a single source of truth."
                    .to_string(),
            created_at: Utc::now(),
            evidence: json!({
                "span_id": span.id,
                "conflicted_sources": conflicted
            }),
            fix_suggestions: Vec::new(),
            impact_score: 0.0,
        });
    }

    let mut instruction_signatures = llm_spans
        .iter()
        .filter_map(|span| {
            let sources = span
                .instruction_context
                .as_ref()
                .and_then(|value| value.get("sources"))
                .and_then(Value::as_array)?;
            let mut signature = sources
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
            signature.sort();
            Some((span.id.clone(), signature.join("|")))
        })
        .collect::<Vec<_>>();
    instruction_signatures.sort_by(|left, right| left.0.cmp(&right.0));

    let unique_signatures = instruction_signatures
        .iter()
        .map(|(_, signature)| signature.clone())
        .collect::<HashSet<_>>();
    if unique_signatures.len() > 1 {
        insights.push(RunInsight {
            id: deterministic_insight_id(run_id, "INSTRUCTION", "INSTRUCTION_DRIFT"),
            run_id: run_id.to_string(),
            insight_type: "INSTRUCTION_DRIFT".to_string(),
            severity: "medium".to_string(),
            is_primary: false,
            message: "Instruction stack drifted across spans in this run.".to_string(),
            recommendation:
                "Keep instruction sources stable across spans unless intentionally versioned."
                    .to_string(),
            created_at: Utc::now(),
            evidence: json!({
                "unique_instruction_signatures": unique_signatures.len(),
                "span_signatures": instruction_signatures
            }),
            fix_suggestions: Vec::new(),
            impact_score: 0.0,
        });
    }

    insights
}

fn severity_rank(severity: &str) -> i32 {
    match severity {
        "high" => 3,
        "medium" => 2,
        _ => 1,
    }
}

fn deterministic_insight_id(run_id: &str, namespace: &str, key: &str) -> String {
    let source = format!("{run_id}:{namespace}:{key}");
    let mut hasher_a = std::collections::hash_map::DefaultHasher::new();
    source.hash(&mut hasher_a);
    let a = hasher_a.finish();

    let mut hasher_b = std::collections::hash_map::DefaultHasher::new();
    format!("salt:{source}").hash(&mut hasher_b);
    let b = hasher_b.finish();

    let mut bytes = [0u8; 16];
    bytes[..8].copy_from_slice(&a.to_be_bytes());
    bytes[8..].copy_from_slice(&b.to_be_bytes());
    Uuid::from_bytes(bytes).to_string()
}
