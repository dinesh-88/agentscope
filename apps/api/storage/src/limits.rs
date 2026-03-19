use agentscope_common::errors::AgentScopeError;
use chrono::{Duration, Utc};
use serde::Serialize;
use sqlx::FromRow;

use crate::Storage;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ProjectLimit {
    pub project_id: String,
    pub max_runs_per_minute: Option<i32>,
    pub max_tokens_per_day: Option<i32>,
    pub max_concurrent_runs: Option<i32>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ProjectUsageRealtime {
    pub project_id: String,
    pub current_runs: i32,
    pub tokens_today: i64,
    pub last_reset_at: chrono::DateTime<Utc>,
}

impl Storage {
    pub async fn get_project_limits(
        &self,
        project_id: &str,
    ) -> Result<Option<ProjectLimit>, AgentScopeError> {
        let limits = sqlx::query_as::<_, ProjectLimit>(
            r#"
            SELECT project_id::text AS project_id,
                   max_runs_per_minute,
                   max_tokens_per_day,
                   max_concurrent_runs
            FROM project_limits
            WHERE project_id = $1::uuid
            "#,
        )
        .bind(project_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to load limits for project {project_id}: {error}"
            ))
        })?;

        Ok(limits)
    }

    pub async fn count_runs_in_last_minute(
        &self,
        project_id: &str,
    ) -> Result<i64, AgentScopeError> {
        let since = Utc::now() - Duration::minutes(1);
        let count = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT COUNT(*)
            FROM runs
            WHERE project_id = $1::uuid
              AND started_at >= $2
            "#,
        )
        .bind(project_id)
        .bind(since)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to count minute runs for project {project_id}: {error}"
            ))
        })?;

        Ok(count)
    }

    pub async fn count_concurrent_runs(&self, project_id: &str) -> Result<i64, AgentScopeError> {
        let count = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT COUNT(*)
            FROM runs
            WHERE project_id = $1::uuid
              AND status = 'running'
            "#,
        )
        .bind(project_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to count concurrent runs for project {project_id}: {error}"
            ))
        })?;

        Ok(count)
    }

    pub async fn get_or_init_realtime_usage(
        &self,
        project_id: &str,
    ) -> Result<ProjectUsageRealtime, AgentScopeError> {
        sqlx::query(
            r#"
            INSERT INTO project_usage_realtime (project_id)
            VALUES ($1::uuid)
            ON CONFLICT (project_id) DO NOTHING
            "#,
        )
        .bind(project_id)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to init realtime usage for project {project_id}: {error}"
            ))
        })?;

        self.refresh_realtime_window(project_id).await?;

        let usage = sqlx::query_as::<_, ProjectUsageRealtime>(
            r#"
            SELECT project_id::text AS project_id,
                   current_runs,
                   tokens_today,
                   last_reset_at
            FROM project_usage_realtime
            WHERE project_id = $1::uuid
            "#,
        )
        .bind(project_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to load realtime usage for project {project_id}: {error}"
            ))
        })?;

        Ok(usage)
    }

    pub async fn refresh_realtime_window(&self, project_id: &str) -> Result<(), AgentScopeError> {
        sqlx::query(
            r#"
            UPDATE project_usage_realtime
            SET tokens_today = CASE
                    WHEN DATE(last_reset_at AT TIME ZONE 'UTC') < DATE(now() AT TIME ZONE 'UTC') THEN 0
                    ELSE tokens_today
                END,
                last_reset_at = CASE
                    WHEN DATE(last_reset_at AT TIME ZONE 'UTC') < DATE(now() AT TIME ZONE 'UTC') THEN now()
                    ELSE last_reset_at
                END,
                updated_at = now()
            WHERE project_id = $1::uuid
            "#,
        )
        .bind(project_id)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to refresh realtime usage window for project {project_id}: {error}"
            ))
        })?;

        Ok(())
    }

    pub async fn increment_realtime_usage(
        &self,
        project_id: &str,
        run_delta: i64,
        token_delta: i64,
        current_runs: i64,
    ) -> Result<(), AgentScopeError> {
        self.get_or_init_realtime_usage(project_id).await?;

        sqlx::query(
            r#"
            UPDATE project_usage_realtime
            SET current_runs = $2,
                tokens_today = GREATEST(tokens_today + $3, 0),
                updated_at = now()
            WHERE project_id = $1::uuid
            "#,
        )
        .bind(project_id)
        .bind((current_runs + run_delta).max(0))
        .bind(token_delta)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to increment realtime usage for project {project_id}: {error}"
            ))
        })?;

        Ok(())
    }

    pub async fn set_realtime_current_runs(
        &self,
        project_id: &str,
        current_runs: i64,
    ) -> Result<(), AgentScopeError> {
        self.get_or_init_realtime_usage(project_id).await?;
        sqlx::query(
            r#"
            UPDATE project_usage_realtime
            SET current_runs = $2,
                updated_at = now()
            WHERE project_id = $1::uuid
            "#,
        )
        .bind(project_id)
        .bind(current_runs.max(0))
        .execute(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to sync current runs for project {project_id}: {error}"
            ))
        })?;

        Ok(())
    }
}
