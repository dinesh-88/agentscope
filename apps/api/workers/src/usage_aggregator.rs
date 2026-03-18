use agentscope_common::errors::AgentScopeError;
use agentscope_storage::Storage;
use tracing::info;

pub async fn aggregate(storage: &Storage) -> Result<(), AgentScopeError> {
    storage.aggregate_project_usage_daily().await?;
    info!("usage aggregation complete");
    Ok(())
}
