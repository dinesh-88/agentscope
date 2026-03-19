use std::collections::HashMap;

use agentscope_common::errors::AgentScopeError;
use agentscope_storage::{analysis::TrendRunFilters, Storage};
use agentscope_trace::{
    CostMetrics, LatencyMetrics, PromptMetric, Run, Span, TrendInsight, TrendReport,
};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use uuid::Uuid;

const FAILURE_RATE_INCREASE_THRESHOLD: f64 = 0.10;
const LATENCY_REGRESSION_THRESHOLD: f64 = 0.25;
const COST_REGRESSION_THRESHOLD: f64 = 0.25;
const PROMPT_REGRESSION_THRESHOLD: f64 = 0.10;
const SLOW_SPAN_THRESHOLD_MS: f64 = 8_000.0;

#[derive(Debug, Clone)]
pub struct TrendQuery {
    pub project_id: String,
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
    pub baseline_start: DateTime<Utc>,
    pub baseline_end: DateTime<Utc>,
    pub filters: TrendRunFilters,
}

pub async fn analyze_trends(
    storage: &Storage,
    query: TrendQuery,
) -> Result<TrendReport, AgentScopeError> {
    let current_runs = get_runs_for_window(
        storage,
        &query.project_id,
        query.start,
        query.end,
        &query.filters,
    )
    .await?;
    let baseline_runs = get_baseline_runs(
        storage,
        &query.project_id,
        query.baseline_start,
        query.baseline_end,
        &query.filters,
    )
    .await?;

    let current_spans = load_spans_for_runs(storage, &current_runs).await?;
    let baseline_spans = load_spans_for_runs(storage, &baseline_runs).await?;

    let current_failure_rate = compute_failure_rate(&current_runs);
    let baseline_failure_rate = compute_failure_rate(&baseline_runs);

    let current_latency = compute_latency_metrics(&current_runs, &current_spans);
    let baseline_latency = compute_latency_metrics(&baseline_runs, &baseline_spans);

    let current_cost = compute_cost_metrics(&current_runs);
    let baseline_cost = compute_cost_metrics(&baseline_runs);

    let current_prompts = compute_prompt_metrics(&current_spans);
    let baseline_prompts = compute_prompt_metrics(&baseline_spans);

    let mut trends = Vec::new();

    if let Some(insight) = detect_failure_rate_trend(current_failure_rate, baseline_failure_rate) {
        trends.push(insight);
    }
    if let Some(insight) = detect_latency_trend(&current_latency, &baseline_latency) {
        trends.push(insight);
    }
    if let Some(insight) = detect_cost_trend(&current_cost, &baseline_cost) {
        trends.push(insight);
    }
    trends.extend(detect_prompt_regressions(
        &current_prompts,
        &baseline_prompts,
    ));
    trends.extend(detect_variant_regressions(&current_runs, &baseline_runs));

    trends.sort_by(|a, b| b.impact_score.total_cmp(&a.impact_score));

    let report = TrendReport {
        id: Uuid::new_v4().to_string(),
        project_id: query.project_id,
        window: format!(
            "current={}..{}, baseline={}..{}",
            query.start.to_rfc3339(),
            query.end.to_rfc3339(),
            query.baseline_start.to_rfc3339(),
            query.baseline_end.to_rfc3339()
        ),
        summary: summarize_trend_report(&trends),
        trends: serde_json::to_value(&trends).unwrap_or_else(|_| Value::Array(Vec::new())),
        created_at: Utc::now(),
    };

    storage.insert_trend_report(&report).await?;
    Ok(report)
}

pub async fn get_runs_for_window(
    storage: &Storage,
    project_id: &str,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    filters: &TrendRunFilters,
) -> Result<Vec<Run>, AgentScopeError> {
    storage
        .list_runs_for_window(project_id, start, end, filters)
        .await
}

pub async fn get_baseline_runs(
    storage: &Storage,
    project_id: &str,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    filters: &TrendRunFilters,
) -> Result<Vec<Run>, AgentScopeError> {
    get_runs_for_window(storage, project_id, start, end, filters).await
}

pub fn compute_failure_rate(runs: &[Run]) -> f32 {
    if runs.is_empty() {
        return 0.0;
    }
    let failures = runs
        .iter()
        .filter(|run| matches!(run.status.as_str(), "failed" | "error"))
        .count();
    failures as f32 / runs.len() as f32
}

pub fn compute_error_distribution(runs: &[Run], spans: &[Span]) -> HashMap<String, usize> {
    let mut distribution: HashMap<String, usize> = HashMap::new();

    for span in spans {
        if let Some(error_type) = span.error_type.as_deref().filter(|value| !value.is_empty()) {
            *distribution.entry(error_type.to_string()).or_insert(0) += 1;
        } else if matches!(span.status.as_str(), "failed" | "error") {
            *distribution.entry("unknown".to_string()).or_insert(0) += 1;
        }
    }

    let run_failures = runs
        .iter()
        .filter(|run| matches!(run.status.as_str(), "failed" | "error"))
        .count();
    if run_failures > 0 {
        *distribution.entry("run_failure".to_string()).or_insert(0) += run_failures;
    }

    distribution
}

pub fn compute_latency_metrics(_runs: &[Run], spans: &[Span]) -> LatencyMetrics {
    let mut samples = spans
        .iter()
        .filter_map(|span| {
            span.latency_ms.or_else(|| {
                span.ended_at.map(|ended| {
                    ended
                        .signed_duration_since(span.started_at)
                        .num_milliseconds()
                        .max(0) as f64
                })
            })
        })
        .filter(|latency| *latency > 0.0)
        .collect::<Vec<_>>();

    if samples.is_empty() {
        return LatencyMetrics {
            avg_latency_ms: 0.0,
            p95_latency_ms: 0.0,
            slow_span_count: 0,
        };
    }

    samples.sort_by(|a, b| a.total_cmp(b));
    let avg_latency_ms = samples.iter().sum::<f64>() / samples.len() as f64;
    let p95_index = ((samples.len() as f64 * 0.95).ceil() as usize).saturating_sub(1);
    let p95_latency_ms = samples[p95_index];
    let slow_span_count = samples
        .iter()
        .filter(|latency| **latency >= SLOW_SPAN_THRESHOLD_MS)
        .count();

    LatencyMetrics {
        avg_latency_ms,
        p95_latency_ms,
        slow_span_count,
    }
}

pub fn compute_cost_metrics(runs: &[Run]) -> CostMetrics {
    if runs.is_empty() {
        return CostMetrics {
            avg_cost_usd: 0.0,
            total_cost_usd: 0.0,
            spike_count: 0,
        };
    }

    let total_cost_usd = runs
        .iter()
        .map(|run| run.total_cost_usd.max(0.0))
        .sum::<f64>();
    let avg_cost_usd = total_cost_usd / runs.len() as f64;
    let spike_threshold = if avg_cost_usd > 0.0 {
        avg_cost_usd * 1.5
    } else {
        0.0
    };
    let spike_count = runs
        .iter()
        .filter(|run| run.total_cost_usd > spike_threshold)
        .count();

    CostMetrics {
        avg_cost_usd,
        total_cost_usd,
        spike_count,
    }
}

pub fn compute_prompt_metrics(spans: &[Span]) -> Vec<PromptMetric> {
    let mut buckets: HashMap<String, (usize, usize)> = HashMap::new();

    for span in spans {
        let Some(prompt_hash) = span.prompt_hash.as_deref().filter(|hash| !hash.is_empty()) else {
            continue;
        };

        let is_success = span.success.unwrap_or_else(|| {
            matches!(
                span.status.as_str(),
                "ok" | "success" | "completed" | "running"
            )
        });

        let entry = buckets.entry(prompt_hash.to_string()).or_insert((0, 0));
        entry.0 += 1;
        if is_success {
            entry.1 += 1;
        }
    }

    buckets
        .into_iter()
        .map(|(prompt_hash, (total, success))| {
            let success_rate = if total == 0 {
                0.0
            } else {
                success as f64 / total as f64
            };
            PromptMetric {
                prompt_hash,
                total_spans: total,
                success_rate,
                failure_rate: 1.0 - success_rate,
            }
        })
        .collect()
}

pub fn detect_failure_rate_trend(current: f32, baseline: f32) -> Option<TrendInsight> {
    let delta = current as f64 - baseline as f64;
    if delta <= FAILURE_RATE_INCREASE_THRESHOLD {
        return None;
    }

    Some(TrendInsight {
        trend_type: "failure_rate".to_string(),
        severity: if delta >= 0.2 { "high" } else { "medium" }.to_string(),
        message: format!(
            "Failure rate increased from {:.1}% to {:.1}%.",
            baseline as f64 * 100.0,
            current as f64 * 100.0
        ),
        recommendation:
            "Inspect failing runs and prioritize the most frequent failure signatures first."
                .to_string(),
        evidence: json!({
            "current_failure_rate": current,
            "baseline_failure_rate": baseline,
            "delta": delta,
        }),
        impact_score: (delta * 100.0).min(100.0) as f32,
    })
}

pub fn detect_latency_trend(
    current: &LatencyMetrics,
    baseline: &LatencyMetrics,
) -> Option<TrendInsight> {
    if baseline.avg_latency_ms <= 0.0 && baseline.p95_latency_ms <= 0.0 {
        return None;
    }

    let avg_ratio = if baseline.avg_latency_ms > 0.0 {
        (current.avg_latency_ms - baseline.avg_latency_ms) / baseline.avg_latency_ms
    } else {
        0.0
    };
    let p95_ratio = if baseline.p95_latency_ms > 0.0 {
        (current.p95_latency_ms - baseline.p95_latency_ms) / baseline.p95_latency_ms
    } else {
        0.0
    };

    if avg_ratio <= LATENCY_REGRESSION_THRESHOLD && p95_ratio <= LATENCY_REGRESSION_THRESHOLD {
        return None;
    }

    let max_ratio = avg_ratio.max(p95_ratio);
    Some(TrendInsight {
        trend_type: "latency".to_string(),
        severity: if max_ratio >= 0.5 { "high" } else { "medium" }.to_string(),
        message: format!(
            "Latency regressed (avg {:.0}ms -> {:.0}ms, p95 {:.0}ms -> {:.0}ms).",
            baseline.avg_latency_ms,
            current.avg_latency_ms,
            baseline.p95_latency_ms,
            current.p95_latency_ms
        ),
        recommendation:
            "Profile slow spans, reduce sequential model/tool calls, and optimize critical path operations."
                .to_string(),
        evidence: json!({
            "current": current,
            "baseline": baseline,
            "avg_increase_ratio": avg_ratio,
            "p95_increase_ratio": p95_ratio,
        }),
        impact_score: (max_ratio * 100.0).min(100.0) as f32,
    })
}

pub fn detect_cost_trend(current: &CostMetrics, baseline: &CostMetrics) -> Option<TrendInsight> {
    if baseline.avg_cost_usd <= 0.0 {
        return None;
    }

    let increase_ratio = (current.avg_cost_usd - baseline.avg_cost_usd) / baseline.avg_cost_usd;
    if increase_ratio <= COST_REGRESSION_THRESHOLD {
        return None;
    }

    Some(TrendInsight {
        trend_type: "cost".to_string(),
        severity: if increase_ratio >= 0.5 {
            "high"
        } else {
            "medium"
        }
        .to_string(),
        message: format!(
            "Average cost per run increased from ${:.6} to ${:.6}.",
            baseline.avg_cost_usd, current.avg_cost_usd
        ),
        recommendation:
            "Reduce token-heavy prompts and route low-complexity requests to cheaper model tiers."
                .to_string(),
        evidence: json!({
            "current": current,
            "baseline": baseline,
            "avg_cost_increase_ratio": increase_ratio,
        }),
        impact_score: (increase_ratio * 100.0).min(100.0) as f32,
    })
}

pub fn detect_prompt_regressions(
    current: &[PromptMetric],
    baseline: &[PromptMetric],
) -> Vec<TrendInsight> {
    let baseline_map = baseline
        .iter()
        .map(|metric| (metric.prompt_hash.as_str(), metric))
        .collect::<HashMap<_, _>>();

    current
        .iter()
        .filter_map(|metric| {
            let baseline_metric = baseline_map.get(metric.prompt_hash.as_str())?;
            if metric.total_spans < 2 || baseline_metric.total_spans < 2 {
                return None;
            }

            let drop = baseline_metric.success_rate - metric.success_rate;
            if drop <= PROMPT_REGRESSION_THRESHOLD {
                return None;
            }

            Some(TrendInsight {
                trend_type: "prompt_regression".to_string(),
                severity: if drop >= 0.2 { "high" } else { "medium" }.to_string(),
                message: format!(
                    "Prompt hash {} regressed (success {:.1}% -> {:.1}%).",
                    metric.prompt_hash,
                    baseline_metric.success_rate * 100.0,
                    metric.success_rate * 100.0
                ),
                recommendation:
                    "Audit recent prompt-template changes and roll back or revise failing variants."
                        .to_string(),
                evidence: json!({
                    "prompt_hash": metric.prompt_hash,
                    "current": metric,
                    "baseline": baseline_metric,
                    "success_rate_drop": drop,
                }),
                impact_score: (drop * 100.0).min(100.0) as f32,
            })
        })
        .collect()
}

pub fn detect_variant_regressions(current: &[Run], baseline: &[Run]) -> Vec<TrendInsight> {
    let mut current_stats: HashMap<String, (usize, usize)> = HashMap::new();
    for run in current {
        let Some(variant) = run.variant.as_deref().filter(|value| !value.is_empty()) else {
            continue;
        };
        let entry = current_stats.entry(variant.to_string()).or_insert((0, 0));
        entry.0 += 1;
        if !matches!(run.status.as_str(), "failed" | "error") {
            entry.1 += 1;
        }
    }

    if current_stats.len() < 2 {
        return Vec::new();
    }

    let mut baseline_stats: HashMap<String, (usize, usize)> = HashMap::new();
    for run in baseline {
        let Some(variant) = run.variant.as_deref().filter(|value| !value.is_empty()) else {
            continue;
        };
        let entry = baseline_stats.entry(variant.to_string()).or_insert((0, 0));
        entry.0 += 1;
        if !matches!(run.status.as_str(), "failed" | "error") {
            entry.1 += 1;
        }
    }

    let mut scored = current_stats
        .iter()
        .map(|(variant, (total, success))| {
            let success_rate = if *total == 0 {
                0.0
            } else {
                *success as f64 / *total as f64
            };
            (variant.clone(), *total, success_rate)
        })
        .collect::<Vec<_>>();
    scored.sort_by(|a, b| b.2.total_cmp(&a.2));

    let best_rate = scored.first().map(|entry| entry.2).unwrap_or(0.0);
    scored
        .into_iter()
        .filter_map(|(variant, total, success_rate)| {
            if total < 3 {
                return None;
            }
            let delta = best_rate - success_rate;
            if delta <= 0.10 {
                return None;
            }

            Some(TrendInsight {
                trend_type: "variant_regression".to_string(),
                severity: if delta >= 0.2 { "high" } else { "medium" }.to_string(),
                message: format!(
                    "Variant `{variant}` underperforms peers (success {:.1}% vs best {:.1}%).",
                    success_rate * 100.0,
                    best_rate * 100.0
                ),
                recommendation:
                    "Shift traffic toward stronger variants and investigate prompts/tools used by this variant."
                        .to_string(),
                evidence: json!({
                    "variant": variant,
                    "current_success_rate": success_rate,
                    "best_peer_success_rate": best_rate,
                    "delta": delta,
                    "current_total_runs": total,
                    "baseline_variant_stats": baseline_stats,
                }),
                impact_score: (delta * 100.0).min(100.0) as f32,
            })
        })
        .collect()
}

pub fn summarize_trend_report(insights: &[TrendInsight]) -> String {
    if insights.is_empty() {
        return "No significant regressions detected across failure rate, latency, cost, prompts, or variants."
            .to_string();
    }

    let top = &insights[0];
    format!(
        "Detected {} trend signal(s); highest-impact issue is {} ({} severity).",
        insights.len(),
        top.trend_type,
        top.severity
    )
}

async fn load_spans_for_runs(
    storage: &Storage,
    runs: &[Run],
) -> Result<Vec<Span>, AgentScopeError> {
    let mut spans = Vec::new();
    for run in runs {
        spans.extend(storage.get_spans(&run.id).await?);
    }
    Ok(spans)
}
