use agentscope_common::errors::AgentScopeError;
use agentscope_storage::Storage;
use tracing::info;

pub async fn evaluate(storage: &Storage) -> Result<(), AgentScopeError> {
    let triggered = storage.evaluate_and_trigger_alerts().await?;
    info!(triggered, "alert evaluation complete");
    Ok(())
}
