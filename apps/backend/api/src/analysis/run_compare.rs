use std::collections::{BTreeSet, HashMap};

use agentscope_common::errors::AgentScopeError;
use agentscope_storage::Storage;
use agentscope_trace::{Artifact, Run, RunMetrics, Span};
use chrono::Duration;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct RunCompareResponse {
    pub run_a: Run,
    pub run_b: Run,
    pub summary: RunCompareSummary,
    pub diffs: RunCompareDiffs,
    pub recommendation: ComparisonRecommendation,
    pub insights: CompareInsights,
}

#[derive(Debug, Serialize)]
pub struct RunCompareSummary {
    pub status_changed: bool,
    pub token_delta: i64,
    pub cost_delta: f64,
    pub span_count_delta: i64,
    pub instruction_change_count: usize,
    pub instruction_impact_level: String,
}

#[derive(Debug, Serialize)]
pub struct RunCompareDiffs {
    pub prompts: Vec<ArtifactDiff>,
    pub responses: Vec<ArtifactDiff>,
    pub instruction_diff: InstructionDiff,
    pub models: Vec<String>,
    pub artifacts: Vec<ArtifactDiff>,
    pub metrics: MetricsDiff,
    pub spans: Vec<String>,
}

#[derive(Debug, Serialize, Clone, Default)]
pub struct InstructionDiff {
    pub added: Vec<InstructionChange>,
    pub removed: Vec<InstructionChange>,
    pub changed: Vec<InstructionChanged>,
    pub removed_constraints: Vec<String>,
    pub impact_level: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct InstructionChange {
    pub source_id: String,
    pub source_type: String,
    pub path: String,
    pub name: String,
    pub hash: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct InstructionChanged {
    pub source_id: String,
    pub source_type: String,
    pub path: String,
    pub name: String,
    pub previous_hash: String,
    pub current_hash: String,
    pub impact_level: String,
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
    pub insight_type: String,
    pub summary: String,
    pub key_changes: Vec<String>,
    pub verdict: String,
    pub recommendation: String,
    pub winner: String,
}

#[derive(Debug, Serialize)]
pub struct ComparisonRecommendation {
    pub winner: String,
    pub confidence: f32,
    pub reasons: Vec<String>,
    pub improvements: Vec<String>,
    pub regressions: Vec<String>,
    pub summary: String,
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

    let instruction_diff = diff_instruction_context(&spans_a, &spans_b);
    let instruction_change_count = instruction_diff.added.len()
        + instruction_diff.removed.len()
        + instruction_diff.changed.len();

    let summary = RunCompareSummary {
        status_changed: run_a.status != run_b.status,
        token_delta: metrics_b.total_tokens - metrics_a.total_tokens,
        cost_delta: metrics_b.estimated_cost - metrics_a.estimated_cost,
        span_count_delta: spans_b.len() as i64 - spans_a.len() as i64,
        instruction_change_count,
        instruction_impact_level: instruction_diff.impact_level.clone(),
    };
    let diffs = RunCompareDiffs {
        prompts: diff_artifacts("llm.prompt", &artifacts_a, &artifacts_b),
        responses: diff_artifacts("llm.response", &artifacts_a, &artifacts_b),
        instruction_diff,
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
    let recommendation = build_comparison_recommendation(&run_a, &run_b, &summary, &diffs);
    let insights = build_compare_insights(&run_a, &run_b, &summary, &diffs, &recommendation);

    Ok(RunCompareResponse {
        run_a,
        run_b,
        summary,
        diffs,
        recommendation,
        insights,
    })
}

fn build_compare_insights(
    run_a: &Run,
    run_b: &Run,
    summary: &RunCompareSummary,
    diffs: &RunCompareDiffs,
    recommendation: &ComparisonRecommendation,
) -> CompareInsights {
    let latency_a = latency_ms(run_a);
    let latency_b = latency_ms(run_b);

    let mut key_changes = Vec::new();

    let status_delta = status_score(&run_b.status) - status_score(&run_a.status);
    if status_delta > 0 {
        key_changes.push(format!(
            "Reliability improved: status changed from {} to {}.",
            run_a.status, run_b.status
        ));
    } else if status_delta < 0 {
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
            let pct = percent_change(a, b);
            key_changes.push(format!(
                "Latency reduced by {:.1}% ({}ms -> {}ms).",
                pct, a, b
            ));
        } else if b > a {
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
        key_changes.push(format!(
            "Token usage decreased by {} tokens.",
            summary.token_delta.abs()
        ));
    } else if summary.token_delta > 0 {
        key_changes.push(format!(
            "Token usage increased by {} tokens.",
            summary.token_delta
        ));
    } else {
        key_changes.push("Token usage unchanged.".to_string());
    }

    if summary.cost_delta < 0.0 {
        key_changes.push(format!(
            "Estimated cost decreased by ${:.6}.",
            summary.cost_delta.abs()
        ));
    } else if summary.cost_delta > 0.0 {
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
    let instruction_change_count = diffs.instruction_diff.added.len()
        + diffs.instruction_diff.removed.len()
        + diffs.instruction_diff.changed.len();
    if instruction_change_count > 0 {
        let removed_constraints = diffs.instruction_diff.removed_constraints.len();
        key_changes.push(format!(
            "Instruction Changes: {instruction_change_count} change(s), {removed_constraints} removed constraint(s), impact {}.",
            diffs.instruction_diff.impact_level
        ));
    }

    let winner = recommendation.winner.clone();
    let verdict = if winner == "run_b" {
        "Run B is better".to_string()
    } else {
        "Run A is better".to_string()
    };
    let recommendation_text = if winner == "run_b" {
        "Use Run B configuration".to_string()
    } else {
        "Use Run A configuration".to_string()
    };
    let summary_text = recommendation.summary.clone();

    CompareInsights {
        insight_type: "COMPARISON_RECOMMENDATION".to_string(),
        summary: summary_text,
        key_changes: key_changes.into_iter().take(5).collect(),
        verdict,
        recommendation: recommendation_text,
        winner,
    }
}

fn build_comparison_recommendation(
    run_a: &Run,
    run_b: &Run,
    summary: &RunCompareSummary,
    diffs: &RunCompareDiffs,
) -> ComparisonRecommendation {
    const SUCCESS_WEIGHT: f32 = 0.5;
    const LATENCY_WEIGHT: f32 = 0.2;
    const COST_WEIGHT: f32 = 0.2;
    const RELIABILITY_WEIGHT: f32 = 0.1;

    let success_a = success_score(run_a);
    let success_b = success_score(run_b);

    let latency_a = latency_ms(run_a).map(|value| value as f64);
    let latency_b = latency_ms(run_b).map(|value| value as f64);
    let latency_score_a = normalize_inverse_pair(latency_a, latency_b, true);
    let latency_score_b = normalize_inverse_pair(latency_b, latency_a, true);

    let cost_a = Some(diffs.metrics.run_a.estimated_cost);
    let cost_b = Some(diffs.metrics.run_b.estimated_cost);
    let cost_score_a = normalize_inverse_pair(cost_a, cost_b, true);
    let cost_score_b = normalize_inverse_pair(cost_b, cost_a, true);

    let reliability_a = reliability_score(run_a);
    let reliability_b = reliability_score(run_b);

    let score_a = SUCCESS_WEIGHT * success_a
        + LATENCY_WEIGHT * latency_score_a
        + COST_WEIGHT * cost_score_a
        + RELIABILITY_WEIGHT * reliability_a;
    let score_b = SUCCESS_WEIGHT * success_b
        + LATENCY_WEIGHT * latency_score_b
        + COST_WEIGHT * cost_score_b
        + RELIABILITY_WEIGHT * reliability_b;

    let winner = if score_b > score_a { "run_b" } else { "run_a" }.to_string();
    let confidence = ((score_b - score_a).abs() / 1.0).clamp(0.05, 0.99);

    let mut reasons = Vec::<String>::new();
    let mut improvements = Vec::<String>::new();
    let mut regressions = Vec::<String>::new();

    if success_b > success_a {
        improvements.push("Improved success rate".to_string());
    } else if success_b < success_a {
        regressions.push("Reduced success rate".to_string());
    }

    if let (Some(a), Some(b)) = (latency_a, latency_b) {
        if b < a {
            improvements.push(format!(
                "Reduced latency by {:.0}%",
                percent_change_f64(a, b)
            ));
        } else if b > a {
            regressions.push(format!(
                "Increased latency by {:.0}%",
                percent_change_f64(a, b)
            ));
        }
    }

    if summary.token_delta < 0 {
        improvements.push("Reduced token usage".to_string());
    } else if summary.token_delta > 0 {
        regressions.push("Increased token usage".to_string());
    }

    if diffs.metrics.cost_delta < 0.0 {
        improvements.push("Lower cost".to_string());
    } else if diffs.metrics.cost_delta > 0.0 {
        regressions.push("Higher cost".to_string());
    }

    if summary.instruction_change_count > 0 {
        reasons.push("Improvement likely caused by updated instructions".to_string());
    }

    reasons.extend(improvements.iter().cloned());
    reasons.truncate(4);
    improvements.truncate(4);
    regressions.truncate(4);

    let winner_name = if winner == "run_b" { "Run B" } else { "Run A" };
    let short_reasons = if reasons.is_empty() {
        "better overall performance and reliability".to_string()
    } else {
        reasons
            .iter()
            .take(2)
            .cloned()
            .collect::<Vec<_>>()
            .join(" and ")
            .to_lowercase()
    };
    let mut summary_text = format!("{winner_name} is recommended due to {short_reasons}");
    if summary.instruction_change_count > 0 {
        summary_text.push_str(". Improvement likely caused by updated instructions");
    }

    ComparisonRecommendation {
        winner,
        confidence,
        reasons,
        improvements,
        regressions,
        summary: summary_text,
    }
}

fn success_score(run: &Run) -> f32 {
    if run.status == "success" || run.status == "completed" || run.success == Some(true) {
        1.0
    } else {
        0.0
    }
}

fn reliability_score(run: &Run) -> f32 {
    let has_errors = run.status == "failed"
        || run.status == "error"
        || run.success == Some(false)
        || run.error_count.unwrap_or_default() > 0;
    if has_errors {
        0.0
    } else {
        1.0
    }
}

fn normalize_inverse_pair(value: Option<f64>, other: Option<f64>, lower_is_better: bool) -> f32 {
    let (Some(value), Some(other)) = (value, other) else {
        return 0.5;
    };
    if (value - other).abs() < f64::EPSILON {
        return 0.5;
    }
    if lower_is_better {
        if value < other {
            1.0
        } else {
            0.0
        }
    } else if value > other {
        1.0
    } else {
        0.0
    }
}

fn percent_change_f64(old: f64, new: f64) -> f64 {
    if old <= 0.0 {
        return 0.0;
    }
    ((new - old).abs() / old) * 100.0
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
            instruction_change_count: 0,
            instruction_impact_level: "low".to_string(),
        };
        let diffs = RunCompareDiffs {
            prompts: Vec::new(),
            responses: Vec::new(),
            instruction_diff: InstructionDiff::default(),
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

        let recommendation = build_comparison_recommendation(&run_a, &run_b, &summary, &diffs);
        let insights = build_compare_insights(&run_a, &run_b, &summary, &diffs, &recommendation);
        assert_eq!(insights.winner, "run_b");
        assert_eq!(insights.verdict, "Run B is better");
    }

    #[test]
    fn compare_insights_returns_clear_winner() {
        let run_a = make_run("a", "success", 1_000);
        let run_b = make_run("b", "success", 1_000);

        let summary = RunCompareSummary {
            status_changed: false,
            token_delta: 0,
            cost_delta: 0.0,
            span_count_delta: 0,
            instruction_change_count: 0,
            instruction_impact_level: "low".to_string(),
        };
        let diffs = RunCompareDiffs {
            prompts: Vec::new(),
            responses: Vec::new(),
            instruction_diff: InstructionDiff::default(),
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

        let recommendation = build_comparison_recommendation(&run_a, &run_b, &summary, &diffs);
        let insights = build_compare_insights(&run_a, &run_b, &summary, &diffs, &recommendation);
        assert_eq!(insights.winner, "run_a");
        assert_eq!(insights.verdict, "Run A is better");
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

fn diff_instruction_context(spans_a: &[Span], spans_b: &[Span]) -> InstructionDiff {
    let map_a = collect_instruction_source_map(spans_a);
    let map_b = collect_instruction_source_map(spans_b);

    let mut added = Vec::new();
    let mut removed = Vec::new();
    let mut changed = Vec::new();
    let mut removed_constraints = Vec::new();

    for (id, source) in &map_b {
        if !map_a.contains_key(id) {
            added.push(InstructionChange {
                source_id: id.clone(),
                source_type: source.source_type.clone(),
                path: source.path.clone(),
                name: source.name.clone(),
                hash: source.hash.clone(),
            });
        }
    }

    for (id, source) in &map_a {
        match map_b.get(id) {
            None => {
                if has_output_constraint(&source.content) {
                    removed_constraints.push(source.path.clone());
                }
                removed.push(InstructionChange {
                    source_id: id.clone(),
                    source_type: source.source_type.clone(),
                    path: source.path.clone(),
                    name: source.name.clone(),
                    hash: source.hash.clone(),
                });
            }
            Some(next) => {
                if source.hash != next.hash || source.content != next.content {
                    let mut impact = "low".to_string();
                    let had_constraint = has_output_constraint(&source.content);
                    let has_constraint_now = has_output_constraint(&next.content);
                    if had_constraint && !has_constraint_now {
                        removed_constraints.push(source.path.clone());
                        impact = "high".to_string();
                    } else if source.source_type != next.source_type {
                        impact = "medium".to_string();
                    }
                    changed.push(InstructionChanged {
                        source_id: id.clone(),
                        source_type: next.source_type.clone(),
                        path: next.path.clone(),
                        name: next.name.clone(),
                        previous_hash: source.hash.clone(),
                        current_hash: next.hash.clone(),
                        impact_level: impact,
                    });
                }
            }
        }
    }

    added.sort_by(|left, right| left.source_id.cmp(&right.source_id));
    removed.sort_by(|left, right| left.source_id.cmp(&right.source_id));
    changed.sort_by(|left, right| left.source_id.cmp(&right.source_id));
    removed_constraints.sort();
    removed_constraints.dedup();

    let impact_level = if !removed_constraints.is_empty() {
        "high".to_string()
    } else if !changed.is_empty() || !added.is_empty() || !removed.is_empty() {
        "medium".to_string()
    } else {
        "low".to_string()
    };

    InstructionDiff {
        added,
        removed,
        changed,
        removed_constraints,
        impact_level,
    }
}

#[derive(Clone)]
struct InstructionSourceData {
    source_type: String,
    name: String,
    path: String,
    hash: String,
    content: String,
}

fn collect_instruction_source_map(spans: &[Span]) -> HashMap<String, InstructionSourceData> {
    let mut items = HashMap::new();
    for span in spans {
        let Some(context) = span
            .instruction_context
            .as_ref()
            .and_then(serde_json::Value::as_object)
        else {
            continue;
        };
        let Some(entries) = context.get("sources").and_then(serde_json::Value::as_array) else {
            continue;
        };
        for entry in entries {
            let Some(object) = entry.as_object() else {
                continue;
            };
            let source_type = object
                .get("type")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("unknown");
            let name = object
                .get("name")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("unknown");
            let path = object
                .get("path")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("-");
            let hash = object
                .get("hash")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("-");
            let content = object
                .get("content")
                .map(stringify_json)
                .unwrap_or_default();
            let id = format!("{source_type}:{path}:{name}");
            items.insert(
                id,
                InstructionSourceData {
                    source_type: source_type.to_string(),
                    name: name.to_string(),
                    path: path.to_string(),
                    hash: hash.to_string(),
                    content,
                },
            );
        }
    }
    items
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

fn has_output_constraint(content: &str) -> bool {
    let normalized = content.to_lowercase();
    [
        "json",
        "schema",
        "format",
        "must output",
        "respond with",
        "structured output",
    ]
    .iter()
    .any(|needle| normalized.contains(needle))
}
