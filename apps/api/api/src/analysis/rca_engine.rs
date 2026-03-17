use agentscope_common::errors::AgentScopeError;
use agentscope_storage::Storage;
use agentscope_trace::RunAnalysis;
use chrono::Utc;
use serde_json::json;
use uuid::Uuid;

use crate::analysis::{classifiers::classify_root_cause, detectors::detect_failure_types};

pub async fn analyze_run(storage: &Storage, run_id: &str) -> Result<RunAnalysis, AgentScopeError> {
    let run = storage
        .get_run(run_id)
        .await?
        .ok_or_else(|| AgentScopeError::Validation(format!("run {run_id} not found")))?;
    let spans = storage.get_spans(run_id).await?;
    let artifacts = storage.get_artifacts(run_id).await?;

    let detections = detect_failure_types(&spans, &artifacts);
    let classification = classify_root_cause(&detections);
    let now = Utc::now();

    let analysis = RunAnalysis {
        id: Uuid::new_v4().to_string(),
        run_id: run.id.clone(),
        project_id: run.project_id.clone(),
        failure_types: json!(detections
            .iter()
            .map(|detection| detection.failure_type)
            .collect::<Vec<_>>()),
        root_cause_category: classification.root_cause_category.to_string(),
        summary: classification.summary,
        evidence: classification.evidence,
        suggested_fixes: json!(classification.suggested_fixes),
        created_at: now,
        updated_at: now,
    };

    storage.upsert_run_analysis(&analysis).await?;
    Ok(analysis)
}
