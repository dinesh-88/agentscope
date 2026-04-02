use agentscope_common::errors::AgentScopeError;
use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::FromRow;

use crate::Storage;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct WeeklyReportRecord {
    pub id: String,
    pub project_id: String,
    pub week_start: NaiveDate,
    pub week_end: NaiveDate,
    pub total_runs: i32,
    pub failure_rate_before: f64,
    pub failure_rate_after: f64,
    pub cost_before: f64,
    pub cost_after: f64,
    pub improvement_summary: String,
    pub report_json: Value,
    pub created_at: DateTime<Utc>,
}

pub struct UpsertWeeklyReportInput {
    pub project_id: String,
    pub week_start: NaiveDate,
    pub week_end: NaiveDate,
    pub total_runs: i32,
    pub failure_rate_before: f64,
    pub failure_rate_after: f64,
    pub cost_before: f64,
    pub cost_after: f64,
    pub improvement_summary: String,
    pub report_json: Value,
}

impl Storage {
    pub async fn list_active_projects_for_window(
        &self,
        week_start: NaiveDate,
        week_end: NaiveDate,
    ) -> Result<Vec<String>, AgentScopeError> {
        sqlx::query_scalar::<_, String>(
            r#"
            SELECT DISTINCT project_id::text
            FROM project_usage_daily
            WHERE date >= $1
              AND date <= $2
            ORDER BY project_id::text
            "#,
        )
        .bind(week_start)
        .bind(week_end)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to list active projects for weekly report window {week_start}..{week_end}: {error}"
            ))
        })
    }

    pub async fn upsert_weekly_report(
        &self,
        input: UpsertWeeklyReportInput,
    ) -> Result<(), AgentScopeError> {
        let project_id_for_error = input.project_id.clone();
        let week_start_for_error = input.week_start;
        sqlx::query(
            r#"
            INSERT INTO weekly_reports (
                id,
                project_id,
                week_start,
                week_end,
                total_runs,
                failure_rate_before,
                failure_rate_after,
                cost_before,
                cost_after,
                improvement_summary,
                report_json,
                created_at
            )
            VALUES (
                gen_random_uuid(),
                $1::uuid,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7,
                $8,
                $9,
                $10::jsonb,
                now()
            )
            ON CONFLICT (project_id, week_start)
            DO UPDATE SET
                week_end = EXCLUDED.week_end,
                total_runs = EXCLUDED.total_runs,
                failure_rate_before = EXCLUDED.failure_rate_before,
                failure_rate_after = EXCLUDED.failure_rate_after,
                cost_before = EXCLUDED.cost_before,
                cost_after = EXCLUDED.cost_after,
                improvement_summary = EXCLUDED.improvement_summary,
                report_json = EXCLUDED.report_json,
                created_at = now()
            "#,
        )
        .bind(input.project_id)
        .bind(input.week_start)
        .bind(input.week_end)
        .bind(input.total_runs)
        .bind(input.failure_rate_before)
        .bind(input.failure_rate_after)
        .bind(input.cost_before)
        .bind(input.cost_after)
        .bind(input.improvement_summary)
        .bind(input.report_json)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to upsert weekly report for project {} week {}: {error}",
                project_id_for_error, week_start_for_error
            ))
        })?;

        Ok(())
    }

    pub async fn get_latest_weekly_report(
        &self,
        project_id: &str,
    ) -> Result<Option<WeeklyReportRecord>, AgentScopeError> {
        sqlx::query_as::<_, WeeklyReportRecord>(
            r#"
            SELECT
                id::text AS id,
                project_id::text AS project_id,
                week_start,
                week_end,
                total_runs,
                failure_rate_before,
                failure_rate_after,
                cost_before,
                cost_after,
                improvement_summary,
                report_json,
                created_at
            FROM weekly_reports
            WHERE project_id = $1::uuid
            ORDER BY week_start DESC
            LIMIT 1
            "#,
        )
        .bind(project_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to fetch latest weekly report for project {project_id}: {error}"
            ))
        })
    }
}
