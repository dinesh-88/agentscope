use agentscope_common::errors::AgentScopeError;
use agentscope_trace::Run;
use sqlx::QueryBuilder;
use tracing::info;

use crate::Storage;

#[derive(Debug, Clone, Default)]
pub struct RunSearchFilters {
    pub query: Option<String>,
    pub status: Option<String>,
    pub workflow_name: Option<String>,
    pub agent_name: Option<String>,
    pub project_id: Option<String>,
    pub limit: Option<i64>,
}

impl Storage {
    pub async fn insert_run(&self, run: &Run) -> Result<(), AgentScopeError> {
        sqlx::query(
            r#"
            INSERT INTO runs (
                id,
                project_id,
                organization_id,
                workflow_name,
                agent_name,
                status,
                started_at,
                ended_at,
                total_input_tokens,
                total_output_tokens,
                total_tokens,
                total_cost_usd
            )
            VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (id) DO UPDATE
            SET project_id = EXCLUDED.project_id,
                organization_id = EXCLUDED.organization_id,
                workflow_name = EXCLUDED.workflow_name,
                agent_name = EXCLUDED.agent_name,
                status = EXCLUDED.status,
                started_at = EXCLUDED.started_at,
                ended_at = EXCLUDED.ended_at,
                total_input_tokens = EXCLUDED.total_input_tokens,
                total_output_tokens = EXCLUDED.total_output_tokens,
                total_tokens = EXCLUDED.total_tokens,
                total_cost_usd = EXCLUDED.total_cost_usd
            "#,
        )
        .bind(&run.id)
        .bind(&run.project_id)
        .bind(&run.organization_id)
        .bind(&run.workflow_name)
        .bind(&run.agent_name)
        .bind(&run.status)
        .bind(run.started_at)
        .bind(run.ended_at)
        .bind(run.total_input_tokens)
        .bind(run.total_output_tokens)
        .bind(run.total_tokens)
        .bind(run.total_cost_usd)
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
                   organization_id::text AS organization_id,
                   workflow_name,
                   agent_name,
                   status,
                   started_at,
                   ended_at,
                   total_input_tokens,
                   total_output_tokens,
                   total_tokens,
                   total_cost_usd
            FROM runs
            WHERE id = $1
            "#,
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| AgentScopeError::Storage(format!("failed to get run {id}: {e}")))?;

        Ok(run)
    }

    pub async fn get_run_for_user(
        &self,
        id: &str,
        user_id: &str,
    ) -> Result<Option<Run>, AgentScopeError> {
        let run = sqlx::query_as::<_, Run>(
            r#"
            SELECT runs.id::text AS id,
                   runs.project_id::text AS project_id,
                   runs.organization_id::text AS organization_id,
                   runs.workflow_name,
                   runs.agent_name,
                   runs.status,
                   runs.started_at,
                   runs.ended_at,
                   runs.total_input_tokens,
                   runs.total_output_tokens,
                   runs.total_tokens,
                   runs.total_cost_usd
            FROM runs
            INNER JOIN projects
                ON projects.id = runs.project_id
            INNER JOIN memberships
                ON memberships.organization_id = projects.organization_id
            WHERE runs.id = $1
              AND memberships.user_id = $2::uuid
            "#,
        )
        .bind(id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| {
            AgentScopeError::Storage(format!("failed to get run {id} for user {user_id}: {e}"))
        })?;

        Ok(run)
    }

    pub async fn list_runs(&self) -> Result<Vec<Run>, AgentScopeError> {
        let runs = sqlx::query_as::<_, Run>(
            r#"
            SELECT id::text AS id,
                   project_id::text AS project_id,
                   organization_id::text AS organization_id,
                   workflow_name,
                   agent_name,
                   status,
                   started_at,
                   ended_at,
                   total_input_tokens,
                   total_output_tokens,
                   total_tokens,
                   total_cost_usd
            FROM runs
            ORDER BY started_at DESC
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| AgentScopeError::Storage(format!("failed to list runs: {e}")))?;

        Ok(runs)
    }

    pub async fn list_runs_for_user(&self, user_id: &str) -> Result<Vec<Run>, AgentScopeError> {
        self.list_runs_for_user_filtered(user_id, &RunSearchFilters::default())
            .await
    }

    pub async fn list_runs_for_user_filtered(
        &self,
        user_id: &str,
        filters: &RunSearchFilters,
    ) -> Result<Vec<Run>, AgentScopeError> {
        let mut builder = QueryBuilder::new(
            r#"
            SELECT DISTINCT runs.id::text AS id,
                   runs.project_id::text AS project_id,
                   runs.organization_id::text AS organization_id,
                   runs.workflow_name,
                   runs.agent_name,
                   runs.status,
                   runs.started_at,
                   runs.ended_at,
                   runs.total_input_tokens,
                   runs.total_output_tokens,
                   runs.total_tokens,
                   runs.total_cost_usd
            FROM runs
            INNER JOIN projects
                ON projects.id = runs.project_id
            INNER JOIN memberships
                ON memberships.organization_id = projects.organization_id
            WHERE memberships.user_id = "#,
        );
        builder.push_bind(user_id).push("::uuid");

        if let Some(query) = filters.query.as_deref().filter(|value| !value.is_empty()) {
            builder.push(" AND (runs.workflow_name ILIKE ");
            builder.push_bind(format!("%{query}%"));
            builder.push(" OR runs.agent_name ILIKE ");
            builder.push_bind(format!("%{query}%"));
            builder.push(" OR runs.id::text ILIKE ");
            builder.push_bind(format!("%{query}%"));
            builder.push(")");
        }

        if let Some(status) = filters.status.as_deref().filter(|value| !value.is_empty()) {
            builder.push(" AND runs.status = ");
            builder.push_bind(status);
        }

        if let Some(workflow_name) = filters.workflow_name.as_deref().filter(|value| !value.is_empty()) {
            builder.push(" AND runs.workflow_name = ");
            builder.push_bind(workflow_name);
        }

        if let Some(agent_name) = filters.agent_name.as_deref().filter(|value| !value.is_empty()) {
            builder.push(" AND runs.agent_name = ");
            builder.push_bind(agent_name);
        }

        if let Some(project_id) = filters.project_id.as_deref().filter(|value| !value.is_empty()) {
            builder.push(" AND runs.project_id = ");
            builder.push_bind(project_id).push("::uuid");
        }

        builder.push(" ORDER BY runs.started_at DESC LIMIT ");
        builder.push_bind(filters.limit.unwrap_or(100));

        let runs = builder
            .build_query_as::<Run>()
            .fetch_all(&self.pool)
            .await
            .map_err(|e| {
                AgentScopeError::Storage(format!("failed to list runs for user {user_id}: {e}"))
            })?;

        Ok(runs)
    }

    pub async fn list_runs_by_status(&self, status: &str) -> Result<Vec<Run>, AgentScopeError> {
        let runs = sqlx::query_as::<_, Run>(
            r#"
            SELECT id::text AS id,
                   project_id::text AS project_id,
                   organization_id::text AS organization_id,
                   workflow_name,
                   agent_name,
                   status,
                   started_at,
                   ended_at,
                   total_input_tokens,
                   total_output_tokens,
                   total_tokens,
                   total_cost_usd
            FROM runs
            WHERE status = $1
            ORDER BY started_at DESC
            "#,
        )
        .bind(status)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| {
            AgentScopeError::Storage(format!("failed to list runs with status {status}: {e}"))
        })?;

        Ok(runs)
    }

    pub async fn update_run_metrics(&self, run_id: &str) -> Result<(), AgentScopeError> {
        sqlx::query(
            r#"
            UPDATE runs
            SET total_input_tokens = metrics.input_tokens,
                total_output_tokens = metrics.output_tokens,
                total_tokens = metrics.total_tokens,
                total_cost_usd = metrics.estimated_cost
            FROM (
                SELECT
                    COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
                    COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
                    COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
                    COALESCE(SUM(estimated_cost), 0.0)::double precision AS estimated_cost
                FROM spans
                WHERE run_id = $1
            ) AS metrics
            WHERE runs.id = $1
            "#,
        )
        .bind(run_id)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to update metrics for run {run_id}: {error}"
            ))
        })?;

        Ok(())
    }
}
