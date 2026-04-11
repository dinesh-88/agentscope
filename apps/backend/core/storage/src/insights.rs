use agentscope_common::errors::AgentScopeError;
use agentscope_trace::RunInsight;
use tracing::info;

use crate::Storage;

impl Storage {
    pub async fn replace_run_insights(
        &self,
        run_id: &str,
        insights: &[RunInsight],
    ) -> Result<(), AgentScopeError> {
        let mut tx = self.begin_tx().await.map_err(|e| {
            AgentScopeError::Storage(format!("failed to start insights transaction: {e}"))
        })?;

        sqlx::query("DELETE FROM run_insights WHERE run_id = $1::uuid")
            .bind(run_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                AgentScopeError::Storage(format!("failed to delete insights for run {run_id}: {e}"))
            })?;

        for insight in insights {
            sqlx::query(
                r#"
                INSERT INTO run_insights
                    (
                        id,
                        run_id,
                        insight_type,
                        severity,
                        is_primary,
                        title,
                        cause,
                        impact,
                        fix,
                        message,
                        recommendation,
                        created_at,
                        evidence,
                        impact_score,
                        fix_suggestions,
                        related_transition_from_span_id,
                        related_transition_to_span_id,
                        cause_confidence,
                        derived_from_transition
                    )
                VALUES
                    ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
                "#,
            )
            .bind(&insight.id)
            .bind(&insight.run_id)
            .bind(&insight.insight_type)
            .bind(&insight.severity)
            .bind(insight.is_primary)
            .bind(&insight.title)
            .bind(&insight.cause)
            .bind(&insight.impact)
            .bind(serde_json::to_value(&insight.fix).unwrap_or_else(|_| serde_json::json!([])))
            .bind(&insight.message)
            .bind(&insight.recommendation)
            .bind(insight.created_at)
            .bind(&insight.evidence)
            .bind(insight.impact_score as f64)
            .bind(serde_json::to_value(&insight.fix_suggestions).unwrap_or_else(|_| serde_json::json!([])))
            .bind(&insight.related_transition_from_span_id)
            .bind(&insight.related_transition_to_span_id)
            .bind(&insight.cause_confidence)
            .bind(insight.derived_from_transition)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                AgentScopeError::Storage(format!(
                    "failed to insert insight {} for run {}: {e}",
                    insight.id, insight.run_id
                ))
            })?;
        }

        tx.commit().await.map_err(|e| {
            AgentScopeError::Storage(format!("failed to commit insights for run {run_id}: {e}"))
        })?;

        info!(%run_id, insight_count = insights.len(), "run insights replaced");
        Ok(())
    }

    pub async fn get_run_insights(&self, run_id: &str) -> Result<Vec<RunInsight>, AgentScopeError> {
        let insights = sqlx::query_as::<_, RunInsight>(
            r#"
            SELECT
                id::text AS id,
                run_id::text AS run_id,
                insight_type,
                severity,
                is_primary,
                title,
                cause,
                impact,
                fix,
                message,
                recommendation,
                created_at,
                evidence,
                impact_score::real AS impact_score,
                fix_suggestions,
                related_transition_from_span_id,
                related_transition_to_span_id,
                cause_confidence,
                derived_from_transition
            FROM run_insights
            WHERE run_id = $1::uuid
            ORDER BY impact_score DESC, created_at ASC, insight_type ASC
            "#,
        )
        .bind(run_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| {
            AgentScopeError::Storage(format!("failed to get insights for run {run_id}: {e}"))
        })?;

        Ok(insights)
    }
}
