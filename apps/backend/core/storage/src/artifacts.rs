use agentscope_common::errors::AgentScopeError;
use agentscope_trace::Artifact;
use tracing::info;

use crate::Storage;

impl Storage {
    pub async fn insert_artifact(&self, artifact: &Artifact) -> Result<(), AgentScopeError> {
        sqlx::query(
            r#"
            INSERT INTO artifacts (id, run_id, span_id, kind, payload)
            VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)
            ON CONFLICT (id) DO UPDATE
            SET run_id = EXCLUDED.run_id,
                span_id = EXCLUDED.span_id,
                kind = EXCLUDED.kind,
                payload = EXCLUDED.payload
            "#,
        )
        .bind(&artifact.id)
        .bind(&artifact.run_id)
        .bind(&artifact.span_id)
        .bind(&artifact.kind)
        .bind(&artifact.payload)
        .execute(&self.pool)
        .await
        .map_err(|e| {
            AgentScopeError::Storage(format!("failed to insert artifact {}: {e}", artifact.id))
        })?;

        info!(artifact_id = %artifact.id, run_id = %artifact.run_id, "artifact inserted");
        Ok(())
    }

    pub async fn get_artifacts_by_kind(
        &self,
        run_id: &str,
        kind: &str,
    ) -> Result<Vec<Artifact>, AgentScopeError> {
        let artifacts = sqlx::query_as::<_, Artifact>(
            r#"
            SELECT
                id::text AS id,
                run_id::text AS run_id,
                span_id::text AS span_id,
                kind,
                payload
            FROM artifacts
            WHERE run_id = $1::uuid AND kind = $2
            ORDER BY id ASC
            "#,
        )
        .bind(run_id)
        .bind(kind)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| {
            AgentScopeError::Storage(format!(
                "failed to get artifacts for run {run_id} and kind {kind}: {e}"
            ))
        })?;

        Ok(artifacts)
    }

    pub async fn get_artifacts(&self, run_id: &str) -> Result<Vec<Artifact>, AgentScopeError> {
        let artifacts = sqlx::query_as::<_, Artifact>(
            r#"
            SELECT
                id::text AS id,
                run_id::text AS run_id,
                span_id::text AS span_id,
                kind,
                payload
            FROM artifacts
            WHERE run_id = $1::uuid
            ORDER BY id ASC
            "#,
        )
        .bind(run_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| {
            AgentScopeError::Storage(format!("failed to get artifacts for run {run_id}: {e}"))
        })?;

        Ok(artifacts)
    }
}
