use agentscope_common::errors::AgentScopeError;
use agentscope_storage::{
    weekly_reports::UpsertWeeklyReportInput,
    Storage,
};
use chrono::{Duration, NaiveDate, Utc};
use serde_json::json;
use sqlx::FromRow;
use tracing::{info, warn};

use crate::llm_client::{LlmClient, WeeklySummaryInput};

const TOP_ISSUES_LIMIT: i64 = 10;
const TOP_FIXED_LIMIT: i64 = 10;
const REGRESSIONS_LIMIT: i64 = 10;

#[derive(Debug, Clone, FromRow)]
struct WeekUsageAggRow {
    total_runs: i64,
    before_runs: i64,
    before_errors: i64,
    after_runs: i64,
    after_errors: i64,
}

#[derive(Debug, Clone, FromRow)]
struct WeekCostAggRow {
    cost_before: f64,
    cost_after: f64,
}

#[derive(Debug, Clone, FromRow)]
struct TopIssueRow {
    issue_key: String,
    priority_score: f64,
}

#[derive(Debug, Clone, FromRow)]
struct FixedIssueRow {
    issue_key: String,
    fixed_at: chrono::DateTime<Utc>,
    auto_detected: bool,
    detection_confidence: Option<f64>,
}

#[derive(Debug, Clone, FromRow)]
struct RegressionRow {
    issue_key: String,
    detected_at: chrono::DateTime<Utc>,
    regression_severity: f64,
}

pub fn completed_week_window(now: NaiveDate) -> (NaiveDate, NaiveDate) {
    let week_end = now - Duration::days(1);
    let week_start = week_end - Duration::days(6);
    (week_start, week_end)
}

pub async fn run_for_completed_week(storage: &Storage) -> Result<(), AgentScopeError> {
    let (week_start, week_end) = completed_week_window(Utc::now().date_naive());
    run_for_window(storage, week_start, week_end).await
}

pub async fn run_for_window(
    storage: &Storage,
    week_start: NaiveDate,
    week_end: NaiveDate,
) -> Result<(), AgentScopeError> {
    let project_ids = storage
        .list_active_projects_for_window(week_start, week_end)
        .await?;

    if project_ids.is_empty() {
        info!(%week_start, %week_end, "weekly report generation skipped: no active projects");
        return Ok(());
    }

    let llm_client = LlmClient::from_env().ok();

    for project_id in project_ids {
        generate_weekly_report(storage, llm_client.as_ref(), &project_id, week_start, week_end)
            .await?;
    }

    info!(%week_start, %week_end, "weekly report generation complete");
    Ok(())
}

pub async fn generate_weekly_report(
    storage: &Storage,
    llm_client: Option<&LlmClient>,
    project_id: &str,
    week_start: NaiveDate,
    week_end: NaiveDate,
) -> Result<(), AgentScopeError> {
    let split_date = week_start + Duration::days(3);

    let usage = sqlx::query_as::<_, WeekUsageAggRow>(
        r#"
        SELECT
            COALESCE(SUM(run_count), 0)::bigint AS total_runs,
            COALESCE(SUM(CASE WHEN date <= $2 THEN run_count ELSE 0 END), 0)::bigint AS before_runs,
            COALESCE(SUM(CASE WHEN date <= $2 THEN error_count ELSE 0 END), 0)::bigint AS before_errors,
            COALESCE(SUM(CASE WHEN date > $2 THEN run_count ELSE 0 END), 0)::bigint AS after_runs,
            COALESCE(SUM(CASE WHEN date > $2 THEN error_count ELSE 0 END), 0)::bigint AS after_errors
        FROM project_usage_daily
        WHERE project_id = $1::uuid
          AND date >= $3
          AND date <= $4
        "#,
    )
    .bind(project_id)
    .bind(split_date)
    .bind(week_start)
    .bind(week_end)
    .fetch_one(&storage.pool)
    .await
    .map_err(|error| {
        AgentScopeError::Storage(format!(
            "failed to aggregate weekly usage for project {project_id} window {week_start}..{week_end}: {error}"
        ))
    })?;

    let costs = sqlx::query_as::<_, WeekCostAggRow>(
        r#"
        SELECT
            COALESCE(SUM(CASE WHEN date <= $2 THEN failed_run_cost_usd ELSE 0 END), 0)::double precision AS cost_before,
            COALESCE(SUM(CASE WHEN date > $2 THEN failed_run_cost_usd ELSE 0 END), 0)::double precision AS cost_after
        FROM failure_metrics_daily
        WHERE project_id = $1::uuid
          AND date >= $3
          AND date <= $4
        "#,
    )
    .bind(project_id)
    .bind(split_date)
    .bind(week_start)
    .bind(week_end)
    .fetch_one(&storage.pool)
    .await
    .map_err(|error| {
        AgentScopeError::Storage(format!(
            "failed to aggregate weekly failure costs for project {project_id} window {week_start}..{week_end}: {error}"
        ))
    })?;

    let failure_rate_before = if usage.before_runs > 0 {
        usage.before_errors as f64 / usage.before_runs as f64
    } else {
        0.0
    };
    let failure_rate_after = if usage.after_runs > 0 {
        usage.after_errors as f64 / usage.after_runs as f64
    } else {
        0.0
    };

    let top_issues = sqlx::query_as::<_, TopIssueRow>(
        r#"
        SELECT issue_key, MAX(priority_score)::double precision AS priority_score
        FROM issue_rankings
        WHERE project_id = $1::uuid
          AND date >= $2
          AND date <= $3
        GROUP BY issue_key
        ORDER BY MAX(priority_score) DESC, issue_key ASC
        LIMIT $4
        "#,
    )
    .bind(project_id)
    .bind(week_start)
    .bind(week_end)
    .bind(TOP_ISSUES_LIMIT)
    .fetch_all(&storage.pool)
    .await
    .map_err(|error| {
        AgentScopeError::Storage(format!(
            "failed to fetch top weekly issues for project {project_id} window {week_start}..{week_end}: {error}"
        ))
    })?;

    let week_end_exclusive = week_end + Duration::days(1);

    let fixed_issues = sqlx::query_as::<_, FixedIssueRow>(
        r#"
        SELECT issue_key, fixed_at, auto_detected, detection_confidence
        FROM issue_fixes
        WHERE project_id = $1::uuid
          AND fixed_at >= $2::date
          AND fixed_at < $3::date
        ORDER BY fixed_at DESC
        LIMIT $4
        "#,
    )
    .bind(project_id)
    .bind(week_start)
    .bind(week_end_exclusive)
    .bind(TOP_FIXED_LIMIT)
    .fetch_all(&storage.pool)
    .await
    .map_err(|error| {
        AgentScopeError::Storage(format!(
            "failed to fetch fixed issues for project {project_id} window {week_start}..{week_end}: {error}"
        ))
    })?;

    let regressions = sqlx::query_as::<_, RegressionRow>(
        r#"
        SELECT issue_key, detected_at, regression_severity
        FROM issue_regressions
        WHERE project_id = $1::uuid
          AND detected_at >= $2::date
          AND detected_at < $3::date
        ORDER BY detected_at DESC
        LIMIT $4
        "#,
    )
    .bind(project_id)
    .bind(week_start)
    .bind(week_end_exclusive)
    .bind(REGRESSIONS_LIMIT)
    .fetch_all(&storage.pool)
    .await
    .map_err(|error| {
        AgentScopeError::Storage(format!(
            "failed to fetch regressions for project {project_id} window {week_start}..{week_end}: {error}"
        ))
    })?;

    let failure_change = failure_rate_after - failure_rate_before;
    let cost_change = costs.cost_after - costs.cost_before;

    let report_json = json!({
        "summary": {
            "failure_change": failure_change,
            "cost_change": cost_change,
            "total_runs": usage.total_runs,
        },
        "top_fixed_issues": fixed_issues.iter().map(|row| {
            json!({
                "issue_key": row.issue_key,
                "fixed_at": row.fixed_at,
                "auto_detected": row.auto_detected,
                "detection_confidence": row.detection_confidence,
            })
        }).collect::<Vec<_>>(),
        "regressions": regressions.iter().map(|row| {
            json!({
                "issue_key": row.issue_key,
                "detected_at": row.detected_at,
                "regression_severity": row.regression_severity,
            })
        }).collect::<Vec<_>>(),
        "top_issues": top_issues.iter().map(|row| {
            json!({
                "issue_key": row.issue_key,
                "priority_score": row.priority_score,
            })
        }).collect::<Vec<_>>(),
    });

    let top_fixed_keys = fixed_issues
        .iter()
        .map(|row| row.issue_key.clone())
        .collect::<Vec<_>>();
    let regression_keys = regressions
        .iter()
        .map(|row| row.issue_key.clone())
        .collect::<Vec<_>>();

    let llm_summary = if let Some(client) = llm_client {
        let input = WeeklySummaryInput {
            failure_change_pct: failure_change * 100.0,
            cost_change_usd: cost_change,
            top_fixed_issues: top_fixed_keys,
            regressions: regression_keys,
        };
        match client.summarize_weekly_report(&input).await {
            Ok(summary) => summary,
            Err(error) => {
                warn!(project_id, %error, "weekly report LLM summary generation failed");
                None
            }
        }
    } else {
        None
    };

    let improvement_summary = llm_summary.unwrap_or_else(|| {
        format!(
            "Weekly summary: failure rate changed by {failure_change_pct:.2}%, failed-cost changed by ${cost_change:.4}. Fixed issues: {fixed_count}. Regressions: {regression_count}.",
            failure_change_pct = failure_change * 100.0,
            cost_change = cost_change,
            fixed_count = fixed_issues.len(),
            regression_count = regressions.len()
        )
    });

    storage
        .upsert_weekly_report(UpsertWeeklyReportInput {
            project_id: project_id.to_string(),
            week_start,
            week_end,
            total_runs: usage.total_runs.clamp(0, i32::MAX as i64) as i32,
            failure_rate_before,
            failure_rate_after,
            cost_before: costs.cost_before,
            cost_after: costs.cost_after,
            improvement_summary,
            report_json,
        })
        .await?;

    info!(
        project_id,
        %week_start,
        %week_end,
        total_runs = usage.total_runs,
        failure_rate_before,
        failure_rate_after,
        cost_before = costs.cost_before,
        cost_after = costs.cost_after,
        "weekly report generated"
    );

    Ok(())
}
