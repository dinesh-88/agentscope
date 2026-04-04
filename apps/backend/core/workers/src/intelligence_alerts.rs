use agentscope_common::errors::AgentScopeError;
use agentscope_storage::Storage;
use tracing::info;

pub async fn evaluate(storage: &Storage) -> Result<(), AgentScopeError> {
    let project_ids = storage.list_projects_for_intelligence_alerts().await?;
    if project_ids.is_empty() {
        info!("intelligence alert evaluation complete: no eligible projects");
        return Ok(());
    }

    let mut created_total = 0usize;
    for project_id in project_ids {
        created_total += storage
            .evaluate_issue_alerts_for_project(&project_id)
            .await?;
    }

    info!(created_total, "intelligence alert evaluation complete");
    Ok(())
}
