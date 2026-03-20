use std::collections::{HashMap, HashSet};

use agentscope_common::errors::AgentScopeError;
use agentscope_storage::Storage;
use agentscope_trace::{ActiveAlert, FailureCluster, ProjectInsight, Run, RunRootCause, Span};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

const RECENT_RUN_LIMIT: i64 = 100;
const PROMPT_TOO_LARGE_THRESHOLD: i64 = 100_000;
const EXPENSIVE_RUN_THRESHOLD: f64 = 0.08;
const TOO_MANY_LLM_CALLS_THRESHOLD: usize = 10;
const TOOL_FAILURE_RATE_THRESHOLD: f64 = 0.20;
const HIGH_ERROR_RATE_THRESHOLD: f64 = 0.25;
const HIGH_TOKEN_AVERAGE_THRESHOLD: i64 = 60_000;
const HIGH_RETRY_EVENTS_THRESHOLD: usize = 15;
const SLOW_SPAN_MS_THRESHOLD: i64 = 8_000;
const INVALID_OUTPUT_RATE_THRESHOLD: f64 = 0.15;
const ALERT_FAILURE_RATE_THRESHOLD: f64 = 0.30;
const ALERT_RELATIVE_INCREASE_THRESHOLD: f64 = 0.25;
const ALERT_P95_LATENCY_MS_THRESHOLD: f64 = 12_000.0;
const ALERT_TOTAL_COST_USD_THRESHOLD: f64 = 5.0;
const ALERT_ERROR_SPIKE_MIN_COUNT: usize = 3;
const ALERT_ERROR_SPIKE_RATIO_THRESHOLD: f64 = 2.0;
const CLUSTER_SAMPLE_RUNS: usize = 5;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InsightCard {
    pub id: String,
    pub category: String,
    #[serde(rename = "type")]
    pub insight_type: String,
    pub title: String,
    pub description: String,
    pub impact: String,
    pub suggestion: String,
    pub confidence: f64,
    pub highlighted: bool,
    pub created_at: chrono::DateTime<Utc>,
}

pub async fn analyze_recent_projects(storage: &Storage) -> Result<(), AgentScopeError> {
    let recent_runs = storage.list_recent_runs(RECENT_RUN_LIMIT).await?;
    let mut projects = recent_runs
        .into_iter()
        .map(|run| run.project_id)
        .collect::<Vec<_>>();
    projects.sort();
    projects.dedup();

    for project_id in projects {
        analyze_project(storage, &project_id).await?;
    }

    Ok(())
}

pub async fn analyze_project(
    storage: &Storage,
    project_id: &str,
) -> Result<Vec<ProjectInsight>, AgentScopeError> {
    let runs = storage
        .list_recent_runs_for_project(project_id, RECENT_RUN_LIMIT)
        .await?;

    let insights = generate_project_insights(project_id, &runs, storage).await?;
    let spans_by_run = load_project_spans_by_run(storage, &runs).await?;
    let alert_inputs = build_alert_metrics_inputs(&runs, &spans_by_run);
    let alert_insights = evaluate_alert_conditions(&alert_inputs);
    let active_alerts = alert_insights
        .into_iter()
        .map(|insight| create_alert(project_id, insight))
        .collect::<Vec<_>>();
    storage
        .replace_active_alerts(project_id, &active_alerts)
        .await?;

    let failure_events = collect_failure_events(&spans_by_run);
    let grouped_failures = group_failures(&failure_events);
    let clusters = build_clusters(project_id, grouped_failures);
    store_clusters(storage, project_id, &clusters).await?;

    storage
        .replace_project_insights(project_id, &insights)
        .await?;
    Ok(insights)
}

async fn generate_project_insights(
    project_id: &str,
    runs: &[Run],
    storage: &Storage,
) -> Result<Vec<ProjectInsight>, AgentScopeError> {
    if runs.is_empty() {
        return Ok(Vec::new());
    }

    let mut run_summaries = Vec::with_capacity(runs.len());

    for run in runs {
        let spans = storage.get_spans(&run.id).await?;
        let root_causes = storage.get_run_root_causes(&run.id).await?;
        run_summaries.push(RunSummary::from_run(run, spans, root_causes));
    }

    let mut insights = Vec::new();
    let run_count = runs.len() as i32;

    let failed_runs = run_summaries
        .iter()
        .filter(|summary| summary.failed)
        .count() as i32;
    let failure_rate = failed_runs as f64 / run_count as f64;
    if failure_rate >= HIGH_ERROR_RATE_THRESHOLD {
        let impact = if failure_rate >= 0.5 {
            "high"
        } else {
            "medium"
        };
        insights.push(build_project_insight(
            project_id,
            InsightDraft {
                category: "failure_patterns",
                insight_type: "FAILURE_HIGH_ERROR_RATE",
                title: "High error rate across recent runs",
                description: format!(
                    "{failed_runs} of the last {run_count} runs ended with failure signals ({:.1}%).",
                    failure_rate * 100.0
                ),
                impact,
                suggestion: "Inspect recurring error paths, harden failing tools, and add guardrails before risky calls."
                    .to_string(),
                confidence: (0.6 + failure_rate * 0.4).clamp(0.6, 0.98),
                highlighted: impact == "high",
                metrics: json!({
                    "failed_runs": failed_runs,
                    "run_count": run_count,
                    "failure_rate": failure_rate
                }),
            },
            run_count,
        ));
    }

    let top_root_cause = collect_top_root_causes(&run_summaries);
    if let Some((root_cause, count)) = top_root_cause.first() {
        let frequency = *count as f64 / run_count as f64;
        if *count >= 3 && frequency >= 0.25 {
            let impact = if frequency >= 0.5 { "high" } else { "medium" };
            insights.push(build_project_insight(
                project_id,
                InsightDraft {
                    category: "failure_patterns",
                    insight_type: "FAILURE_RECURRING_ROOT_CAUSE",
                    title: "Recurring root cause detected",
                    description: format!(
                        "Root cause `{root_cause}` appeared in {count} of the last {run_count} runs."
                    ),
                    impact,
                    suggestion:
                        "Prioritize a targeted fix for this root cause and add regression checks in evaluation runs."
                            .to_string(),
                    confidence: (0.55 + frequency * 0.45).clamp(0.55, 0.97),
                    highlighted: impact == "high",
                    metrics: json!({
                        "root_cause_type": root_cause,
                        "affected_runs": count,
                        "frequency": frequency
                    }),
                },
                run_count,
            ));
        }
    }

    let prompt_too_large_runs = run_summaries
        .iter()
        .filter(|summary| summary.max_input_tokens >= PROMPT_TOO_LARGE_THRESHOLD)
        .count() as i32;
    if prompt_too_large_runs > 0 {
        let frequency = prompt_too_large_runs as f64 / run_count as f64;
        let impact = if frequency >= 0.5 { "high" } else { "medium" };
        insights.push(build_project_insight(
            project_id,
            InsightDraft {
                category: "prompt_issues",
                insight_type: "PROMPT_TOO_LARGE",
                title: "Prompts are close to or over context limits",
                description: format!(
                    "{prompt_too_large_runs} of the last {run_count} runs exceeded the prompt-size threshold."
                ),
                impact,
                suggestion:
                    "Trim prompt templates, summarize prior context, and reduce retrieved content before model calls."
                        .to_string(),
                confidence: (0.6 + frequency * 0.35).clamp(0.6, 0.95),
                highlighted: impact == "high",
                metrics: json!({
                    "threshold_tokens": PROMPT_TOO_LARGE_THRESHOLD,
                    "affected_runs": prompt_too_large_runs
                }),
            },
            prompt_too_large_runs,
        ));
    }

    let expensive_model_runs = run_summaries
        .iter()
        .filter(|summary| summary.total_cost >= EXPENSIVE_RUN_THRESHOLD)
        .count() as i32;
    if expensive_model_runs > 0 {
        let frequency = expensive_model_runs as f64 / run_count as f64;
        let impact = if frequency >= 0.4 { "high" } else { "medium" };
        insights.push(build_project_insight(
            project_id,
            InsightDraft {
                category: "cost_optimization",
                insight_type: "COST_EXPENSIVE_RUNS",
                title: "Run costs are consistently elevated",
                description: format!(
                    "{expensive_model_runs} of the last {run_count} runs crossed the cost threshold."
                ),
                impact,
                suggestion:
                    "Route simpler requests to a cheaper model tier and reserve premium models for high-value paths."
                        .to_string(),
                confidence: (0.58 + frequency * 0.4).clamp(0.58, 0.97),
                highlighted: impact == "high",
                metrics: json!({
                    "threshold_cost": EXPENSIVE_RUN_THRESHOLD,
                    "affected_runs": expensive_model_runs,
                    "models": collect_top_models(&run_summaries)
                }),
            },
            expensive_model_runs,
        ));
    }

    let total_tokens: i64 = run_summaries
        .iter()
        .map(|summary| summary.total_tokens)
        .sum();
    let average_tokens = total_tokens / run_count as i64;
    if average_tokens >= HIGH_TOKEN_AVERAGE_THRESHOLD {
        let impact = if average_tokens >= HIGH_TOKEN_AVERAGE_THRESHOLD * 2 {
            "high"
        } else {
            "medium"
        };
        insights.push(build_project_insight(
            project_id,
            InsightDraft {
                category: "cost_optimization",
                insight_type: "COST_HIGH_TOKEN_USAGE",
                title: "Average token usage is high",
                description: format!(
                    "Average token usage reached {average_tokens} tokens per run in the last {run_count} runs."
                ),
                impact,
                suggestion:
                    "Reduce prompt verbosity, reuse cached context, and avoid repeated full-history injections."
                        .to_string(),
                confidence: if impact == "high" { 0.88 } else { 0.76 },
                highlighted: impact == "high",
                metrics: json!({
                    "average_tokens": average_tokens,
                    "run_count": run_count
                }),
            },
            run_count,
        ));
    }

    let total_retry_events: usize = run_summaries
        .iter()
        .map(|summary| summary.retry_events)
        .sum();
    if total_retry_events >= HIGH_RETRY_EVENTS_THRESHOLD {
        let average_retries = total_retry_events as f64 / run_count as f64;
        let impact = if average_retries >= 1.5 {
            "high"
        } else {
            "medium"
        };
        insights.push(build_project_insight(
            project_id,
            InsightDraft {
                category: "cost_optimization",
                insight_type: "COST_RETRY_WASTE",
                title: "Retries are adding avoidable cost",
                description: format!(
                    "Detected {total_retry_events} retry events across the last {run_count} runs."
                ),
                impact,
                suggestion:
                    "Fix root causes behind retries and cap retry counts for low-value operations."
                        .to_string(),
                confidence: (0.58 + (average_retries / 3.0)).clamp(0.58, 0.9),
                highlighted: impact == "high",
                metrics: json!({
                    "retry_events": total_retry_events,
                    "average_retries_per_run": average_retries
                }),
            },
            run_count,
        ));
    }

    let llm_heavy_runs = run_summaries
        .iter()
        .filter(|summary| summary.llm_calls > TOO_MANY_LLM_CALLS_THRESHOLD)
        .count() as i32;
    if llm_heavy_runs > 0 {
        let frequency = llm_heavy_runs as f64 / run_count as f64;
        let impact = if frequency >= 0.5 { "high" } else { "medium" };
        insights.push(build_project_insight(
            project_id,
            InsightDraft {
                category: "performance_bottlenecks",
                insight_type: "PERFORMANCE_TOO_MANY_LLM_CALLS",
                title: "Runs are making too many LLM calls",
                description: format!(
                    "{llm_heavy_runs} of the last {run_count} runs made more than {TOO_MANY_LLM_CALLS_THRESHOLD} LLM calls."
                ),
                impact,
                suggestion:
                    "Collapse redundant planning loops, cache deterministic substeps, and batch model work where possible."
                        .to_string(),
                confidence: (0.56 + frequency * 0.4).clamp(0.56, 0.94),
                highlighted: impact == "high",
                metrics: json!({
                    "threshold_calls": TOO_MANY_LLM_CALLS_THRESHOLD,
                    "affected_runs": llm_heavy_runs
                }),
            },
            llm_heavy_runs,
        ));
    }

    let slow_span_runs = run_summaries
        .iter()
        .filter(|summary| summary.slow_span_count > 0)
        .count() as i32;
    if slow_span_runs > 0 {
        let frequency = slow_span_runs as f64 / run_count as f64;
        let slowest_ms = run_summaries
            .iter()
            .map(|summary| summary.slowest_span_ms)
            .max()
            .unwrap_or_default();
        if frequency >= 0.2 {
            let impact = if slowest_ms >= 15_000 {
                "high"
            } else {
                "medium"
            };
            insights.push(build_project_insight(
                project_id,
                InsightDraft {
                    category: "performance_bottlenecks",
                    insight_type: "PERFORMANCE_SLOW_SPANS",
                    title: "Slow spans are bottlenecking runs",
                    description: format!(
                        "{slow_span_runs} of the last {run_count} runs contained spans slower than {} ms.",
                        SLOW_SPAN_MS_THRESHOLD
                    ),
                    impact,
                    suggestion:
                        "Profile the slowest tools and model calls, then parallelize or short-circuit long paths."
                            .to_string(),
                    confidence: (0.6 + frequency * 0.35).clamp(0.6, 0.95),
                    highlighted: impact == "high",
                    metrics: json!({
                        "slow_run_count": slow_span_runs,
                        "slow_threshold_ms": SLOW_SPAN_MS_THRESHOLD,
                        "slowest_span_ms": slowest_ms
                    }),
                },
                run_count,
            ));
        }
    }

    let tool_failures: usize = run_summaries
        .iter()
        .map(|summary| summary.tool_failures)
        .sum();
    let tool_calls: usize = run_summaries.iter().map(|summary| summary.tool_calls).sum();
    if tool_calls > 0 {
        let failure_rate = tool_failures as f64 / tool_calls as f64;
        if failure_rate >= TOOL_FAILURE_RATE_THRESHOLD {
            let impact = if failure_rate >= 0.4 {
                "high"
            } else {
                "medium"
            };
            insights.push(build_project_insight(
                project_id,
                InsightDraft {
                    category: "failure_patterns",
                    insight_type: "FAILURE_TOOL_FAILURE_RATE",
                    title: "Tool execution failures are frequent",
                    description: format!(
                        "Tool failure rate reached {:.1}% across the last {run_count} runs.",
                        failure_rate * 100.0
                    ),
                    impact,
                    suggestion:
                        "Stabilize the worst-performing tools first, add retries for transient failures, and validate tool inputs earlier."
                            .to_string(),
                    confidence: (0.65 + failure_rate * 0.3).clamp(0.65, 0.97),
                    highlighted: impact == "high",
                    metrics: json!({
                        "tool_calls": tool_calls,
                        "tool_failures": tool_failures,
                        "failure_rate": failure_rate
                    }),
                },
                run_count,
            ));
        }
    }

    let invalid_output_runs = run_summaries
        .iter()
        .filter(|summary| summary.invalid_output_signals > 0)
        .count() as i32;
    let invalid_output_rate = invalid_output_runs as f64 / run_count as f64;
    if invalid_output_rate >= INVALID_OUTPUT_RATE_THRESHOLD {
        let impact = if invalid_output_rate >= 0.4 {
            "high"
        } else {
            "medium"
        };
        insights.push(build_project_insight(
            project_id,
            InsightDraft {
                category: "prompt_issues",
                insight_type: "PROMPT_INVALID_OUTPUTS",
                title: "Invalid model outputs detected",
                description: format!(
                    "{invalid_output_runs} of the last {run_count} runs produced invalid or schema-mismatched outputs."
                ),
                impact,
                suggestion:
                    "Tighten output formatting instructions, add structured output constraints, and validate before tool use."
                        .to_string(),
                confidence: (0.6 + invalid_output_rate * 0.35).clamp(0.6, 0.95),
                highlighted: impact == "high",
                metrics: json!({
                    "affected_runs": invalid_output_runs,
                    "invalid_output_rate": invalid_output_rate
                }),
            },
            run_count,
        ));
    }

    Ok(insights)
}

async fn load_project_spans_by_run(
    storage: &Storage,
    runs: &[Run],
) -> Result<HashMap<String, Vec<Span>>, AgentScopeError> {
    let mut spans_by_run = HashMap::new();
    for run in runs {
        let spans = storage.get_spans(&run.id).await?;
        spans_by_run.insert(run.id.clone(), spans);
    }
    Ok(spans_by_run)
}

#[derive(Debug, Clone)]
struct AlertWindowMetrics {
    run_count: usize,
    failure_rate: f64,
    avg_latency_ms: f64,
    p95_latency_ms: f64,
    avg_cost_usd: f64,
    total_cost_usd: f64,
    error_counts: HashMap<String, usize>,
}

#[derive(Debug, Clone)]
struct AlertMetricsInput {
    current: AlertWindowMetrics,
    previous: AlertWindowMetrics,
    run_ids: Vec<String>,
}

#[derive(Debug, Clone)]
struct AlertInsightDraft {
    alert_type: String,
    severity: String,
    message: String,
    evidence: serde_json::Value,
}

fn build_alert_metrics_inputs(
    runs: &[Run],
    spans_by_run: &HashMap<String, Vec<Span>>,
) -> AlertMetricsInput {
    let split = (runs.len() / 2).max(1).min(runs.len());
    let current_runs = &runs[..split];
    let previous_runs = &runs[split..];
    let run_ids = current_runs
        .iter()
        .map(|run| run.id.clone())
        .collect::<Vec<_>>();

    AlertMetricsInput {
        current: compute_alert_window_metrics(current_runs, spans_by_run),
        previous: if previous_runs.is_empty() {
            AlertWindowMetrics {
                run_count: 0,
                failure_rate: 0.0,
                avg_latency_ms: 0.0,
                p95_latency_ms: 0.0,
                avg_cost_usd: 0.0,
                total_cost_usd: 0.0,
                error_counts: HashMap::new(),
            }
        } else {
            compute_alert_window_metrics(previous_runs, spans_by_run)
        },
        run_ids,
    }
}

fn compute_alert_window_metrics(
    runs: &[Run],
    spans_by_run: &HashMap<String, Vec<Span>>,
) -> AlertWindowMetrics {
    let run_count = runs.len();
    if run_count == 0 {
        return AlertWindowMetrics {
            run_count: 0,
            failure_rate: 0.0,
            avg_latency_ms: 0.0,
            p95_latency_ms: 0.0,
            avg_cost_usd: 0.0,
            total_cost_usd: 0.0,
            error_counts: HashMap::new(),
        };
    }

    let failed_runs = runs
        .iter()
        .filter(|run| is_failed_status(&run.status))
        .count();
    let mut latencies = Vec::with_capacity(run_count);
    let mut total_cost_usd = 0.0;
    let mut error_counts = HashMap::new();

    for run in runs {
        if let Some(duration_ms) = run_duration_ms(run) {
            latencies.push(duration_ms);
        }
        total_cost_usd += run.total_cost_usd;

        if let Some(spans) = spans_by_run.get(&run.id) {
            for span in spans {
                if !is_failure_span(span) {
                    continue;
                }

                let error_type = span
                    .error_type
                    .as_deref()
                    .map(normalize_key)
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| "unknown_error".to_string());
                *error_counts.entry(error_type).or_insert(0) += 1;
            }
        }
    }

    latencies.sort_by(|left, right| left.total_cmp(right));
    let avg_latency_ms = if latencies.is_empty() {
        0.0
    } else {
        latencies.iter().sum::<f64>() / latencies.len() as f64
    };
    let p95_latency_ms = percentile(&latencies, 0.95);

    AlertWindowMetrics {
        run_count,
        failure_rate: failed_runs as f64 / run_count as f64,
        avg_latency_ms,
        p95_latency_ms,
        avg_cost_usd: total_cost_usd / run_count as f64,
        total_cost_usd,
        error_counts,
    }
}

fn evaluate_alert_conditions(metrics: &AlertMetricsInput) -> Vec<AlertInsightDraft> {
    let mut alerts = Vec::new();

    if metrics.current.failure_rate > ALERT_FAILURE_RATE_THRESHOLD {
        alerts.push(AlertInsightDraft {
            alert_type: "FAILURE_RATE_SPIKE".to_string(),
            severity: if metrics.current.failure_rate >= 0.50 {
                "critical".to_string()
            } else {
                "high".to_string()
            },
            message: format!(
                "Failure rate increased to {:.0}% in recent runs.",
                metrics.current.failure_rate * 100.0
            ),
            evidence: json!({
                "previous": metrics.previous.failure_rate,
                "current": metrics.current.failure_rate,
                "run_count": metrics.current.run_count,
                "run_ids": metrics.run_ids
            }),
        });
    }

    let latency_increase = relative_increase(
        metrics.previous.avg_latency_ms,
        metrics.current.avg_latency_ms,
    );
    if latency_increase > ALERT_RELATIVE_INCREASE_THRESHOLD
        || metrics.current.p95_latency_ms > ALERT_P95_LATENCY_MS_THRESHOLD
    {
        alerts.push(AlertInsightDraft {
            alert_type: "LATENCY_REGRESSION".to_string(),
            severity: if metrics.current.p95_latency_ms > ALERT_P95_LATENCY_MS_THRESHOLD * 1.5 {
                "critical".to_string()
            } else {
                "high".to_string()
            },
            message: format!(
                "Latency regression detected: avg latency {:.0}% higher and p95 at {:.0} ms.",
                (latency_increase * 100.0).max(0.0),
                metrics.current.p95_latency_ms
            ),
            evidence: json!({
                "previous_avg_latency_ms": metrics.previous.avg_latency_ms,
                "current_avg_latency_ms": metrics.current.avg_latency_ms,
                "avg_latency_change_ratio": latency_increase,
                "current_p95_latency_ms": metrics.current.p95_latency_ms,
                "p95_threshold_ms": ALERT_P95_LATENCY_MS_THRESHOLD,
                "run_ids": metrics.run_ids
            }),
        });
    }

    let cost_increase =
        relative_increase(metrics.previous.avg_cost_usd, metrics.current.avg_cost_usd);
    if cost_increase > ALERT_RELATIVE_INCREASE_THRESHOLD
        || metrics.current.total_cost_usd > ALERT_TOTAL_COST_USD_THRESHOLD
    {
        alerts.push(AlertInsightDraft {
            alert_type: "COST_REGRESSION".to_string(),
            severity: if metrics.current.total_cost_usd > ALERT_TOTAL_COST_USD_THRESHOLD * 2.0 {
                "critical".to_string()
            } else {
                "high".to_string()
            },
            message: format!(
                "Cost increased: avg cost changed by {:.0}% and total cost reached ${:.2}.",
                (cost_increase * 100.0).max(0.0),
                metrics.current.total_cost_usd
            ),
            evidence: json!({
                "previous_avg_cost_usd": metrics.previous.avg_cost_usd,
                "current_avg_cost_usd": metrics.current.avg_cost_usd,
                "avg_cost_change_ratio": cost_increase,
                "current_total_cost_usd": metrics.current.total_cost_usd,
                "total_cost_threshold_usd": ALERT_TOTAL_COST_USD_THRESHOLD,
                "run_ids": metrics.run_ids
            }),
        });
    }

    for (error_type, current_count) in &metrics.current.error_counts {
        let previous_count = metrics
            .previous
            .error_counts
            .get(error_type)
            .copied()
            .unwrap_or(0);
        let ratio = if previous_count == 0 {
            if *current_count > 0 {
                f64::INFINITY
            } else {
                0.0
            }
        } else {
            *current_count as f64 / previous_count as f64
        };

        if *current_count >= ALERT_ERROR_SPIKE_MIN_COUNT
            && ratio >= ALERT_ERROR_SPIKE_RATIO_THRESHOLD
        {
            alerts.push(AlertInsightDraft {
                alert_type: "ERROR_SPIKE".to_string(),
                severity: if ratio >= 3.0 {
                    "critical".to_string()
                } else {
                    "high".to_string()
                },
                message: format!(
                    "Error spike detected for `{error_type}`: {current_count} recent occurrences."
                ),
                evidence: json!({
                    "error_type": error_type,
                    "previous_count": previous_count,
                    "current_count": current_count,
                    "spike_ratio": ratio,
                    "run_ids": metrics.run_ids
                }),
            });
        }
    }

    alerts
}

fn create_alert(project_id: &str, insight: AlertInsightDraft) -> ActiveAlert {
    ActiveAlert {
        id: Uuid::new_v4().to_string(),
        project_id: project_id.to_string(),
        alert_type: insight.alert_type,
        severity: insight.severity,
        message: insight.message,
        evidence: insight.evidence,
        created_at: Utc::now(),
    }
}

#[derive(Debug, Clone)]
struct FailureEvent {
    run_id: String,
    signature: String,
    error_type: String,
    span_name: Option<String>,
}

fn collect_failure_events(spans_by_run: &HashMap<String, Vec<Span>>) -> Vec<FailureEvent> {
    let mut events = Vec::new();
    for (run_id, spans) in spans_by_run {
        for span in spans {
            if !is_failure_span(span) {
                continue;
            }

            let signature = generate_failure_signature(span);
            let error_type = span
                .error_type
                .as_deref()
                .map(normalize_key)
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "unknown_error".to_string());
            events.push(FailureEvent {
                run_id: run_id.clone(),
                signature,
                error_type,
                span_name: Some(span.name.clone()),
            });
        }
    }
    events
}

fn generate_failure_signature(span: &Span) -> String {
    let status = normalize_key(&span.status);
    let error_type = span
        .error_type
        .as_deref()
        .map(normalize_key)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "error".to_string());
    let tool_name = span
        .tool_name
        .as_deref()
        .map(normalize_key)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| normalize_key(&span.name));
    let prompt_hash = span
        .prompt_hash
        .as_deref()
        .map(normalize_key)
        .unwrap_or_default();

    if status.contains("timeout") || error_type.contains("timeout") {
        return format!(
            "timeout_on_{}",
            if tool_name.is_empty() {
                "operation"
            } else {
                &tool_name
            }
        );
    }

    let message = span
        .metadata
        .as_ref()
        .and_then(|value| value.get("message"))
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if message.contains("invalid json") || error_type.contains("json") {
        if !tool_name.is_empty() {
            return format!("invalid_json_after_{}", tool_name);
        }
        return "invalid_json_after_tool_call".to_string();
    }

    if error_type.contains("rate_limit") {
        let provider = span
            .provider
            .as_deref()
            .map(normalize_key)
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "provider".to_string());
        return format!("api_error_{}_rate_limit", provider);
    }

    let mut signature_parts = vec![error_type];
    if !tool_name.is_empty() {
        signature_parts.push(tool_name);
    }
    if !prompt_hash.is_empty() {
        signature_parts.push(prompt_hash.chars().take(8).collect::<String>());
    }
    signature_parts.join("_")
}

fn group_failures(spans: &[FailureEvent]) -> HashMap<String, Vec<FailureEvent>> {
    let mut groups = HashMap::new();
    for event in spans {
        groups
            .entry(event.signature.clone())
            .or_insert_with(Vec::new)
            .push(event.clone());
    }
    groups
}

fn build_clusters(
    project_id: &str,
    groups: HashMap<String, Vec<FailureEvent>>,
) -> Vec<FailureCluster> {
    let mut clusters = groups
        .into_iter()
        .map(|(cluster_key, events)| {
            let count = events.len() as i32;
            let error_type = events
                .first()
                .map(|event| event.error_type.clone())
                .unwrap_or_else(|| "unknown_error".to_string());
            let common_span = events
                .iter()
                .filter_map(|event| event.span_name.clone())
                .fold(HashMap::<String, usize>::new(), |mut acc, span_name| {
                    *acc.entry(span_name).or_insert(0) += 1;
                    acc
                })
                .into_iter()
                .max_by(|left, right| left.1.cmp(&right.1).then_with(|| left.0.cmp(&right.0)))
                .map(|(name, _)| name);

            let mut seen = HashSet::new();
            let sample_run_ids = events
                .iter()
                .filter_map(|event| {
                    if seen.insert(event.run_id.clone()) {
                        Some(event.run_id.clone())
                    } else {
                        None
                    }
                })
                .take(CLUSTER_SAMPLE_RUNS)
                .collect::<Vec<_>>();

            FailureCluster {
                id: Uuid::new_v4().to_string(),
                project_id: project_id.to_string(),
                cluster_key,
                error_type,
                count,
                sample_run_ids,
                common_span,
                created_at: Utc::now(),
            }
        })
        .collect::<Vec<_>>();

    clusters.sort_by(|left, right| {
        right
            .count
            .cmp(&left.count)
            .then_with(|| left.cluster_key.cmp(&right.cluster_key))
    });
    clusters
}

async fn store_clusters(
    storage: &Storage,
    project_id: &str,
    clusters: &[FailureCluster],
) -> Result<(), AgentScopeError> {
    storage.replace_failure_clusters(project_id, clusters).await
}

fn build_project_insight(
    project_id: &str,
    draft: InsightDraft<'_>,
    run_count: i32,
) -> ProjectInsight {
    ProjectInsight {
        id: Uuid::new_v4().to_string(),
        project_id: project_id.to_string(),
        insight_type: draft.insight_type.to_string(),
        severity: draft.impact.to_string(),
        message: draft.description.clone(),
        evidence: json!({
            "category": draft.category,
            "title": draft.title,
            "description": draft.description,
            "impact": draft.impact,
            "suggestion": draft.suggestion,
            "confidence": draft.confidence,
            "highlighted": draft.highlighted,
            "metrics": draft.metrics
        }),
        recommendation: draft.suggestion,
        run_count,
        created_at: Utc::now(),
    }
}

struct InsightDraft<'a> {
    category: &'a str,
    insight_type: &'a str,
    title: &'a str,
    description: String,
    impact: &'a str,
    suggestion: String,
    confidence: f64,
    highlighted: bool,
    metrics: serde_json::Value,
}

#[derive(Default)]
struct RunSummary {
    failed: bool,
    total_tokens: i64,
    max_input_tokens: i64,
    total_cost: f64,
    llm_calls: usize,
    tool_calls: usize,
    tool_failures: usize,
    retry_events: usize,
    slow_span_count: usize,
    slowest_span_ms: i64,
    invalid_output_signals: usize,
    root_causes: HashMap<String, usize>,
    models: HashMap<String, usize>,
}

impl RunSummary {
    fn from_run(run: &Run, spans: Vec<Span>, root_causes: Vec<RunRootCause>) -> Self {
        let mut summary = Self::default();
        summary.failed = is_failed_status(&run.status);

        for span in spans {
            summary.total_tokens += span.total_tokens.unwrap_or(0);
            summary.max_input_tokens = summary.max_input_tokens.max(span.input_tokens.unwrap_or(0));
            summary.total_cost += span.estimated_cost.unwrap_or(0.0);

            let duration_ms = span
                .ended_at
                .map(|ended| (ended - span.started_at).num_milliseconds())
                .unwrap_or_default()
                .max(0);
            summary.slowest_span_ms = summary.slowest_span_ms.max(duration_ms);
            if duration_ms >= SLOW_SPAN_MS_THRESHOLD {
                summary.slow_span_count += 1;
            }

            if span.span_type == "llm" {
                summary.llm_calls += 1;
                if let Some(model) = span.model.as_ref() {
                    *summary.models.entry(model.clone()).or_insert(0) += 1;
                }
            }

            if span.span_type == "tool_call" {
                summary.tool_calls += 1;
                if matches!(span.status.as_str(), "error" | "failed" | "timeout") {
                    summary.tool_failures += 1;
                }
            }

            if looks_like_retry(&span) {
                summary.retry_events += 1;
            }
            if looks_like_invalid_output(&span) {
                summary.invalid_output_signals += 1;
            }
        }

        for root_cause in root_causes {
            let key = root_cause.root_cause_type.to_ascii_uppercase();
            *summary.root_causes.entry(key.clone()).or_insert(0) += 1;
            if key.contains("SCHEMA")
                || key.contains("INVALID")
                || key.contains("PROMPT")
                || key.contains("JSON")
            {
                summary.invalid_output_signals += 1;
            }
        }

        if summary.total_tokens == 0 {
            summary.total_tokens = run.total_tokens;
        }

        summary
    }
}

fn collect_top_models(run_summaries: &[RunSummary]) -> Vec<(String, usize)> {
    let mut counts = HashMap::new();
    for summary in run_summaries {
        for (model, count) in &summary.models {
            *counts.entry(model.clone()).or_insert(0usize) += count;
        }
    }

    let mut items = counts.into_iter().collect::<Vec<_>>();
    items.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
    items.truncate(3);
    items
}

fn collect_top_root_causes(run_summaries: &[RunSummary]) -> Vec<(String, usize)> {
    let mut counts = HashMap::new();
    for summary in run_summaries {
        for (root_cause, count) in &summary.root_causes {
            *counts.entry(root_cause.clone()).or_insert(0usize) += count;
        }
    }

    let mut items = counts.into_iter().collect::<Vec<_>>();
    items.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
    items.truncate(3);
    items
}

fn is_failed_status(status: &str) -> bool {
    matches!(
        status.to_ascii_lowercase().as_str(),
        "failed" | "error" | "timeout" | "cancelled"
    )
}

fn looks_like_retry(span: &Span) -> bool {
    if span.name.to_ascii_lowercase().contains("retry") {
        return true;
    }

    span.metadata
        .as_ref()
        .and_then(|value| value.get("retry_count"))
        .and_then(|value| value.as_i64())
        .is_some_and(|count| count > 0)
}

fn looks_like_invalid_output(span: &Span) -> bool {
    let status = span.status.to_ascii_lowercase();
    if status.contains("invalid") || status.contains("schema") || status.contains("parse") {
        return true;
    }

    let message = span
        .metadata
        .as_ref()
        .and_then(|value| value.get("message"))
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    message.contains("invalid json")
        || message.contains("schema validation")
        || message.contains("parse error")
}

fn run_duration_ms(run: &Run) -> Option<f64> {
    run.ended_at.and_then(|ended_at| {
        let ms = (ended_at - run.started_at).num_milliseconds();
        if ms > 0 {
            Some(ms as f64)
        } else {
            None
        }
    })
}

fn is_failure_span(span: &Span) -> bool {
    let status = span.status.to_ascii_lowercase();
    if matches!(
        status.as_str(),
        "error" | "failed" | "timeout" | "cancelled"
    ) {
        return true;
    }
    span.error_type.is_some()
}

fn normalize_key(value: &str) -> String {
    let mut normalized = String::with_capacity(value.len());
    let mut previous_was_separator = false;

    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            normalized.push(ch.to_ascii_lowercase());
            previous_was_separator = false;
        } else if !previous_was_separator {
            normalized.push('_');
            previous_was_separator = true;
        }
    }

    normalized.trim_matches('_').to_string()
}

fn percentile(sorted: &[f64], q: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let clamped_q = q.clamp(0.0, 1.0);
    let index = ((sorted.len() - 1) as f64 * clamped_q).ceil() as usize;
    sorted[index.min(sorted.len() - 1)]
}

fn relative_increase(previous: f64, current: f64) -> f64 {
    if previous <= 0.0 {
        return if current > 0.0 { 1.0 } else { 0.0 };
    }
    (current - previous) / previous
}

pub fn to_insight_cards(insights: &[ProjectInsight]) -> Vec<InsightCard> {
    let mut cards = insights
        .iter()
        .map(|insight| {
            let evidence = &insight.evidence;
            let title = evidence
                .get("title")
                .and_then(|value| value.as_str())
                .map(ToString::to_string)
                .unwrap_or_else(|| humanize_insight_type(&insight.insight_type));
            let description = evidence
                .get("description")
                .and_then(|value| value.as_str())
                .unwrap_or(&insight.message)
                .to_string();
            let impact = evidence
                .get("impact")
                .and_then(|value| value.as_str())
                .map(normalize_impact)
                .unwrap_or_else(|| normalize_impact(&insight.severity));
            let suggestion = evidence
                .get("suggestion")
                .and_then(|value| value.as_str())
                .unwrap_or(&insight.recommendation)
                .to_string();
            let category = evidence
                .get("category")
                .and_then(|value| value.as_str())
                .map(ToString::to_string)
                .unwrap_or_else(|| category_from_type(&insight.insight_type));
            let confidence = evidence
                .get("confidence")
                .and_then(|value| value.as_f64())
                .unwrap_or_else(|| confidence_from_impact(&impact));
            let highlighted = evidence
                .get("highlighted")
                .and_then(|value| value.as_bool())
                .unwrap_or_else(|| impact == "high");

            InsightCard {
                id: insight.id.clone(),
                category,
                insight_type: insight.insight_type.clone(),
                title,
                description,
                impact,
                suggestion,
                confidence,
                highlighted,
                created_at: insight.created_at,
            }
        })
        .collect::<Vec<_>>();

    cards.sort_by(|left, right| {
        right
            .highlighted
            .cmp(&left.highlighted)
            .then_with(|| impact_rank(&right.impact).cmp(&impact_rank(&left.impact)))
            .then_with(|| right.created_at.cmp(&left.created_at))
    });

    cards
}

fn normalize_impact(value: &str) -> String {
    match value.to_ascii_lowercase().as_str() {
        "high" | "critical" => "high".to_string(),
        "medium" | "warning" => "medium".to_string(),
        _ => "low".to_string(),
    }
}

fn category_from_type(insight_type: &str) -> String {
    let normalized = insight_type.to_ascii_uppercase();
    if normalized.starts_with("FAILURE") || normalized.contains("TOOL_FAILURE") {
        return "failure_patterns".to_string();
    }
    if normalized.starts_with("COST") || normalized.contains("EXPENSIVE") {
        return "cost_optimization".to_string();
    }
    if normalized.starts_with("PERFORMANCE") || normalized.contains("SLOW") {
        return "performance_bottlenecks".to_string();
    }
    if normalized.starts_with("PROMPT") || normalized.contains("SCHEMA") {
        return "prompt_issues".to_string();
    }
    "failure_patterns".to_string()
}

fn confidence_from_impact(impact: &str) -> f64 {
    match impact {
        "high" => 0.85,
        "medium" => 0.72,
        _ => 0.6,
    }
}

fn humanize_insight_type(value: &str) -> String {
    value
        .split('_')
        .map(|word| {
            let lower = word.to_ascii_lowercase();
            let mut chars = lower.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_ascii_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn impact_rank(impact: &str) -> i32 {
    match impact {
        "high" => 3,
        "medium" => 2,
        _ => 1,
    }
}
