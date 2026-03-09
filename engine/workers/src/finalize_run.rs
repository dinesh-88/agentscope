use agentscope_common::errors::AgentScopeError;
use agentscope_storage::Storage;
use chrono::Utc;
use tracing::info;

pub async fn finalize_run(
    storage: &Storage,
    run_id: &str,
    status: &str,
) -> Result<(), AgentScopeError> {
    let ended_at = Utc::now();

    sqlx::query("UPDATE runs SET status = $1, ended_at = $2 WHERE id = $3::uuid")
        .bind(status)
        .bind(ended_at)
        .bind(run_id)
        .execute(&storage.pool)
        .await
        .map_err(|e| AgentScopeError::Storage(format!("failed to finalize run {run_id}: {e}")))?;

    info!(%run_id, %status, %ended_at, "run finalized");
    Ok(())
}
