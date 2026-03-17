use std::collections::HashMap;

use agentscope_common::errors::AgentScopeError;
use agentscope_storage::Storage;
use agentscope_trace::{ProjectInsight, Run, Span};
use chrono::Utc;
use serde_json::json;
use uuid::Uuid;

const RECENT_RUN_LIMIT: i64 = 100;
const PROMPT_TOO_LARGE_THRESHOLD: i64 = 120_000;
const EXPENSIVE_RUN_THRESHOLD: f64 = 0.05;
const TOO_MANY_LLM_CALLS_THRESHOLD: usize = 8;
const TOOL_FAILURE_RATE_THRESHOLD: f64 = 0.20;

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
    let mut run_summaries = Vec::with_capacity(runs.len());

    for run in runs {
        let spans = storage.get_spans(&run.id).await?;
        run_summaries.push(RunSummary::from_spans(spans));
    }

    let mut insights = Vec::new();
    let run_count = runs.len() as i32;

    let prompt_too_large_runs = run_summaries
        .iter()
        .filter(|summary| summary.max_input_tokens >= PROMPT_TOO_LARGE_THRESHOLD)
        .count() as i32;
    if prompt_too_large_runs > 0 {
        insights.push(build_project_insight(
            project_id,
            "PROMPT_TOO_LARGE",
            if prompt_too_large_runs * 2 >= run_count { "high" } else { "medium" },
            format!(
                "{prompt_too_large_runs} of the last {run_count} runs exceeded the prompt-size threshold."
            ),
            json!({
                "threshold_tokens": PROMPT_TOO_LARGE_THRESHOLD,
                "affected_runs": prompt_too_large_runs
            }),
            "Trim prompt templates, summarize prior context, and reduce retrieved content before model calls.".to_string(),
            prompt_too_large_runs,
        ));
    }

    let expensive_model_runs = run_summaries
        .iter()
        .filter(|summary| summary.total_cost >= EXPENSIVE_RUN_THRESHOLD)
        .count() as i32;
    if expensive_model_runs > 0 {
        insights.push(build_project_insight(
            project_id,
            "EXPENSIVE_MODEL",
            if expensive_model_runs * 2 >= run_count { "high" } else { "medium" },
            format!(
                "{expensive_model_runs} of the last {run_count} runs crossed the cost threshold."
            ),
            json!({
                "threshold_cost": EXPENSIVE_RUN_THRESHOLD,
                "affected_runs": expensive_model_runs,
                "models": collect_top_models(&run_summaries)
            }),
            "Route simpler requests to a cheaper model tier and reserve premium models for high-value paths.".to_string(),
            expensive_model_runs,
        ));
    }

    let llm_heavy_runs = run_summaries
        .iter()
        .filter(|summary| summary.llm_calls > TOO_MANY_LLM_CALLS_THRESHOLD)
        .count() as i32;
    if llm_heavy_runs > 0 {
        insights.push(build_project_insight(
            project_id,
            "TOO_MANY_LLM_CALLS",
            if llm_heavy_runs * 2 >= run_count { "high" } else { "medium" },
            format!(
                "{llm_heavy_runs} of the last {run_count} runs made more than {TOO_MANY_LLM_CALLS_THRESHOLD} LLM calls."
            ),
            json!({
                "threshold_calls": TOO_MANY_LLM_CALLS_THRESHOLD,
                "affected_runs": llm_heavy_runs
            }),
            "Collapse redundant planning loops, cache deterministic substeps, and batch model work where possible.".to_string(),
            llm_heavy_runs,
        ));
    }

    let tool_failures: usize = run_summaries
        .iter()
        .map(|summary| summary.tool_failures)
        .sum();
    let tool_calls: usize = run_summaries.iter().map(|summary| summary.tool_calls).sum();
    if tool_calls > 0 {
        let failure_rate = tool_failures as f64 / tool_calls as f64;
        if failure_rate >= TOOL_FAILURE_RATE_THRESHOLD {
            insights.push(build_project_insight(
                project_id,
                "TOOL_FAILURE_RATE",
                if failure_rate >= 0.4 { "high" } else { "medium" },
                format!(
                    "Tool failure rate reached {:.1}% across the last {run_count} runs.",
                    failure_rate * 100.0
                ),
                json!({
                    "tool_calls": tool_calls,
                    "tool_failures": tool_failures,
                    "failure_rate": failure_rate
                }),
                "Stabilize the worst-performing tools first, add retries for transient failures, and validate tool inputs earlier.".to_string(),
                run_count,
            ));
        }
    }

    Ok(insights)
}

fn build_project_insight(
    project_id: &str,
    insight_type: &str,
    severity: &str,
    message: String,
    evidence: serde_json::Value,
    recommendation: String,
    run_count: i32,
) -> ProjectInsight {
    ProjectInsight {
        id: Uuid::new_v4().to_string(),
        project_id: project_id.to_string(),
        insight_type: insight_type.to_string(),
        severity: severity.to_string(),
        message,
        evidence,
        recommendation,
        run_count,
        created_at: Utc::now(),
    }
}

#[derive(Default)]
struct RunSummary {
    max_input_tokens: i64,
    total_cost: f64,
    llm_calls: usize,
    tool_calls: usize,
    tool_failures: usize,
    models: HashMap<String, usize>,
}

impl RunSummary {
    fn from_spans(spans: Vec<Span>) -> Self {
        let mut summary = Self::default();

        for span in spans {
            summary.max_input_tokens = summary.max_input_tokens.max(span.input_tokens.unwrap_or(0));
            summary.total_cost += span.estimated_cost.unwrap_or(0.0);

            if span.span_type == "llm" {
                summary.llm_calls += 1;
                if let Some(model) = span.model {
                    *summary.models.entry(model).or_insert(0) += 1;
                }
            }

            if span.span_type == "tool_call" {
                summary.tool_calls += 1;
                if matches!(span.status.as_str(), "error" | "failed" | "timeout") {
                    summary.tool_failures += 1;
                }
            }
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
