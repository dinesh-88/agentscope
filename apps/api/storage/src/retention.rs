use agentscope_common::errors::AgentScopeError;
use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use sqlx::FromRow;

use crate::Storage;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ProjectStorageSettings {
    pub project_id: String,
    pub retention_days: Option<i32>,
    pub store_prompts_responses: bool,
    pub compress_old_runs: bool,
    pub cleanup_mode: String,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RetentionApplyResult {
    pub affected_runs: i64,
    pub mode: String,
    pub cutoff_at: Option<DateTime<Utc>>,
}

impl Storage {
    pub async fn get_project_storage_settings(
        &self,
        project_id: &str,
    ) -> Result<ProjectStorageSettings, AgentScopeError> {
        let settings = sqlx::query_as::<_, ProjectStorageSettings>(
            r#"
            SELECT project_id::text AS project_id,
                   retention_days,
                   store_prompts_responses,
                   compress_old_runs,
                   cleanup_mode,
                   updated_at
            FROM project_storage_settings
            WHERE project_id = $1::uuid
            "#,
        )
        .bind(project_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to load storage settings for project {project_id}: {error}"
            ))
        })?;

        if let Some(settings) = settings {
            return Ok(settings);
        }

        Ok(ProjectStorageSettings {
            project_id: project_id.to_string(),
            retention_days: Some(30),
            store_prompts_responses: true,
            compress_old_runs: false,
            cleanup_mode: "soft_delete".to_string(),
            updated_at: Utc::now(),
        })
    }

    pub async fn upsert_project_storage_settings(
        &self,
        project_id: &str,
        retention_days: Option<i32>,
        store_prompts_responses: bool,
        compress_old_runs: bool,
        cleanup_mode: &str,
    ) -> Result<ProjectStorageSettings, AgentScopeError> {
        let settings = sqlx::query_as::<_, ProjectStorageSettings>(
            r#"
            INSERT INTO project_storage_settings (
                project_id,
                retention_days,
                store_prompts_responses,
                compress_old_runs,
                cleanup_mode,
                updated_at
            )
            VALUES ($1::uuid, $2, $3, $4, $5, now())
            ON CONFLICT (project_id) DO UPDATE
            SET retention_days = EXCLUDED.retention_days,
                store_prompts_responses = EXCLUDED.store_prompts_responses,
                compress_old_runs = EXCLUDED.compress_old_runs,
                cleanup_mode = EXCLUDED.cleanup_mode,
                updated_at = now()
            RETURNING project_id::text AS project_id,
                      retention_days,
                      store_prompts_responses,
                      compress_old_runs,
                      cleanup_mode,
                      updated_at
            "#,
        )
        .bind(project_id)
        .bind(retention_days)
        .bind(store_prompts_responses)
        .bind(compress_old_runs)
        .bind(cleanup_mode)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to upsert storage settings for project {project_id}: {error}"
            ))
        })?;

        Ok(settings)
    }

    pub async fn apply_project_retention(
        &self,
        project_id: &str,
    ) -> Result<RetentionApplyResult, AgentScopeError> {
        let settings = self.get_project_storage_settings(project_id).await?;
        let Some(retention_days) = settings.retention_days else {
            return Ok(RetentionApplyResult {
                affected_runs: 0,
                mode: settings.cleanup_mode,
                cutoff_at: None,
            });
        };

        let cutoff = Utc::now() - Duration::days(i64::from(retention_days));
        let affected = if settings.cleanup_mode == "hard_delete" {
            let result = sqlx::query(
                r#"
                DELETE FROM runs
                WHERE project_id = $1::uuid
                  AND started_at < $2
                "#,
            )
            .bind(project_id)
            .bind(cutoff)
            .execute(&self.pool)
            .await
            .map_err(|error| {
                AgentScopeError::Storage(format!(
                    "failed to hard-delete retained runs for project {project_id}: {error}"
                ))
            })?;
            result.rows_affected() as i64
        } else {
            let result = sqlx::query(
                r#"
                UPDATE runs
                SET deleted_at = now()
                WHERE project_id = $1::uuid
                  AND started_at < $2
                  AND deleted_at IS NULL
                "#,
            )
            .bind(project_id)
            .bind(cutoff)
            .execute(&self.pool)
            .await
            .map_err(|error| {
                AgentScopeError::Storage(format!(
                    "failed to soft-delete retained runs for project {project_id}: {error}"
                ))
            })?;
            result.rows_affected() as i64
        };

        Ok(RetentionApplyResult {
            affected_runs: affected,
            mode: settings.cleanup_mode,
            cutoff_at: Some(cutoff),
        })
    }
}
