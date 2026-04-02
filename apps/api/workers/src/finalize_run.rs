use agentscope_common::errors::AgentScopeError;
use agentscope_storage::Storage;
use chrono::Utc;
use tracing::info;

use crate::prompt_analyzer;
use crate::rca_analyzer;

pub async fn finalize_run(
    storage: &Storage,
    run_id: &str,
    status: &str,
) -> Result<(), AgentScopeError> {
    let ended_at = Utc::now();

    sqlx::query(
        r#"
        UPDATE runs
        SET status = CASE
                WHEN lower(trim($1::text)) IN ('success', 'succeeded', 'ok', 'completed', 'complete') THEN 'success'::run_status_enum
                WHEN lower(trim($1::text)) IN ('failed', 'failure') THEN 'failed'::run_status_enum
                WHEN lower(trim($1::text)) IN ('error', 'errored') THEN 'error'::run_status_enum
                WHEN lower(trim($1::text)) IN ('partial', 'partially_successful', 'partial_success', 'running') THEN 'partial'::run_status_enum
                ELSE 'partial'::run_status_enum
            END,
            ended_at = $2
        WHERE id = $3
        "#,
    )
        .bind(status)
        .bind(ended_at)
        .bind(run_id)
        .execute(&storage.pool)
        .await
        .map_err(|e| AgentScopeError::Storage(format!("failed to finalize run {run_id}: {e}")))?;

    if matches!(status, "completed" | "complete" | "success" | "succeeded" | "ok") {
        prompt_analyzer::analyze_run(storage, run_id).await?;
        rca_analyzer::analyze_run(storage, run_id).await?;
    }

    info!(%run_id, %status, %ended_at, "run finalized");
    Ok(())
}
