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
                estimated_cost,
                context_window,
                context_usage_percent,
                metadata
            )
            VALUES (
                $1,
                $2,
                $3,
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
                (
                    CASE
                        WHEN $17::jsonb = 'null'::jsonb THEN NULL
                        ELSE $17::jsonb
                    END
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
                estimated_cost = EXCLUDED.estimated_cost,
                context_window = EXCLUDED.context_window,
                context_usage_percent = EXCLUDED.context_usage_percent,
                metadata = EXCLUDED.metadata
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
        .bind(span.estimated_cost)
        .bind(span.context_window)
        .bind(span.context_usage_percent)
        .bind(&span.metadata)
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
                   estimated_cost,
                   context_window,
                   context_usage_percent,
                   metadata
            FROM spans
            WHERE run_id = $1
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
                $1::text AS run_id,
                COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
                COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
                COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
                COALESCE(SUM(estimated_cost), 0.0)::double precision AS estimated_cost
            FROM spans
            WHERE run_id = $1
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
