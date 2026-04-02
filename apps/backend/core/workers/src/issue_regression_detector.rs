use agentscope_common::errors::AgentScopeError;
use agentscope_storage::Storage;
use tracing::info;

pub async fn detect(storage: &Storage) -> Result<(), AgentScopeError> {
    let project_ids = storage.list_projects_with_issue_rankings(7).await?;
    if project_ids.is_empty() {
        info!("issue regression detector complete: no ranked projects");
        return Ok(());
    }

    let mut total_detected = 0usize;
    for project_id in project_ids {
        total_detected += storage.detect_regressions(&project_id).await?;
    }

    info!(total_detected, "issue regression detector complete");
    Ok(())
}
