use std::collections::HashMap;

use agentscope_common::errors::AgentScopeError;
use agentscope_storage::Storage;
use agentscope_trace::{ProjectInsight, Run, RunRootCause, Span};
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

    let failed_runs = run_summaries.iter().filter(|summary| summary.failed).count() as i32;
    let failure_rate = failed_runs as f64 / run_count as f64;
    if failure_rate >= HIGH_ERROR_RATE_THRESHOLD {
        let impact = if failure_rate >= 0.5 { "high" } else { "medium" };
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

    let total_tokens: i64 = run_summaries.iter().map(|summary| summary.total_tokens).sum();
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

    let total_retry_events: usize = run_summaries.iter().map(|summary| summary.retry_events).sum();
    if total_retry_events >= HIGH_RETRY_EVENTS_THRESHOLD {
        let average_retries = total_retry_events as f64 / run_count as f64;
        let impact = if average_retries >= 1.5 { "high" } else { "medium" };
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
            let impact = if slowest_ms >= 15_000 { "high" } else { "medium" };
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
            let impact = if failure_rate >= 0.4 { "high" } else { "medium" };
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
