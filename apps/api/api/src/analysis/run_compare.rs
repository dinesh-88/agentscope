use std::collections::BTreeSet;

use agentscope_common::errors::AgentScopeError;
use agentscope_storage::Storage;
use agentscope_trace::{Artifact, Run, RunMetrics};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct RunCompareResponse {
    pub run_a: Run,
    pub run_b: Run,
    pub summary: RunCompareSummary,
    pub diffs: RunCompareDiffs,
}

#[derive(Debug, Serialize)]
pub struct RunCompareSummary {
    pub status_changed: bool,
    pub token_delta: i64,
    pub cost_delta: f64,
    pub span_count_delta: i64,
}

#[derive(Debug, Serialize)]
pub struct RunCompareDiffs {
    pub prompts: Vec<ArtifactDiff>,
    pub responses: Vec<ArtifactDiff>,
    pub models: Vec<String>,
    pub artifacts: Vec<ArtifactDiff>,
    pub metrics: MetricsDiff,
    pub spans: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct ArtifactDiff {
    pub label: String,
    pub run_a: Vec<String>,
    pub run_b: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct MetricsDiff {
    pub run_a: RunMetrics,
    pub run_b: RunMetrics,
    pub token_delta: i64,
    pub cost_delta: f64,
}

pub async fn compare_runs(
    storage: &Storage,
    run_a_id: &str,
    run_b_id: &str,
) -> Result<RunCompareResponse, AgentScopeError> {
    let run_a = storage
        .get_run(run_a_id)
        .await?
        .ok_or_else(|| AgentScopeError::Validation(format!("run {run_a_id} not found")))?;
    let run_b = storage
        .get_run(run_b_id)
        .await?
        .ok_or_else(|| AgentScopeError::Validation(format!("run {run_b_id} not found")))?;

    let spans_a = storage.get_spans(run_a_id).await?;
    let spans_b = storage.get_spans(run_b_id).await?;
    let artifacts_a = storage.get_artifacts(run_a_id).await?;
    let artifacts_b = storage.get_artifacts(run_b_id).await?;
    let metrics_a = storage.get_run_metrics(run_a_id).await?;
    let metrics_b = storage.get_run_metrics(run_b_id).await?;

    let model_names = spans_a
        .iter()
        .filter_map(|span| span.model.clone())
        .chain(spans_b.iter().filter_map(|span| span.model.clone()))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();

    let span_names_a = spans_a
        .iter()
        .map(|span| format!("{} [{}]", span.name, span.status))
        .collect::<BTreeSet<_>>();
    let span_names_b = spans_b
        .iter()
        .map(|span| format!("{} [{}]", span.name, span.status))
        .collect::<BTreeSet<_>>();
    let spans = span_names_a
        .symmetric_difference(&span_names_b)
        .cloned()
        .collect::<Vec<_>>();

    Ok(RunCompareResponse {
        summary: RunCompareSummary {
            status_changed: run_a.status != run_b.status,
            token_delta: metrics_b.total_tokens - metrics_a.total_tokens,
            cost_delta: metrics_b.estimated_cost - metrics_a.estimated_cost,
            span_count_delta: spans_b.len() as i64 - spans_a.len() as i64,
        },
        diffs: RunCompareDiffs {
            prompts: diff_artifacts("llm.prompt", &artifacts_a, &artifacts_b),
            responses: diff_artifacts("llm.response", &artifacts_a, &artifacts_b),
            models: model_names,
            artifacts: collect_artifact_kinds(&artifacts_a, &artifacts_b),
            metrics: MetricsDiff {
                token_delta: metrics_b.total_tokens - metrics_a.total_tokens,
                cost_delta: metrics_b.estimated_cost - metrics_a.estimated_cost,
                run_a: metrics_a,
                run_b: metrics_b,
            },
            spans,
        },
        run_a,
        run_b,
    })
}

fn diff_artifacts(
    kind: &str,
    artifacts_a: &[Artifact],
    artifacts_b: &[Artifact],
) -> Vec<ArtifactDiff> {
    let left = artifacts_a
        .iter()
        .filter(|artifact| artifact.kind == kind)
        .collect::<Vec<_>>();
    let right = artifacts_b
        .iter()
        .filter(|artifact| artifact.kind == kind)
        .collect::<Vec<_>>();
    let max_len = left.len().max(right.len());

    (0..max_len)
        .map(|index| ArtifactDiff {
            label: format!("{kind} #{index}"),
            run_a: left
                .get(index)
                .map(|artifact| flatten_payload(&artifact.payload))
                .unwrap_or_default(),
            run_b: right
                .get(index)
                .map(|artifact| flatten_payload(&artifact.payload))
                .unwrap_or_default(),
        })
        .collect()
}

fn collect_artifact_kinds(artifacts_a: &[Artifact], artifacts_b: &[Artifact]) -> Vec<ArtifactDiff> {
    let kinds = artifacts_a
        .iter()
        .map(|artifact| artifact.kind.clone())
        .chain(artifacts_b.iter().map(|artifact| artifact.kind.clone()))
        .collect::<BTreeSet<_>>();

    kinds
        .into_iter()
        .map(|kind| ArtifactDiff {
            label: kind.clone(),
            run_a: artifacts_a
                .iter()
                .filter(|artifact| artifact.kind == kind)
                .map(|artifact| artifact.id.clone())
                .collect(),
            run_b: artifacts_b
                .iter()
                .filter(|artifact| artifact.kind == kind)
                .map(|artifact| artifact.id.clone())
                .collect(),
        })
        .collect()
}

fn flatten_payload(value: &serde_json::Value) -> Vec<String> {
    match value {
        serde_json::Value::Array(items) => items.iter().map(stringify_json).collect(),
        _ => vec![stringify_json(value)],
    }
}

fn stringify_json(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(text) => text.clone(),
        _ => serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string()),
    }
}
