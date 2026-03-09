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
}
