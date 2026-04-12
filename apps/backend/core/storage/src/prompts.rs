use agentscope_common::errors::AgentScopeError;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::FromRow;

use crate::Storage;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Prompt {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PromptVersion {
    pub id: String,
    pub prompt_id: String,
    pub version: i32,
    pub content: String,
    pub hash: String,
    pub metadata: Option<Value>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PromptVersionMetrics {
    pub prompt_version_id: String,
    pub total_spans: i64,
    pub failures: i64,
    pub errors: i64,
    pub failure_rate: f64,
    pub error_rate: f64,
    pub avg_latency_ms: f64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub total_tokens: i64,
}

impl Storage {
    pub async fn resolve_prompt_version(
        &self,
        project_id: &str,
        name: &str,
        description: Option<&str>,
        content: &str,
        hash: &str,
        metadata: Option<Value>,
    ) -> Result<PromptVersion, AgentScopeError> {
        let prompt_id: String = sqlx::query_scalar(
            r#"
            INSERT INTO prompts (project_id, name, description)
            VALUES ($1::uuid, $2, $3)
            ON CONFLICT (project_id, name) DO UPDATE
            SET description = COALESCE(EXCLUDED.description, prompts.description)
            RETURNING id::text
            "#,
        )
        .bind(project_id)
        .bind(name)
        .bind(description)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| AgentScopeError::Storage(format!("failed to upsert prompt {name}: {e}")))?;

        if let Some(existing) = sqlx::query_as::<_, PromptVersion>(
            r#"
            SELECT id::text AS id,
                   prompt_id::text AS prompt_id,
                   version,
                   content,
                   hash,
                   metadata,
                   created_at
            FROM prompt_versions
            WHERE prompt_id = $1::uuid
              AND hash = $2
            LIMIT 1
            "#,
        )
        .bind(&prompt_id)
        .bind(hash)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| {
            AgentScopeError::Storage(format!("failed to fetch prompt version by hash: {e}"))
        })? {
            return Ok(existing);
        }

        let next_version: i32 = sqlx::query_scalar(
            r#"
            SELECT COALESCE(MAX(version), 0) + 1
            FROM prompt_versions
            WHERE prompt_id = $1::uuid
            "#,
        )
        .bind(&prompt_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| AgentScopeError::Storage(format!("failed to compute prompt version: {e}")))?;

        let inserted = sqlx::query_as::<_, PromptVersion>(
            r#"
            INSERT INTO prompt_versions (prompt_id, version, content, hash, metadata)
            VALUES ($1::uuid, $2, $3, $4, $5)
            ON CONFLICT (prompt_id, hash) DO UPDATE
            SET metadata = COALESCE(EXCLUDED.metadata, prompt_versions.metadata)
            RETURNING id::text AS id,
                      prompt_id::text AS prompt_id,
                      version,
                      content,
                      hash,
                      metadata,
                      created_at
            "#,
        )
        .bind(&prompt_id)
        .bind(next_version)
        .bind(content)
        .bind(hash)
        .bind(metadata)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| AgentScopeError::Storage(format!("failed to insert prompt version: {e}")))?;

        Ok(inserted)
    }

    pub async fn list_prompts_for_user(
        &self,
        user_id: &str,
        project_id: Option<&str>,
    ) -> Result<Vec<Prompt>, AgentScopeError> {
        let prompts = sqlx::query_as::<_, Prompt>(
            r#"
            SELECT p.id::text AS id,
                   p.project_id::text AS project_id,
                   p.name,
                   p.description,
                   p.created_at
            FROM prompts p
            INNER JOIN projects pr ON pr.id = p.project_id
            INNER JOIN memberships m ON m.organization_id = pr.organization_id
            WHERE m.user_id = $1::uuid
              AND m.status = 'active'
              AND ($2::uuid IS NULL OR p.project_id = $2::uuid)
            ORDER BY p.created_at DESC
            "#,
        )
        .bind(user_id)
        .bind(project_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| AgentScopeError::Storage(format!("failed to list prompts: {e}")))?;
        Ok(prompts)
    }

    pub async fn get_prompt(&self, id: &str) -> Result<Option<Prompt>, AgentScopeError> {
        sqlx::query_as::<_, Prompt>(
            r#"
            SELECT id::text AS id,
                   project_id::text AS project_id,
                   name,
                   description,
                   created_at
            FROM prompts
            WHERE id = $1::uuid
            "#,
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| AgentScopeError::Storage(format!("failed to get prompt {id}: {e}")))
    }

    pub async fn list_prompt_versions(
        &self,
        prompt_id: &str,
    ) -> Result<Vec<PromptVersion>, AgentScopeError> {
        sqlx::query_as::<_, PromptVersion>(
            r#"
            SELECT id::text AS id,
                   prompt_id::text AS prompt_id,
                   version,
                   content,
                   hash,
                   metadata,
                   created_at
            FROM prompt_versions
            WHERE prompt_id = $1::uuid
            ORDER BY version DESC
            "#,
        )
        .bind(prompt_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| AgentScopeError::Storage(format!("failed to list prompt versions: {e}")))
    }

    pub async fn get_prompt_version(
        &self,
        prompt_id: &str,
        version: i32,
    ) -> Result<Option<PromptVersion>, AgentScopeError> {
        sqlx::query_as::<_, PromptVersion>(
            r#"
            SELECT id::text AS id,
                   prompt_id::text AS prompt_id,
                   version,
                   content,
                   hash,
                   metadata,
                   created_at
            FROM prompt_versions
            WHERE prompt_id = $1::uuid
              AND version = $2
            "#,
        )
        .bind(prompt_id)
        .bind(version)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| AgentScopeError::Storage(format!("failed to get prompt version: {e}")))
    }

    pub async fn prompt_version_metrics(
        &self,
        prompt_id: &str,
    ) -> Result<Vec<PromptVersionMetrics>, AgentScopeError> {
        sqlx::query_as::<_, PromptVersionMetrics>(
            r#"
            SELECT pv.id::text AS prompt_version_id,
                   COUNT(s.id)::bigint AS total_spans,
                   COUNT(*) FILTER (WHERE COALESCE(s.success, false) = false)::bigint AS failures,
                   COUNT(*) FILTER (WHERE lower(COALESCE(s.status, '')) IN ('failed', 'error'))::bigint AS errors,
                   COALESCE(AVG(CASE WHEN COALESCE(s.success, false) = false THEN 1.0 ELSE 0.0 END), 0.0) AS failure_rate,
                   COALESCE(AVG(CASE WHEN lower(COALESCE(s.status, '')) IN ('failed', 'error') THEN 1.0 ELSE 0.0 END), 0.0) AS error_rate,
                   COALESCE(AVG(COALESCE(s.latency_ms, 0.0)), 0.0) AS avg_latency_ms,
                   COALESCE(SUM(COALESCE(s.input_tokens, 0)), 0)::bigint AS input_tokens,
                   COALESCE(SUM(COALESCE(s.output_tokens, 0)), 0)::bigint AS output_tokens,
                   COALESCE(SUM(COALESCE(s.total_tokens, 0)), 0)::bigint AS total_tokens
            FROM prompt_versions pv
            LEFT JOIN spans s ON s.prompt_version_id = pv.id
            WHERE pv.prompt_id = $1::uuid
            GROUP BY pv.id
            ORDER BY MAX(pv.version) DESC
            "#,
        )
        .bind(prompt_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| AgentScopeError::Storage(format!("failed to compute prompt version metrics: {e}")))
    }
}
