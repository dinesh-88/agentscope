use std::collections::BTreeSet;

use agentscope_common::errors::AgentScopeError;
use agentscope_storage::Storage;
use agentscope_trace::{Artifact, Run, RunMetrics};
use chrono::Duration;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct RunCompareResponse {
    pub run_a: Run,
    pub run_b: Run,
    pub summary: RunCompareSummary,
    pub diffs: RunCompareDiffs,
    pub insights: CompareInsights,
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

#[derive(Debug, Serialize)]
pub struct CompareInsights {
    pub summary: String,
    pub key_changes: Vec<String>,
    pub verdict: String,
    pub recommendation: String,
    pub winner: String,
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

    let summary = RunCompareSummary {
        status_changed: run_a.status != run_b.status,
        token_delta: metrics_b.total_tokens - metrics_a.total_tokens,
        cost_delta: metrics_b.estimated_cost - metrics_a.estimated_cost,
        span_count_delta: spans_b.len() as i64 - spans_a.len() as i64,
    };
    let diffs = RunCompareDiffs {
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
    };
    let insights = build_compare_insights(&run_a, &run_b, &summary, &diffs);

    Ok(RunCompareResponse {
        run_a,
        run_b,
        summary,
        diffs,
        insights,
    })
}

fn build_compare_insights(
    run_a: &Run,
    run_b: &Run,
    summary: &RunCompareSummary,
    diffs: &RunCompareDiffs,
) -> CompareInsights {
    let latency_a = latency_ms(run_a);
    let latency_b = latency_ms(run_b);

    let mut score_b = 0_i32;
    let mut key_changes = Vec::new();

    let status_delta = status_score(&run_b.status) - status_score(&run_a.status);
    if status_delta > 0 {
        score_b += 2;
        key_changes.push(format!(
            "Reliability improved: status changed from {} to {}.",
            run_a.status, run_b.status
        ));
    } else if status_delta < 0 {
        score_b -= 2;
        key_changes.push(format!(
            "Reliability regressed: status changed from {} to {}.",
            run_a.status, run_b.status
        ));
    } else {
        key_changes.push(format!(
            "Status remained {} across both runs.",
            run_b.status
        ));
    }

    if let (Some(a), Some(b)) = (latency_a, latency_b) {
        if b < a {
            score_b += 1;
            let pct = percent_change(a, b);
            key_changes.push(format!(
                "Latency reduced by {:.1}% ({}ms -> {}ms).",
                pct, a, b
            ));
        } else if b > a {
            score_b -= 1;
            let pct = percent_change(a, b);
            key_changes.push(format!(
                "Latency increased by {:.1}% ({}ms -> {}ms).",
                pct, a, b
            ));
        } else {
            key_changes.push(format!("Latency unchanged at {}ms.", a));
        }
    } else {
        key_changes.push("Latency comparison unavailable due to missing timestamps.".to_string());
    }

    if summary.token_delta < 0 {
        score_b += 1;
        key_changes.push(format!(
            "Token usage decreased by {} tokens.",
            summary.token_delta.abs()
        ));
    } else if summary.token_delta > 0 {
        score_b -= 1;
        key_changes.push(format!(
            "Token usage increased by {} tokens.",
            summary.token_delta
        ));
    } else {
        key_changes.push("Token usage unchanged.".to_string());
    }

    if summary.cost_delta < 0.0 {
        score_b += 1;
        key_changes.push(format!(
            "Estimated cost decreased by ${:.6}.",
            summary.cost_delta.abs()
        ));
    } else if summary.cost_delta > 0.0 {
        score_b -= 1;
        key_changes.push(format!(
            "Estimated cost increased by ${:.6}.",
            summary.cost_delta
        ));
    } else {
        key_changes.push("Estimated cost unchanged.".to_string());
    }

    if !diffs.spans.is_empty() {
        key_changes.push(format!(
            "Span behavior changed across {} item(s).",
            diffs.spans.len()
        ));
    }

    let (winner, verdict, recommendation, summary_text) = if score_b > 0 {
        (
            "run_b".to_string(),
            "Run B is better".to_string(),
            "Use Run B configuration".to_string(),
            "Run B improves reliability and/or efficiency versus Run A.".to_string(),
        )
    } else if score_b < 0 {
        (
            "run_a".to_string(),
            "Run A is better".to_string(),
            "Keep Run A and investigate regressions in Run B".to_string(),
            "Run A remains the safer baseline; Run B introduces net regressions.".to_string(),
        )
    } else {
        (
            "tie".to_string(),
            "No clear winner".to_string(),
            "Run targeted evaluations and choose the run that best matches production priorities"
                .to_string(),
            "Both runs are comparable with mixed or minimal impact differences.".to_string(),
        )
    };

    CompareInsights {
        summary: summary_text,
        key_changes: key_changes.into_iter().take(5).collect(),
        verdict,
        recommendation,
        winner,
    }
}

fn status_score(status: &str) -> i32 {
    match status {
        "success" | "completed" => 2,
        "failed" | "error" => 0,
        _ => 1,
    }
}

fn latency_ms(run: &Run) -> Option<i64> {
    let ended_at = run.ended_at?;
    let duration: Duration = ended_at - run.started_at;
    Some(duration.num_milliseconds().max(0))
}

fn percent_change(old: i64, new: i64) -> f64 {
    if old <= 0 {
        return 0.0;
    }
    ((new - old).abs() as f64 / old as f64) * 100.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Duration, Utc};

    fn make_run(id: &str, status: &str, latency_ms: i64) -> Run {
        let started_at = Utc::now();
        Run {
            id: id.to_string(),
            project_id: "project".to_string(),
            organization_id: None,
            user_id: None,
            session_id: None,
            environment: None,
            workflow_name: "workflow".to_string(),
            agent_name: "agent".to_string(),
            status: status.to_string(),
            started_at,
            ended_at: Some(started_at + Duration::milliseconds(latency_ms)),
            total_input_tokens: 0,
            total_output_tokens: 0,
            total_tokens: 0,
            total_cost_usd: 0.0,
            success: None,
            error_count: None,
            avg_latency_ms: None,
            p95_latency_ms: None,
            success_rate: None,
            tags: None,
            experiment_id: None,
            variant: None,
            metadata: None,
        }
    }

    fn make_metrics(tokens: i64, cost: f64, run_id: &str) -> RunMetrics {
        RunMetrics {
            run_id: run_id.to_string(),
            input_tokens: 0,
            output_tokens: 0,
            total_tokens: tokens,
            estimated_cost: cost,
        }
    }

    #[test]
    fn compare_insights_pick_run_b_when_reliability_and_efficiency_improve() {
        let run_a = make_run("a", "failed", 1_500);
        let run_b = make_run("b", "success", 900);

        let summary = RunCompareSummary {
            status_changed: true,
            token_delta: -120,
            cost_delta: -0.002,
            span_count_delta: 0,
        };
        let diffs = RunCompareDiffs {
            prompts: Vec::new(),
            responses: Vec::new(),
            models: Vec::new(),
            artifacts: Vec::new(),
            metrics: MetricsDiff {
                run_a: make_metrics(320, 0.008, "a"),
                run_b: make_metrics(200, 0.006, "b"),
                token_delta: -120,
                cost_delta: -0.002,
            },
            spans: vec!["respond [success]".to_string()],
        };

        let insights = build_compare_insights(&run_a, &run_b, &summary, &diffs);
        assert_eq!(insights.winner, "run_b");
        assert_eq!(insights.verdict, "Run B is better");
    }

    #[test]
    fn compare_insights_can_return_tie() {
        let run_a = make_run("a", "success", 1_000);
        let run_b = make_run("b", "success", 1_000);

        let summary = RunCompareSummary {
            status_changed: false,
            token_delta: 0,
            cost_delta: 0.0,
            span_count_delta: 0,
        };
        let diffs = RunCompareDiffs {
            prompts: Vec::new(),
            responses: Vec::new(),
            models: Vec::new(),
            artifacts: Vec::new(),
            metrics: MetricsDiff {
                run_a: make_metrics(250, 0.005, "a"),
                run_b: make_metrics(250, 0.005, "b"),
                token_delta: 0,
                cost_delta: 0.0,
            },
            spans: Vec::new(),
        };

        let insights = build_compare_insights(&run_a, &run_b, &summary, &diffs);
        assert_eq!(insights.winner, "tie");
        assert_eq!(insights.verdict, "No clear winner");
    }
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
