use agentscope_common::errors::AgentScopeError;
use agentscope_trace::{RunMetrics, Span};
use tracing::info;

use crate::Storage;

impl Storage {
    pub async fn insert_span(&self, span: &Span) -> Result<(), AgentScopeError> {
        let input_tokens = span.input_tokens.unwrap_or(0);
        let output_tokens = span.output_tokens.unwrap_or(0);
        let total_tokens = span.total_tokens.or_else(|| {
            if span.input_tokens.is_some() || span.output_tokens.is_some() {
                Some(input_tokens + output_tokens)
            } else {
                None
            }
        });

        sqlx::query(
            r#"
            INSERT INTO spans (
                id,
                run_id,
                parent_span_id,
                span_type,
                name,
                status,
                started_at,
                ended_at,
                provider,
                model,
                input_tokens,
                output_tokens,
                total_tokens,
                estimated_cost
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
                (
                    SELECT
                        CASE
                            WHEN $9 IS NULL OR $10 IS NULL OR ($11 IS NULL AND $12 IS NULL) THEN NULL
                            ELSE (COALESCE($11, 0)::double precision * mp.input_price)
                               + (COALESCE($12, 0)::double precision * mp.output_price)
                        END
                    FROM model_pricing mp
                    WHERE mp.provider = $9 AND mp.model = $10
                )
            )
            ON CONFLICT (id) DO UPDATE
            SET run_id = EXCLUDED.run_id,
                parent_span_id = EXCLUDED.parent_span_id,
                span_type = EXCLUDED.span_type,
                name = EXCLUDED.name,
                status = EXCLUDED.status,
                started_at = EXCLUDED.started_at,
                ended_at = EXCLUDED.ended_at,
                provider = EXCLUDED.provider,
                model = EXCLUDED.model,
                input_tokens = EXCLUDED.input_tokens,
                output_tokens = EXCLUDED.output_tokens,
                total_tokens = EXCLUDED.total_tokens,
                estimated_cost = EXCLUDED.estimated_cost
            "#,
        )
        .bind(&span.id)
        .bind(&span.run_id)
        .bind(&span.parent_span_id)
        .bind(&span.span_type)
        .bind(&span.name)
        .bind(&span.status)
        .bind(span.started_at)
        .bind(span.ended_at)
        .bind(&span.provider)
        .bind(&span.model)
        .bind(span.input_tokens)
        .bind(span.output_tokens)
        .bind(total_tokens)
        .execute(&self.pool)
        .await
        .map_err(|e| AgentScopeError::Storage(format!("failed to insert span {}: {e}", span.id)))?;

        info!(span_id = %span.id, run_id = %span.run_id, "span inserted");
        Ok(())
    }

    pub async fn get_spans(&self, run_id: &str) -> Result<Vec<Span>, AgentScopeError> {
        let spans = sqlx::query_as::<_, Span>(
            r#"
            SELECT id::text AS id,
                   run_id::text AS run_id,
                   parent_span_id::text AS parent_span_id,
                   span_type,
                   name,
                   status,
                   started_at,
                   ended_at,
                   provider,
                   model,
                   input_tokens,
                   output_tokens,
                   total_tokens,
                   estimated_cost
            FROM spans
            WHERE run_id = $1::uuid
            ORDER BY started_at ASC
            "#,
        )
        .bind(run_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| {
            AgentScopeError::Storage(format!("failed to get spans for run {run_id}: {e}"))
        })?;

        Ok(spans)
    }

    pub async fn get_run_metrics(&self, run_id: &str) -> Result<RunMetrics, AgentScopeError> {
        let metrics = sqlx::query_as::<_, RunMetrics>(
            r#"
            SELECT
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(total_tokens), 0) AS total_tokens,
                COALESCE(SUM(estimated_cost), 0.0) AS estimated_cost
            FROM spans
            WHERE run_id = $1::uuid
            "#,
        )
        .bind(run_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| {
            AgentScopeError::Storage(format!("failed to get metrics for run {run_id}: {e}"))
        })?;

        Ok(metrics)
    }
}
