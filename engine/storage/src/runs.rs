use agentscope_common::errors::AgentScopeError;
use agentscope_trace::Run;
use tracing::info;

use crate::Storage;

impl Storage {
    pub async fn insert_run(&self, run: &Run) -> Result<(), AgentScopeError> {
        sqlx::query(
            r#"
            INSERT INTO runs (id, project_id, workflow_name, agent_name, status, started_at, ended_at)
            VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)
            "#,
        )
        .bind(&run.id)
        .bind(&run.project_id)
        .bind(&run.workflow_name)
        .bind(&run.agent_name)
        .bind(&run.status)
        .bind(run.started_at)
        .bind(run.ended_at)
        .execute(&self.pool)
        .await
        .map_err(|e| AgentScopeError::Storage(format!("failed to insert run {}: {e}", run.id)))?;

        info!(run_id = %run.id, "run inserted");
        Ok(())
    }

    pub async fn get_run(&self, id: &str) -> Result<Option<Run>, AgentScopeError> {
        let run = sqlx::query_as::<_, Run>(
            r#"
            SELECT id::text AS id,
                   project_id::text AS project_id,
                   workflow_name,
                   agent_name,
                   status,
                   started_at,
                   ended_at
            FROM runs
            WHERE id = $1::uuid
            "#,
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| AgentScopeError::Storage(format!("failed to get run {id}: {e}")))?;

        Ok(run)
    }

    pub async fn list_runs(&self) -> Result<Vec<Run>, AgentScopeError> {
        let runs = sqlx::query_as::<_, Run>(
            r#"
            SELECT id::text AS id,
                   project_id::text AS project_id,
                   workflow_name,
                   agent_name,
                   status,
                   started_at,
                   ended_at
            FROM runs
            ORDER BY started_at DESC
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| AgentScopeError::Storage(format!("failed to list runs: {e}")))?;

        Ok(runs)
    }
}
