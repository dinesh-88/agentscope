use agentscope_api::analysis::insights_engine;
use agentscope_common::errors::AgentScopeError;
use agentscope_storage::Storage;

pub async fn analyze_completed_runs(storage: &Storage) -> Result<(), AgentScopeError> {
    insights_engine::analyze_recent_projects(storage).await
}

pub async fn analyze_run(storage: &Storage, run_id: &str) -> Result<(), AgentScopeError> {
    let run = storage
        .get_run(run_id)
        .await?
        .ok_or_else(|| AgentScopeError::Validation(format!("run {run_id} not found")))?;

    insights_engine::analyze_project(storage, &run.project_id).await?;
    Ok(())
}
