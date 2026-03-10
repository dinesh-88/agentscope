use agentscope_common::errors::AgentScopeError;
use agentscope_trace::RunRootCause;
use tracing::info;

use crate::Storage;

impl Storage {
    pub async fn replace_run_root_causes(
        &self,
        run_id: &str,
        root_causes: &[RunRootCause],
    ) -> Result<(), AgentScopeError> {
        let mut tx = self.pool.begin().await.map_err(|e| {
            AgentScopeError::Storage(format!("failed to start root-cause transaction: {e}"))
        })?;

        sqlx::query("DELETE FROM run_root_causes WHERE run_id = $1::uuid")
            .bind(run_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                AgentScopeError::Storage(format!(
                    "failed to delete root causes for run {run_id}: {e}"
                ))
            })?;

        for root_cause in root_causes {
            sqlx::query(
                r#"
                INSERT INTO run_root_causes
                    (id, run_id, root_cause_type, confidence, message, evidence, suggested_fix, created_at)
                VALUES
                    ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8)
                "#,
            )
            .bind(&root_cause.id)
            .bind(&root_cause.run_id)
            .bind(&root_cause.root_cause_type)
            .bind(root_cause.confidence)
            .bind(&root_cause.message)
            .bind(&root_cause.evidence)
            .bind(&root_cause.suggested_fix)
            .bind(root_cause.created_at)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                AgentScopeError::Storage(format!(
                    "failed to insert root cause {} for run {}: {e}",
                    root_cause.id, root_cause.run_id
                ))
            })?;
        }

        tx.commit().await.map_err(|e| {
            AgentScopeError::Storage(format!(
                "failed to commit root causes for run {run_id}: {e}"
            ))
        })?;

        info!(%run_id, root_cause_count = root_causes.len(), "run root causes replaced");
        Ok(())
    }

    pub async fn get_run_root_causes(
        &self,
        run_id: &str,
    ) -> Result<Vec<RunRootCause>, AgentScopeError> {
        let root_causes = sqlx::query_as::<_, RunRootCause>(
            r#"
            SELECT
                id::text AS id,
                run_id::text AS run_id,
                root_cause_type,
                confidence,
                message,
                evidence,
                suggested_fix,
                created_at
            FROM run_root_causes
            WHERE run_id = $1::uuid
            ORDER BY confidence DESC, created_at ASC
            "#,
        )
        .bind(run_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| {
            AgentScopeError::Storage(format!("failed to get root causes for run {run_id}: {e}"))
        })?;

        Ok(root_causes)
    }
}
