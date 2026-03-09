use agentscope_common::errors::AgentScopeError;
use agentscope_trace::Span;
use tracing::info;

use crate::Storage;

impl Storage {
    pub async fn insert_span(&self, span: &Span) -> Result<(), AgentScopeError> {
        sqlx::query(
            r#"
            INSERT INTO spans (id, run_id, parent_span_id, span_type, name, status, started_at, ended_at)
            VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8)
            ON CONFLICT (id) DO UPDATE
            SET run_id = EXCLUDED.run_id,
                parent_span_id = EXCLUDED.parent_span_id,
                span_type = EXCLUDED.span_type,
                name = EXCLUDED.name,
                status = EXCLUDED.status,
                started_at = EXCLUDED.started_at,
                ended_at = EXCLUDED.ended_at
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
                   ended_at
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
}
