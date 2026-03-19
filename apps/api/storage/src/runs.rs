use agentscope_common::errors::AgentScopeError;
use agentscope_trace::Run;
use sqlx::QueryBuilder;
use tracing::info;

use crate::Storage;

#[derive(Debug, Clone, Default)]
pub struct RunSearchFilters {
    pub query: Option<String>,
    pub status: Option<String>,
    pub model: Option<String>,
    pub agent: Option<String>,
    pub workflow_name: Option<String>,
    pub agent_name: Option<String>,
    pub tokens_min: Option<i64>,
    pub tokens_max: Option<i64>,
    pub duration_min_ms: Option<i64>,
    pub duration_max_ms: Option<i64>,
    pub time_from: Option<chrono::DateTime<chrono::Utc>>,
    pub time_to: Option<chrono::DateTime<chrono::Utc>>,
    pub project_id: Option<String>,
    pub limit: Option<i64>,
}

impl Storage {
    pub async fn run_exists(&self, run_id: &str) -> Result<bool, AgentScopeError> {
        let exists = sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS (SELECT 1 FROM runs WHERE id = $1::uuid AND deleted_at IS NULL)
            "#,
        )
        .bind(run_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| AgentScopeError::Storage(format!("failed to check run {run_id}: {e}")))?;

        Ok(exists)
    }

    pub async fn insert_run(&self, run: &Run) -> Result<(), AgentScopeError> {
        sqlx::query(
            r#"
            INSERT INTO runs (
                id,
                project_id,
                organization_id,
                user_id,
                session_id,
                environment,
                workflow_name,
                agent_name,
                status,
                started_at,
                ended_at,
                total_input_tokens,
                total_output_tokens,
                total_tokens,
                total_cost_usd,
                success,
                error_count,
                avg_latency_ms,
                p95_latency_ms,
                success_rate,
                tags,
                experiment_id,
                variant,
                metadata
            )
            VALUES (
                $1::uuid,
                $2::uuid,
                $3::uuid,
                $4,
                $5,
                $6,
                $7,
                $8,
                $9,
                $10,
                $11,
                $12,
                $13,
                $14,
                $15,
                $16,
                $17,
                $18,
                $19,
                $20,
                $21,
                $22,
                $23,
                $24
            )
            ON CONFLICT (id) DO UPDATE
            SET project_id = EXCLUDED.project_id,
                organization_id = EXCLUDED.organization_id,
                user_id = EXCLUDED.user_id,
                session_id = EXCLUDED.session_id,
                environment = EXCLUDED.environment,
                workflow_name = EXCLUDED.workflow_name,
                agent_name = EXCLUDED.agent_name,
                status = EXCLUDED.status,
                started_at = EXCLUDED.started_at,
                ended_at = EXCLUDED.ended_at,
                total_input_tokens = EXCLUDED.total_input_tokens,
                total_output_tokens = EXCLUDED.total_output_tokens,
                total_tokens = EXCLUDED.total_tokens,
                total_cost_usd = EXCLUDED.total_cost_usd,
                success = EXCLUDED.success,
                error_count = EXCLUDED.error_count,
                avg_latency_ms = EXCLUDED.avg_latency_ms,
                p95_latency_ms = EXCLUDED.p95_latency_ms,
                success_rate = EXCLUDED.success_rate,
                tags = EXCLUDED.tags,
                experiment_id = EXCLUDED.experiment_id,
                variant = EXCLUDED.variant,
                metadata = EXCLUDED.metadata,
                deleted_at = NULL
            "#,
        )
        .bind(&run.id)
        .bind(&run.project_id)
        .bind(&run.organization_id)
        .bind(&run.user_id)
        .bind(&run.session_id)
        .bind(&run.environment)
        .bind(&run.workflow_name)
        .bind(&run.agent_name)
        .bind(&run.status)
        .bind(run.started_at)
        .bind(run.ended_at)
        .bind(run.total_input_tokens)
        .bind(run.total_output_tokens)
        .bind(run.total_tokens)
        .bind(run.total_cost_usd)
        .bind(run.success)
        .bind(run.error_count)
        .bind(run.avg_latency_ms)
        .bind(run.p95_latency_ms)
        .bind(run.success_rate)
        .bind(&run.tags)
        .bind(&run.experiment_id)
        .bind(&run.variant)
        .bind(&run.metadata)
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
                   user_id,
                   session_id,
                   environment,
                   workflow_name,
                   agent_name,
                   status,
                   started_at,
                   ended_at,
                   total_input_tokens,
                   total_output_tokens,
                   total_tokens,
                   total_cost_usd,
                   success,
                   error_count,
                   avg_latency_ms,
                   p95_latency_ms,
                   success_rate,
                   tags,
                   experiment_id,
                   variant,
                   metadata
            FROM runs
            WHERE id = $1::uuid
              AND deleted_at IS NULL
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
                   runs.user_id,
                   runs.session_id,
                   runs.environment,
                   runs.workflow_name,
                   runs.agent_name,
                   runs.status,
                   runs.started_at,
                   runs.ended_at,
                   runs.total_input_tokens,
                   runs.total_output_tokens,
                   runs.total_tokens,
                   runs.total_cost_usd,
                   runs.success,
                   runs.error_count,
                   runs.avg_latency_ms,
                   runs.p95_latency_ms,
                   runs.success_rate,
                   runs.tags,
                   runs.experiment_id,
                   runs.variant,
                   runs.metadata
            FROM runs
            INNER JOIN projects
                ON projects.id = runs.project_id
            INNER JOIN memberships
                ON memberships.organization_id = projects.organization_id
            WHERE runs.id = $1::uuid
              AND memberships.user_id = $2::uuid
              AND runs.deleted_at IS NULL
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
                   user_id,
                   session_id,
                   environment,
                   workflow_name,
                   agent_name,
                   status,
                   started_at,
                   ended_at,
                   total_input_tokens,
                   total_output_tokens,
                   total_tokens,
                   total_cost_usd,
                   success,
                   error_count,
                   avg_latency_ms,
                   p95_latency_ms,
                   success_rate,
                   tags,
                   experiment_id,
                   variant,
                   metadata
            FROM runs
            WHERE deleted_at IS NULL
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
                   runs.user_id,
                   runs.session_id,
                   runs.environment,
                   runs.workflow_name,
                   runs.agent_name,
                   runs.status,
                   runs.started_at,
                   runs.ended_at,
                   runs.total_input_tokens,
                   runs.total_output_tokens,
                   runs.total_tokens,
                   runs.total_cost_usd,
                   runs.success,
                   runs.error_count,
                   runs.avg_latency_ms,
                   runs.p95_latency_ms,
                   runs.success_rate,
                   runs.tags,
                   runs.experiment_id,
                   runs.variant,
                   runs.metadata
            FROM runs
            INNER JOIN projects
                ON projects.id = runs.project_id
            INNER JOIN memberships
                ON memberships.organization_id = projects.organization_id
            WHERE memberships.user_id = "#,
        );
        builder.push_bind(user_id).push("::uuid");
        builder.push(" AND runs.deleted_at IS NULL");

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

        if let Some(model) = filters.model.as_deref().filter(|value| !value.is_empty()) {
            builder.push(
                " AND EXISTS (SELECT 1 FROM spans WHERE spans.run_id = runs.id AND spans.model ILIKE ",
            );
            builder.push_bind(format!("%{model}%"));
            builder.push(")");
        }

        if let Some(agent) = filters.agent.as_deref().filter(|value| !value.is_empty()) {
            builder.push(" AND runs.agent_name ILIKE ");
            builder.push_bind(format!("%{agent}%"));
        }

        if let Some(workflow_name) = filters
            .workflow_name
            .as_deref()
            .filter(|value| !value.is_empty())
        {
            builder.push(" AND runs.workflow_name = ");
            builder.push_bind(workflow_name);
        }

        if let Some(agent_name) = filters
            .agent_name
            .as_deref()
            .filter(|value| !value.is_empty())
        {
            builder.push(" AND runs.agent_name = ");
            builder.push_bind(agent_name);
        }

        if let Some(tokens_min) = filters.tokens_min {
            builder.push(" AND COALESCE(runs.total_tokens, 0) >= ");
            builder.push_bind(tokens_min);
        }

        if let Some(tokens_max) = filters.tokens_max {
            builder.push(" AND COALESCE(runs.total_tokens, 0) <= ");
            builder.push_bind(tokens_max);
        }

        if let Some(duration_min_ms) = filters.duration_min_ms {
            builder.push(
                " AND (EXTRACT(EPOCH FROM (COALESCE(runs.ended_at, now()) - runs.started_at)) * 1000) >= ",
            );
            builder.push_bind(duration_min_ms as f64);
        }

        if let Some(duration_max_ms) = filters.duration_max_ms {
            builder.push(
                " AND (EXTRACT(EPOCH FROM (COALESCE(runs.ended_at, now()) - runs.started_at)) * 1000) <= ",
            );
            builder.push_bind(duration_max_ms as f64);
        }

        if let Some(time_from) = filters.time_from {
            builder.push(" AND runs.started_at >= ");
            builder.push_bind(time_from);
        }

        if let Some(time_to) = filters.time_to {
            builder.push(" AND runs.started_at <= ");
            builder.push_bind(time_to);
        }

        if let Some(project_id) = filters
            .project_id
            .as_deref()
            .filter(|value| !value.is_empty())
        {
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
                   user_id,
                   session_id,
                   environment,
                   workflow_name,
                   agent_name,
                   status,
                   started_at,
                   ended_at,
                   total_input_tokens,
                   total_output_tokens,
                   total_tokens,
                   total_cost_usd,
                   success,
                   error_count,
                   avg_latency_ms,
                   p95_latency_ms,
                   success_rate,
                   tags,
                   experiment_id,
                   variant,
                   metadata
            FROM runs
            WHERE status = $1
              AND deleted_at IS NULL
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
                total_cost_usd = metrics.estimated_cost,
                success = metrics.success,
                error_count = metrics.error_count,
                avg_latency_ms = metrics.avg_latency_ms,
                p95_latency_ms = metrics.p95_latency_ms,
                success_rate = metrics.success_rate
            FROM (
                SELECT
                    COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
                    COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
                    COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
                    COALESCE(SUM(estimated_cost), 0.0)::double precision AS estimated_cost,
                    CASE
                        WHEN COUNT(*) = 0 THEN NULL
                        ELSE COALESCE(AVG(CASE WHEN status = 'success' THEN 1.0 ELSE 0.0 END), 0.0)
                    END::double precision AS success_rate,
                    CASE
                        WHEN COUNT(*) = 0 THEN NULL
                        ELSE COALESCE(AVG(COALESCE(latency_ms, EXTRACT(EPOCH FROM (COALESCE(ended_at, started_at) - started_at)) * 1000.0)), 0.0)
                    END::double precision AS avg_latency_ms,
                    CASE
                        WHEN COUNT(*) = 0 THEN NULL
                        ELSE COALESCE(
                            percentile_cont(0.95) WITHIN GROUP (
                                ORDER BY COALESCE(latency_ms, EXTRACT(EPOCH FROM (COALESCE(ended_at, started_at) - started_at)) * 1000.0)
                            ),
                            0.0
                        )
                    END::double precision AS p95_latency_ms,
                    COALESCE(SUM(CASE WHEN status IN ('failed', 'error') THEN 1 ELSE 0 END), 0)::int AS error_count,
                    CASE
                        WHEN COUNT(*) = 0 THEN NULL
                        ELSE BOOL_AND(status = 'success')
                    END AS success
                FROM spans
                WHERE run_id = $1::uuid
            ) AS metrics
            WHERE runs.id = $1::uuid
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
