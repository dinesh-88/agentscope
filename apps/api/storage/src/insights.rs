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
        let mut tx = self.pool.begin().await.map_err(|e| {
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
                    (id, run_id, insight_type, severity, message, recommendation, created_at, evidence, impact_score)
                VALUES
                    ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9)
                "#,
            )
            .bind(&insight.id)
            .bind(&insight.run_id)
            .bind(&insight.insight_type)
            .bind(&insight.severity)
            .bind(&insight.message)
            .bind(&insight.recommendation)
            .bind(insight.created_at)
            .bind(&insight.evidence)
            .bind(insight.impact_score as f64)
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
                message,
                recommendation,
                created_at,
                evidence,
                impact_score::real AS impact_score
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
