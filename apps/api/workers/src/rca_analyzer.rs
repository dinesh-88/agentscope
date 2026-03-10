use agentscope_common::errors::AgentScopeError;
use agentscope_storage::Storage;
use agentscope_trace::{Artifact, RunRootCause, Span};
use chrono::Utc;
use serde_json::{json, Value};
use tracing::info;
use uuid::Uuid;

pub async fn analyze_completed_runs(storage: &Storage) -> Result<(), AgentScopeError> {
    let runs = storage.list_runs_by_status("completed").await?;

    for run in runs {
        analyze_run(storage, &run.id).await?;
    }

    Ok(())
}

pub async fn analyze_run(storage: &Storage, run_id: &str) -> Result<(), AgentScopeError> {
    let spans = storage.get_spans(run_id).await?;
    let artifacts = storage.get_artifacts(run_id).await?;

    let root_causes = classify_root_causes(run_id, &spans, &artifacts);
    storage
        .replace_run_root_causes(run_id, &root_causes)
        .await?;

    info!(%run_id, root_cause_count = root_causes.len(), "rca analysis completed");
    Ok(())
}

fn classify_root_causes(run_id: &str, spans: &[Span], artifacts: &[Artifact]) -> Vec<RunRootCause> {
    let mut candidates = Vec::new();

    if let Some(root_cause) = detect_tool_failure(run_id, spans, artifacts) {
        candidates.push(root_cause);
    }
    if let Some(root_cause) = detect_schema_validation_error(run_id, artifacts) {
        candidates.push(root_cause);
    }
    if let Some(root_cause) = detect_retrieval_failure(run_id, spans, artifacts) {
        candidates.push(root_cause);
    }
    if let Some(root_cause) = detect_context_overflow(run_id, spans) {
        candidates.push(root_cause);
    }
    if let Some(root_cause) = detect_provider_error(run_id, spans, artifacts) {
        candidates.push(root_cause);
    }

    candidates.sort_by(|left, right| right.confidence.total_cmp(&left.confidence));
    candidates.truncate(1);
    candidates
}

fn detect_tool_failure(
    run_id: &str,
    spans: &[Span],
    artifacts: &[Artifact],
) -> Option<RunRootCause> {
    let span = spans.iter().find(|span| {
        span.span_type == "tool_call" && matches!(span.status.as_str(), "error" | "failed")
    })?;

    let error_payload = artifacts
        .iter()
        .find(|artifact| {
            artifact.span_id.as_deref() == Some(span.id.as_str()) && artifact.kind == "error"
        })
        .map(|artifact| artifact.payload.clone())
        .unwrap_or_else(|| json!({ "span_id": span.id, "status": span.status }));

    Some(build_root_cause(
        run_id,
        "TOOL_FAILURE",
        0.95,
        format!("Tool call span {} failed during execution.", span.name),
        error_payload,
        "Inspect the failing tool integration, validate tool inputs, and add retries or fallback behavior for transient tool errors.".to_string(),
    ))
}

fn detect_schema_validation_error(run_id: &str, artifacts: &[Artifact]) -> Option<RunRootCause> {
    let artifact = artifacts.iter().find(|artifact| {
        let message = artifact
            .payload
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_lowercase();
        artifact.kind.to_lowercase().contains("schema")
            || message.contains("json parse error")
            || message.contains("jsondecodeerror")
            || message.contains("schema validation")
    })?;

    Some(build_root_cause(
        run_id,
        "SCHEMA_VALIDATION_ERROR",
        0.93,
        "The run produced malformed JSON or failed schema validation.".to_string(),
        artifact.payload.clone(),
        "Tighten structured output instructions, enforce response format examples, and validate model output before downstream parsing.".to_string(),
    ))
}

fn detect_retrieval_failure(
    run_id: &str,
    spans: &[Span],
    artifacts: &[Artifact],
) -> Option<RunRootCause> {
    if let Some(artifact) = artifacts
        .iter()
        .find(|artifact| extracted_docs_count(&artifact.payload) == Some(0))
    {
        return Some(build_root_cause(
            run_id,
            "RETRIEVAL_FAILURE",
            0.88,
            "The retrieval step returned zero documents.".to_string(),
            artifact.payload.clone(),
            "Check query construction, retrieval filters, and index freshness; add fallback search or broader retrieval when zero results are returned.".to_string(),
        ));
    }

    let span = spans.iter().find(|span| {
        span.span_type == "retrieval" && matches!(span.status.as_str(), "error" | "failed")
    })?;

    Some(build_root_cause(
        run_id,
        "RETRIEVAL_FAILURE",
        0.8,
        format!("Retrieval span {} failed and likely produced no usable documents.", span.name),
        json!({ "span_id": span.id, "status": span.status }),
        "Review retrieval dependencies and add diagnostics around query generation and empty-result handling.".to_string(),
    ))
}

fn detect_context_overflow(run_id: &str, spans: &[Span]) -> Option<RunRootCause> {
    let span = spans.iter().find(|span| {
        let context_window = span.model.as_deref().and_then(estimate_context_window);
        match (span.input_tokens, context_window) {
            (Some(input_tokens), Some(window)) => input_tokens > window,
            _ => false,
        }
    })?;

    let model = span.model.clone().unwrap_or_else(|| "unknown".to_string());
    let context_window = estimate_context_window(model.as_str()).unwrap_or_default();

    Some(build_root_cause(
        run_id,
        "CONTEXT_OVERFLOW",
        0.97,
        format!(
            "Span {} sent {} input tokens to model {}, exceeding the estimated {}-token context window.",
            span.name,
            span.input_tokens.unwrap_or_default(),
            model,
            context_window
        ),
        json!({
            "span_id": span.id,
            "model": model,
            "input_tokens": span.input_tokens,
            "context_window": context_window
        }),
        "Trim prompt content, summarize long conversation history, and cap retrieved context before the model call.".to_string(),
    ))
}

fn detect_provider_error(
    run_id: &str,
    spans: &[Span],
    artifacts: &[Artifact],
) -> Option<RunRootCause> {
    let artifact = artifacts.iter().find(|artifact| {
        extract_http_status(&artifact.payload).is_some_and(|status| status >= 500)
    })?;
    let http_status = extract_http_status(&artifact.payload).unwrap_or_default();

    let related_span = artifact
        .span_id
        .as_ref()
        .and_then(|span_id| spans.iter().find(|span| span.id == *span_id));

    Some(build_root_cause(
        run_id,
        "PROVIDER_API_ERROR",
        0.91,
        format!("The provider API returned HTTP {}.", http_status),
        json!({
            "http_status": http_status,
            "artifact_kind": artifact.kind,
            "span_id": related_span.map(|span| span.id.clone())
        }),
        "Add retries with backoff, provider failover, and alerting for upstream API instability."
            .to_string(),
    ))
}

fn build_root_cause(
    run_id: &str,
    root_cause_type: &str,
    confidence: f64,
    message: String,
    evidence: Value,
    suggested_fix: String,
) -> RunRootCause {
    RunRootCause {
        id: Uuid::new_v4().to_string(),
        run_id: run_id.to_string(),
        root_cause_type: root_cause_type.to_string(),
        confidence,
        message,
        evidence,
        suggested_fix,
        created_at: Utc::now(),
    }
}

fn extract_http_status(payload: &Value) -> Option<i64> {
    [
        payload.get("http_status"),
        payload.get("status_code"),
        payload
            .get("response")
            .and_then(|value| value.get("http_status")),
        payload
            .get("response")
            .and_then(|value| value.get("status_code")),
    ]
    .into_iter()
    .flatten()
    .find_map(Value::as_i64)
}

fn extracted_docs_count(payload: &Value) -> Option<i64> {
    [
        payload.get("retrieved_docs"),
        payload.get("retrieved_docs_count"),
        payload
            .get("payload")
            .and_then(|value| value.get("retrieved_docs")),
        payload
            .get("payload")
            .and_then(|value| value.get("retrieved_docs_count")),
    ]
    .into_iter()
    .flatten()
    .find_map(Value::as_i64)
}

fn estimate_context_window(model: &str) -> Option<i64> {
    let model = model.to_lowercase();
    if model.contains("gpt-4o-mini") || model.contains("gpt-4o") {
        return Some(128_000);
    }
    if model.contains("claude-3-5") {
        return Some(200_000);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::analyze_completed_runs;
    use agentscope_storage::Storage;
    use chrono::Utc;
    use serde_json::json;
    use sqlx::PgPool;
    use uuid::Uuid;

    #[sqlx::test(migrations = "../storage/migrations")]
    async fn generates_root_cause_for_failed_tool_run(pool: PgPool) {
        let storage = Storage { pool: pool.clone() };
        let project_id = seed_project(&pool).await;
        let run_id = Uuid::new_v4().to_string();
        let span_id = Uuid::new_v4().to_string();

        sqlx::query(
            r#"
            INSERT INTO runs (id, project_id, workflow_name, agent_name, status, started_at, ended_at)
            VALUES ($1::uuid, $2::uuid, 'analysis', 'worker', 'completed', $3, $4)
            "#,
        )
        .bind(&run_id)
        .bind(&project_id)
        .bind(Utc::now())
        .bind(Utc::now())
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            r#"
            INSERT INTO spans
                (id, run_id, parent_span_id, span_type, name, status, started_at, ended_at)
            VALUES
                ($1::uuid, $2::uuid, NULL, 'tool_call', 'search_tool', 'failed', $3, $4)
            "#,
        )
        .bind(&span_id)
        .bind(&run_id)
        .bind(Utc::now())
        .bind(Utc::now())
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            r#"
            INSERT INTO artifacts (id, run_id, span_id, kind, payload)
            VALUES ($1::uuid, $2::uuid, $3::uuid, 'error', $4)
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(Uuid::parse_str(&run_id).unwrap())
        .bind(Uuid::parse_str(&span_id).unwrap())
        .bind(json!({"error_type": "RuntimeError", "message": "tool execution failed"}))
        .execute(&pool)
        .await
        .unwrap();

        analyze_completed_runs(&storage).await.unwrap();

        let root_causes = storage.get_run_root_causes(&run_id).await.unwrap();
        assert_eq!(root_causes.len(), 1);
        assert_eq!(root_causes[0].root_cause_type, "TOOL_FAILURE");
        assert!(root_causes[0].evidence["message"]
            .as_str()
            .unwrap()
            .contains("tool"));
    }

    async fn seed_project(pool: &PgPool) -> String {
        let org_id: String = sqlx::query_scalar(
            "INSERT INTO organizations (name) VALUES ('test-org') RETURNING id::text",
        )
        .fetch_one(pool)
        .await
        .unwrap();

        sqlx::query_scalar(
            "INSERT INTO projects (organization_id, name) VALUES ($1::uuid, 'test-project') RETURNING id::text",
        )
        .bind(org_id)
        .fetch_one(pool)
        .await
        .unwrap()
    }
}
