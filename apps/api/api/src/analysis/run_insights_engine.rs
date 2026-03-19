use std::collections::HashMap;
use std::hash::{Hash, Hasher};

use agentscope_common::errors::AgentScopeError;
use agentscope_storage::Storage;
use agentscope_trace::{Run, RunInsight, Span};
use chrono::Utc;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::analysis::{
    classifiers::{classify_root_cause, Classification},
    detectors::{detect_failure_types, estimate_context_window, Detection},
};

const RECENT_RUN_LIMIT: i64 = 50;
const SLOW_AVG_LATENCY_MS: i64 = 8_000;
const COST_REGRESSION_MULTIPLIER: f64 = 1.5;
const MIN_COST_REGRESSION_ABS: f64 = 0.01;
const HIGH_RETRY_RATE: f64 = 0.2;
const LARGE_PROMPT_TOKENS: i64 = 100_000;
const PROMPT_REGRESSION_MIN_SAMPLES: usize = 2;

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
            message: root_cause.message.clone(),
            recommendation: root_cause.suggested_fix.clone(),
            created_at: Utc::now(),
            evidence: root_cause.evidence.clone(),
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

    if insights.is_empty() {
        insights.push(RunInsight {
            id: deterministic_insight_id(run_id, "NO_MAJOR_ISSUES", "NO_MAJOR_ISSUES"),
            run_id: run_id.to_string(),
            insight_type: "NO_MAJOR_ISSUES".to_string(),
            severity: "low".to_string(),
            message: "No strong failure, latency, cost, or prompt-regression issues were detected."
                .to_string(),
            recommendation: "Continue collecting traces and compare against future baselines."
                .to_string(),
            created_at: Utc::now(),
            evidence: json!({}),
            impact_score: 0.0,
        });
    }

    for insight in &mut insights {
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
        message: root_cause.summary.clone(),
        recommendation,
        created_at: Utc::now(),
        evidence: json!({
            "root_cause_category": root_cause.root_cause_category,
            "suggested_fixes": root_cause.suggested_fixes,
            "evidence": root_cause.evidence
        }),
        impact_score: 0.0,
    }
}

pub fn build_run_failure_insight(run: &Run) -> RunInsight {
    RunInsight {
        id: deterministic_insight_id(&run.id, "RUN_FAILURE", &run.status),
        run_id: run.id.clone(),
        insight_type: "RUN_FAILURE".to_string(),
        severity: "high".to_string(),
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
        impact_score: 0.0,
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
        _ => "Inspect span and artifact evidence and patch the failing step.",
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
