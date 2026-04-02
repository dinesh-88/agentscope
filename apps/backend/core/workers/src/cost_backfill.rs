use std::collections::HashSet;

use agentscope_api::analysis::pricing;
use agentscope_common::errors::AgentScopeError;
use agentscope_storage::Storage;
use serde_json::Value;
use sqlx::FromRow;
use tracing::info;

#[derive(Debug, Clone, FromRow)]
struct ArtifactSpanRow {
    span_id: String,
    run_id: String,
    payload: Value,
    model: Option<String>,
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
    total_tokens: Option<i64>,
    estimated_cost: Option<f64>,
}

#[derive(Debug, Clone, Default)]
struct UsageSnapshot {
    model: Option<String>,
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
    total_tokens: Option<i64>,
    explicit_cost: Option<f64>,
}

pub async fn backfill(storage: &Storage, limit: i64) -> Result<usize, AgentScopeError> {
    let batch_limit = limit.clamp(100, 20_000);

    let rows = sqlx::query_as::<_, ArtifactSpanRow>(
        r#"
        SELECT
            a.span_id::text AS span_id,
            a.run_id::text AS run_id,
            a.payload,
            s.model,
            s.input_tokens,
            s.output_tokens,
            s.total_tokens,
            s.estimated_cost
        FROM artifacts a
        INNER JOIN spans s
            ON s.id = a.span_id
        WHERE a.span_id IS NOT NULL
          AND a.kind IN ('llm.response', 'llm_payload')
          AND (
            s.input_tokens IS NULL
            OR s.output_tokens IS NULL
            OR s.total_tokens IS NULL
            OR COALESCE(s.estimated_cost, 0.0) = 0.0
            OR s.model IS NULL
          )
        ORDER BY a.id ASC
        LIMIT $1
        "#,
    )
    .bind(batch_limit)
    .fetch_all(&storage.pool)
    .await
    .map_err(|error| {
        AgentScopeError::Storage(format!("failed to load artifact/span rows for cost backfill: {error}"))
    })?;

    if rows.is_empty() {
        info!("cost backfill complete: no candidate spans");
        return Ok(0);
    }

    let mut updated_spans = 0usize;
    let mut touched_runs = HashSet::<String>::new();

    for row in rows {
        let mut usage = UsageSnapshot::default();
        usage.model = row
            .payload
            .get("model")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .or_else(|| {
                row.payload
                    .get("response")
                    .and_then(|response| response.get("model"))
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            })
            .or(row.model.clone());

        usage.input_tokens = extract_i64(&row.payload, &["input_tokens", "prompt_tokens"])
            .or_else(|| {
                row.payload
                    .get("usage")
                    .and_then(|usage| extract_i64(usage, &["input_tokens", "prompt_tokens"]))
            })
            .or(row.input_tokens);

        usage.output_tokens = extract_i64(&row.payload, &["output_tokens", "completion_tokens"])
            .or_else(|| {
                row.payload
                    .get("usage")
                    .and_then(|usage| extract_i64(usage, &["output_tokens", "completion_tokens"]))
            })
            .or(row.output_tokens);

        usage.total_tokens = extract_i64(&row.payload, &["total_tokens"])
            .or_else(|| row.payload.get("usage").and_then(|usage| extract_i64(usage, &["total_tokens"])))
            .or_else(|| {
                Some(usage.input_tokens.unwrap_or(0) + usage.output_tokens.unwrap_or(0))
            })
            .or(row.total_tokens);

        usage.explicit_cost = extract_f64(
            &row.payload,
            &["cost", "estimated_cost", "total_cost", "cost_usd", "total_cost_usd"],
        )
        .or_else(|| {
            row.payload.get("usage").and_then(|usage| {
                extract_f64(
                    usage,
                    &["cost", "estimated_cost", "total_cost", "cost_usd", "total_cost_usd"],
                )
            })
        })
        .or(row.estimated_cost);

        let estimated_cost = if usage.explicit_cost.unwrap_or(0.0) > 0.0 {
            usage.explicit_cost
        } else if let Some(model) = usage.model.as_deref() {
            Some(pricing::estimate_cost(
                model,
                usage.input_tokens.unwrap_or(0) as i32,
                usage.output_tokens.unwrap_or(0) as i32,
            ))
            .filter(|value| *value > 0.0)
        } else {
            row.estimated_cost
        };

        let update = sqlx::query(
            r#"
            UPDATE spans
            SET
                model = COALESCE($2, model),
                input_tokens = COALESCE($3, input_tokens),
                output_tokens = COALESCE($4, output_tokens),
                total_tokens = COALESCE($5, total_tokens),
                estimated_cost = COALESCE(NULLIF($6, 0.0), estimated_cost)
            WHERE id = $1::uuid
            "#,
        )
        .bind(&row.span_id)
        .bind(usage.model)
        .bind(usage.input_tokens)
        .bind(usage.output_tokens)
        .bind(usage.total_tokens)
        .bind(estimated_cost)
        .execute(&storage.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!("failed to update span {} during cost backfill: {error}", row.span_id))
        })?;

        if update.rows_affected() > 0 {
            updated_spans += 1;
            touched_runs.insert(row.run_id);
        }
    }

    for run_id in touched_runs {
        storage.update_run_metrics(&run_id).await?;
    }

    info!(updated_spans, "cost backfill complete");
    Ok(updated_spans)
}

fn extract_i64(value: &Value, keys: &[&str]) -> Option<i64> {
    for key in keys {
        if let Some(found) = value.get(*key) {
            if let Some(number) = found.as_i64() {
                return Some(number.max(0));
            }
            if let Some(number) = found.as_u64() {
                return Some((number.min(i64::MAX as u64)) as i64);
            }
            if let Some(text) = found.as_str() {
                if let Ok(parsed) = text.parse::<i64>() {
                    return Some(parsed.max(0));
                }
            }
        }
    }
    None
}

fn extract_f64(value: &Value, keys: &[&str]) -> Option<f64> {
    for key in keys {
        if let Some(found) = value.get(*key) {
            if let Some(number) = found.as_f64() {
                return Some(number.max(0.0));
            }
            if let Some(text) = found.as_str() {
                if let Ok(parsed) = text.parse::<f64>() {
                    return Some(parsed.max(0.0));
                }
            }
        }
    }
    None
}
