use agentscope_common::errors::AgentScopeError;
use agentscope_trace::{
    ActiveAlert, FailureCluster, ProjectInsight, Run, RunAnalysis, RunExplanation, TrendReport,
};
use chrono::{DateTime, Utc};
use sqlx::QueryBuilder;
use tracing::info;

use crate::Storage;

#[derive(Debug, Clone, Default)]
pub struct TrendRunFilters {
    pub status: Option<String>,
    pub model: Option<String>,
    pub agent_name: Option<String>,
    pub variant: Option<String>,
}

impl Storage {
    pub async fn replace_active_alerts(
        &self,
        project_id: &str,
        alerts: &[ActiveAlert],
    ) -> Result<(), AgentScopeError> {
        let mut tx = self.pool.begin().await.map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to start active alerts transaction for project {project_id}: {error}"
            ))
        })?;

        sqlx::query("DELETE FROM active_alerts WHERE project_id = $1::uuid")
            .bind(project_id)
            .execute(&mut *tx)
            .await
            .map_err(|error| {
                AgentScopeError::Storage(format!(
                    "failed to clear active alerts for project {project_id}: {error}"
                ))
            })?;

        for alert in alerts {
            sqlx::query(
                r#"
                INSERT INTO active_alerts (
                    id,
                    project_id,
                    alert_type,
                    severity,
                    message,
                    evidence,
                    created_at
                )
                VALUES (
                    $1::uuid,
                    $2::uuid,
                    $3,
                    $4,
                    $5,
                    $6,
                    $7
                )
                "#,
            )
            .bind(&alert.id)
            .bind(&alert.project_id)
            .bind(&alert.alert_type)
            .bind(&alert.severity)
            .bind(&alert.message)
            .bind(&alert.evidence)
            .bind(alert.created_at)
            .execute(&mut *tx)
            .await
            .map_err(|error| {
                AgentScopeError::Storage(format!(
                    "failed to insert active alert {} for project {}: {error}",
                    alert.id, alert.project_id
                ))
            })?;
        }

        tx.commit().await.map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to commit active alerts for project {project_id}: {error}"
            ))
        })?;

        info!(%project_id, alert_count = alerts.len(), "active alerts replaced");
        Ok(())
    }

    pub async fn get_active_alerts(
        &self,
        project_id: &str,
    ) -> Result<Vec<ActiveAlert>, AgentScopeError> {
        sqlx::query_as::<_, ActiveAlert>(
            r#"
            SELECT
                id::text AS id,
                project_id::text AS project_id,
                alert_type,
                severity,
                message,
                evidence,
                created_at
            FROM active_alerts
            WHERE project_id = $1::uuid
            ORDER BY
                CASE
                    WHEN lower(severity) = 'critical' THEN 4
                    WHEN lower(severity) = 'high' THEN 3
                    WHEN lower(severity) = 'medium' THEN 2
                    ELSE 1
                END DESC,
                created_at DESC
            "#,
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to load active alerts for project {project_id}: {error}"
            ))
        })
    }

    pub async fn replace_failure_clusters(
        &self,
        project_id: &str,
        clusters: &[FailureCluster],
    ) -> Result<(), AgentScopeError> {
        let mut tx = self.pool.begin().await.map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to start failure clusters transaction for project {project_id}: {error}"
            ))
        })?;

        sqlx::query("DELETE FROM failure_clusters WHERE project_id = $1::uuid")
            .bind(project_id)
            .execute(&mut *tx)
            .await
            .map_err(|error| {
                AgentScopeError::Storage(format!(
                    "failed to clear failure clusters for project {project_id}: {error}"
                ))
            })?;

        for cluster in clusters {
            sqlx::query(
                r#"
                INSERT INTO failure_clusters (
                    id,
                    project_id,
                    cluster_key,
                    error_type,
                    count,
                    sample_run_ids,
                    common_span,
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
                    $8
                )
                "#,
            )
            .bind(&cluster.id)
            .bind(&cluster.project_id)
            .bind(&cluster.cluster_key)
            .bind(&cluster.error_type)
            .bind(cluster.count)
            .bind(&cluster.sample_run_ids)
            .bind(&cluster.common_span)
            .bind(cluster.created_at)
            .execute(&mut *tx)
            .await
            .map_err(|error| {
                AgentScopeError::Storage(format!(
                    "failed to insert failure cluster {} for project {}: {error}",
                    cluster.id, cluster.project_id
                ))
            })?;
        }

        tx.commit().await.map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to commit failure clusters for project {project_id}: {error}"
            ))
        })?;

        info!(
            %project_id,
            cluster_count = clusters.len(),
            "failure clusters replaced"
        );
        Ok(())
    }

    pub async fn get_failure_clusters(
        &self,
        project_id: &str,
    ) -> Result<Vec<FailureCluster>, AgentScopeError> {
        sqlx::query_as::<_, FailureCluster>(
            r#"
            SELECT
                id::text AS id,
                project_id::text AS project_id,
                cluster_key,
                error_type,
                count,
                sample_run_ids,
                common_span,
                created_at
            FROM failure_clusters
            WHERE project_id = $1::uuid
            ORDER BY count DESC, created_at DESC
            "#,
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to load failure clusters for project {project_id}: {error}"
            ))
        })
    }

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
            WHERE deleted_at IS NULL
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
              AND deleted_at IS NULL
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

    pub async fn upsert_run_explanation(
        &self,
        explanation: &RunExplanation,
    ) -> Result<(), AgentScopeError> {
        sqlx::query(
            r#"
            INSERT INTO run_explanations (
                run_id,
                summary,
                top_issue,
                why_it_matters,
                next_action,
                recommended_order,
                created_at
            )
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (run_id) DO UPDATE
            SET summary = EXCLUDED.summary,
                top_issue = EXCLUDED.top_issue,
                why_it_matters = EXCLUDED.why_it_matters,
                next_action = EXCLUDED.next_action,
                recommended_order = EXCLUDED.recommended_order,
                created_at = EXCLUDED.created_at
            "#,
        )
        .bind(&explanation.run_id)
        .bind(&explanation.summary)
        .bind(&explanation.top_issue)
        .bind(&explanation.why_it_matters)
        .bind(&explanation.next_action)
        .bind(&explanation.recommended_order)
        .bind(explanation.created_at)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to upsert run explanation for run {}: {error}",
                explanation.run_id
            ))
        })?;

        Ok(())
    }

    pub async fn get_run_explanation(
        &self,
        run_id: &str,
    ) -> Result<Option<RunExplanation>, AgentScopeError> {
        sqlx::query_as::<_, RunExplanation>(
            r#"
            SELECT
                run_id::text AS run_id,
                summary,
                top_issue,
                why_it_matters,
                next_action,
                recommended_order,
                created_at
            FROM run_explanations
            WHERE run_id = $1::uuid
            "#,
        )
        .bind(run_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to load run explanation for run {run_id}: {error}"
            ))
        })
    }

    pub async fn list_runs_for_window(
        &self,
        project_id: &str,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
        filters: &TrendRunFilters,
    ) -> Result<Vec<Run>, AgentScopeError> {
        let mut query = QueryBuilder::<sqlx::Postgres>::new(
            r#"
            SELECT
                runs.id::text AS id,
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
            WHERE runs.project_id = "#,
        );
        query.push_bind(project_id).push("::uuid");
        query.push(" AND runs.deleted_at IS NULL");
        query.push(" AND runs.started_at >= ");
        query.push_bind(start);
        query.push(" AND runs.started_at <= ");
        query.push_bind(end);

        if let Some(status) = filters.status.as_deref().filter(|value| !value.is_empty()) {
            query.push(" AND runs.status = ");
            query.push_bind(status);
        }
        if let Some(agent_name) = filters
            .agent_name
            .as_deref()
            .filter(|value| !value.is_empty())
        {
            query.push(" AND runs.agent_name = ");
            query.push_bind(agent_name);
        }
        if let Some(variant) = filters.variant.as_deref().filter(|value| !value.is_empty()) {
            query.push(" AND runs.variant = ");
            query.push_bind(variant);
        }
        if let Some(model) = filters.model.as_deref().filter(|value| !value.is_empty()) {
            query.push(
                r#" AND EXISTS (
                    SELECT 1
                    FROM spans
                    WHERE spans.run_id = runs.id
                      AND spans.model = "#,
            );
            query.push_bind(model);
            query.push(")");
        }

        query.push(" ORDER BY runs.started_at DESC");

        query
            .build_query_as::<Run>()
            .fetch_all(&self.pool)
            .await
            .map_err(|error| {
                AgentScopeError::Storage(format!(
                    "failed to load runs for trend window on project {project_id}: {error}"
                ))
            })
    }

    pub async fn insert_trend_report(&self, report: &TrendReport) -> Result<(), AgentScopeError> {
        sqlx::query(
            r#"
            INSERT INTO trend_reports (id, project_id, window, summary, trends, created_at)
            VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
            "#,
        )
        .bind(&report.id)
        .bind(&report.project_id)
        .bind(&report.window)
        .bind(&report.summary)
        .bind(&report.trends)
        .bind(report.created_at)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to store trend report for project {}: {error}",
                report.project_id
            ))
        })?;

        Ok(())
    }
}
