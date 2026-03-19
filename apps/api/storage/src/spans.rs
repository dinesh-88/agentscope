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
                latency_ms,
                success,
                error_type,
                error_source,
                retryable,
                prompt_hash,
                prompt_template_id,
                temperature,
                top_p,
                max_tokens,
                retry_attempt,
                max_attempts,
                tool_name,
                tool_version,
                tool_latency_ms,
                tool_success,
                evaluation,
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
                $24,
                $25,
                $26,
                $27,
                $28,
                $29,
                $30,
                $31,
                $32,
                (
                    CASE
                        WHEN $33::jsonb = 'null'::jsonb THEN NULL
                        ELSE $33::jsonb
                    END
                ),
                (
                    CASE
                        WHEN $34::jsonb = 'null'::jsonb THEN NULL
                        ELSE $34::jsonb
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
                latency_ms = EXCLUDED.latency_ms,
                success = EXCLUDED.success,
                error_type = EXCLUDED.error_type,
                error_source = EXCLUDED.error_source,
                retryable = EXCLUDED.retryable,
                prompt_hash = EXCLUDED.prompt_hash,
                prompt_template_id = EXCLUDED.prompt_template_id,
                temperature = EXCLUDED.temperature,
                top_p = EXCLUDED.top_p,
                max_tokens = EXCLUDED.max_tokens,
                retry_attempt = EXCLUDED.retry_attempt,
                max_attempts = EXCLUDED.max_attempts,
                tool_name = EXCLUDED.tool_name,
                tool_version = EXCLUDED.tool_version,
                tool_latency_ms = EXCLUDED.tool_latency_ms,
                tool_success = EXCLUDED.tool_success,
                evaluation = EXCLUDED.evaluation,
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
        .bind(span.latency_ms)
        .bind(span.success)
        .bind(&span.error_type)
        .bind(&span.error_source)
        .bind(span.retryable)
        .bind(&span.prompt_hash)
        .bind(&span.prompt_template_id)
        .bind(span.temperature)
        .bind(span.top_p)
        .bind(span.max_tokens)
        .bind(span.retry_attempt)
        .bind(span.max_attempts)
        .bind(&span.tool_name)
        .bind(&span.tool_version)
        .bind(span.tool_latency_ms)
        .bind(span.tool_success)
        .bind(&span.evaluation)
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
                   latency_ms,
                   success,
                   error_type,
                   error_source,
                   retryable,
                   prompt_hash,
                   prompt_template_id,
                   temperature,
                   top_p,
                   max_tokens,
                   retry_attempt,
                   max_attempts,
                   tool_name,
                   tool_version,
                   tool_latency_ms,
                   tool_success,
                   evaluation,
                   metadata
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
                $1::text AS run_id,
                COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
                COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
                COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
                COALESCE(SUM(estimated_cost), 0.0)::double precision AS estimated_cost
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
