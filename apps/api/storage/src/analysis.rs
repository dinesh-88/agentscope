use agentscope_common::errors::AgentScopeError;
use agentscope_trace::{ProjectInsight, Run, RunAnalysis};
use tracing::info;

use crate::Storage;

impl Storage {
    pub async fn upsert_run_analysis(&self, analysis: &RunAnalysis) -> Result<(), AgentScopeError> {
        sqlx::query(
            r#"
            INSERT INTO run_analysis (
                id,
                run_id,
                project_id,
                failure_types,
                root_cause_category,
                summary,
                evidence,
                suggested_fixes,
                created_at,
                updated_at
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
                $10
            )
            ON CONFLICT (run_id) DO UPDATE
            SET project_id = EXCLUDED.project_id,
                failure_types = EXCLUDED.failure_types,
                root_cause_category = EXCLUDED.root_cause_category,
                summary = EXCLUDED.summary,
                evidence = EXCLUDED.evidence,
                suggested_fixes = EXCLUDED.suggested_fixes,
                updated_at = EXCLUDED.updated_at
            "#,
        )
        .bind(&analysis.id)
        .bind(&analysis.run_id)
        .bind(&analysis.project_id)
        .bind(&analysis.failure_types)
        .bind(&analysis.root_cause_category)
        .bind(&analysis.summary)
        .bind(&analysis.evidence)
        .bind(&analysis.suggested_fixes)
        .bind(analysis.created_at)
        .bind(analysis.updated_at)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to upsert run analysis for run {}: {error}",
                analysis.run_id
            ))
        })?;

        info!(run_id = %analysis.run_id, "run analysis upserted");
        Ok(())
    }

    pub async fn get_run_analysis(
        &self,
        run_id: &str,
    ) -> Result<Option<RunAnalysis>, AgentScopeError> {
        sqlx::query_as::<_, RunAnalysis>(
            r#"
            SELECT
                id::text AS id,
                run_id::text AS run_id,
                project_id::text AS project_id,
                failure_types,
                root_cause_category,
                summary,
                evidence,
                suggested_fixes,
                created_at,
                updated_at
            FROM run_analysis
            WHERE run_id = $1::uuid
            "#,
        )
        .bind(run_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to load run analysis for run {run_id}: {error}"
            ))
        })
    }

    pub async fn replace_project_insights(
        &self,
        project_id: &str,
        insights: &[ProjectInsight],
    ) -> Result<(), AgentScopeError> {
        let mut tx = self.pool.begin().await.map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to start project insights transaction for project {project_id}: {error}"
            ))
        })?;

        sqlx::query("DELETE FROM project_insights WHERE project_id = $1::uuid")
            .bind(project_id)
            .execute(&mut *tx)
            .await
            .map_err(|error| {
                AgentScopeError::Storage(format!(
                    "failed to clear project insights for project {project_id}: {error}"
                ))
            })?;

        for insight in insights {
            sqlx::query(
                r#"
                INSERT INTO project_insights (
                    id,
                    project_id,
                    insight_type,
                    severity,
                    message,
                    evidence,
                    recommendation,
                    run_count,
                    created_at
                )
                VALUES (
                    $1::uuid,
                    $2::uuid,
                    $3,
                    $4,
                    $5,
                    $6,
                    $7,
                    $8,
                    $9
                )
                "#,
            )
            .bind(&insight.id)
            .bind(&insight.project_id)
            .bind(&insight.insight_type)
            .bind(&insight.severity)
            .bind(&insight.message)
            .bind(&insight.evidence)
            .bind(&insight.recommendation)
            .bind(insight.run_count)
            .bind(insight.created_at)
            .execute(&mut *tx)
            .await
            .map_err(|error| {
                AgentScopeError::Storage(format!(
                    "failed to insert project insight {} for project {}: {error}",
                    insight.id, insight.project_id
                ))
            })?;
        }

        tx.commit().await.map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to commit project insights for project {project_id}: {error}"
            ))
        })?;

        info!(%project_id, insight_count = insights.len(), "project insights replaced");
        Ok(())
    }

    pub async fn get_project_insights(
        &self,
        project_id: &str,
    ) -> Result<Vec<ProjectInsight>, AgentScopeError> {
        sqlx::query_as::<_, ProjectInsight>(
            r#"
            SELECT
                id::text AS id,
                project_id::text AS project_id,
                insight_type,
                severity,
                message,
                evidence,
                recommendation,
                run_count,
                created_at
            FROM project_insights
            WHERE project_id = $1::uuid
            ORDER BY created_at DESC, insight_type ASC
            "#,
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to load project insights for project {project_id}: {error}"
            ))
        })
    }

    pub async fn list_recent_runs(&self, limit: i64) -> Result<Vec<Run>, AgentScopeError> {
        sqlx::query_as::<_, Run>(
            r#"
            SELECT
                id::text AS id,
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
            LIMIT $1
            "#,
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| AgentScopeError::Storage(format!("failed to list recent runs: {error}")))
    }

    pub async fn list_recent_runs_for_project(
        &self,
        project_id: &str,
        limit: i64,
    ) -> Result<Vec<Run>, AgentScopeError> {
        sqlx::query_as::<_, Run>(
            r#"
            SELECT
                id::text AS id,
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
            WHERE project_id = $1::uuid
            ORDER BY started_at DESC
            LIMIT $2
            "#,
        )
        .bind(project_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to list recent runs for project {project_id}: {error}"
            ))
        })
    }
}
