use agentscope_common::errors::AgentScopeError;
use chrono::NaiveDate;
use serde::Serialize;
use sqlx::FromRow;

use crate::Storage;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ProjectUsageDaily {
    pub id: String,
    pub project_id: String,
    pub date: NaiveDate,
    pub run_count: i32,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub total_tokens: i64,
    pub cost_usd: f64,
    pub error_count: i32,
}

impl Storage {
    pub async fn aggregate_project_usage_daily(&self) -> Result<(), AgentScopeError> {
        sqlx::query(
            r#"
            INSERT INTO project_usage_daily (
                project_id,
                date,
                run_count,
                input_tokens,
                output_tokens,
                total_tokens,
                cost_usd,
                error_count,
                updated_at
            )
            SELECT
                runs.project_id,
                DATE(runs.started_at AT TIME ZONE 'UTC') AS bucket_date,
                COUNT(*)::int AS run_count,
                COALESCE(SUM(runs.total_input_tokens), 0)::bigint AS input_tokens,
                COALESCE(SUM(runs.total_output_tokens), 0)::bigint AS output_tokens,
                COALESCE(SUM(runs.total_tokens), 0)::bigint AS total_tokens,
                COALESCE(SUM(runs.total_cost_usd), 0)::double precision AS cost_usd,
                COALESCE(SUM(CASE WHEN runs.status IN ('failed', 'error') THEN 1 ELSE 0 END), 0)::int AS error_count,
                now()
            FROM runs
            GROUP BY runs.project_id, DATE(runs.started_at AT TIME ZONE 'UTC')
            ON CONFLICT (project_id, date) DO UPDATE
            SET run_count = EXCLUDED.run_count,
                input_tokens = EXCLUDED.input_tokens,
                output_tokens = EXCLUDED.output_tokens,
                total_tokens = EXCLUDED.total_tokens,
                cost_usd = EXCLUDED.cost_usd,
                error_count = EXCLUDED.error_count,
                updated_at = now()
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!("failed to aggregate daily usage: {error}"))
        })?;

        Ok(())
    }

    pub async fn get_project_usage_daily(
        &self,
        project_id: &str,
    ) -> Result<Vec<ProjectUsageDaily>, AgentScopeError> {
        let rows = sqlx::query_as::<_, ProjectUsageDaily>(
            r#"
            SELECT id::text AS id,
                   project_id::text AS project_id,
                   date,
                   run_count,
                   input_tokens,
                   output_tokens,
                   total_tokens,
                   cost_usd,
                   error_count
            FROM project_usage_daily
            WHERE project_id = $1::uuid
            ORDER BY date ASC
            "#,
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to load daily usage for project {project_id}: {error}"
            ))
        })?;

        Ok(rows)
    }
}
