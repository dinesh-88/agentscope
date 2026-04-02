use agentscope_api::analysis::rca_engine;
use agentscope_common::errors::AgentScopeError;
use agentscope_storage::Storage;
use agentscope_trace::RunRootCause;
use chrono::Utc;
use serde_json::Value;
use uuid::Uuid;

pub async fn analyze_completed_runs(storage: &Storage) -> Result<(), AgentScopeError> {
    let runs = storage.list_runs_by_status("completed").await?;

    for run in runs {
        analyze_run(storage, &run.id).await?;
    }

    Ok(())
}

pub async fn analyze_run(storage: &Storage, run_id: &str) -> Result<(), AgentScopeError> {
    let analysis = rca_engine::analyze_run(storage, run_id).await?;
    let suggested_fix = analysis
        .suggested_fixes
        .as_array()
        .and_then(|items| items.first())
        .and_then(Value::as_str)
        .unwrap_or("Inspect run analysis for remediation details.")
        .to_string();

    storage
        .replace_run_root_causes(
            run_id,
            &[RunRootCause {
                id: Uuid::new_v4().to_string(),
                run_id: analysis.run_id,
                root_cause_type: analysis.root_cause_category,
                confidence: 1.0,
                message: analysis.summary,
                evidence: analysis.evidence,
                suggested_fix,
                created_at: Utc::now(),
            }],
        )
        .await?;

    Ok(())
}
