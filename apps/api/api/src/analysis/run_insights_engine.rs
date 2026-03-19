use agentscope_common::errors::AgentScopeError;
use agentscope_storage::Storage;
use agentscope_trace::RunInsight;
use chrono::Utc;
use uuid::Uuid;

use crate::analysis::{
    classifiers::classify_root_cause,
    detectors::{detect_failure_types, Detection},
};

const SLOW_SPAN_THRESHOLD_MS: i64 = 8_000;
const LARGE_PROMPT_THRESHOLD: i64 = 100_000;

pub async fn analyze_run(
    storage: &Storage,
    run_id: &str,
) -> Result<Vec<RunInsight>, AgentScopeError> {
    let run = storage
        .get_run(run_id)
        .await?
        .ok_or_else(|| AgentScopeError::Validation(format!("run {run_id} not found")))?;
    let spans = storage.get_spans(run_id).await?;
    let artifacts = storage.get_artifacts(run_id).await?;
    let root_causes = storage.get_run_root_causes(run_id).await?;

    let mut insights = Vec::new();
    let detections = detect_failure_types(&spans, &artifacts);

    for detection in detections.iter().take(3) {
        insights.push(build_detection_insight(run_id, detection));
    }

    let classification = classify_root_cause(&detections);
    if !detections.is_empty() {
        insights.push(RunInsight {
            id: Uuid::new_v4().to_string(),
            run_id: run_id.to_string(),
            insight_type: classification.root_cause_category.to_string(),
            severity: "medium".to_string(),
            message: classification.summary,
            recommendation: classification
                .suggested_fixes
                .first()
                .cloned()
                .unwrap_or_else(|| "Inspect run artifacts for remediation guidance.".to_string()),
            created_at: Utc::now(),
        });
    }

    if let Some(root_cause) = root_causes.first() {
        insights.push(RunInsight {
            id: Uuid::new_v4().to_string(),
            run_id: run_id.to_string(),
            insight_type: format!("ROOT_CAUSE_{}", root_cause.root_cause_type),
            severity: if root_cause.confidence >= 0.9 {
                "high".to_string()
            } else {
                "medium".to_string()
            },
            message: root_cause.message.clone(),
            recommendation: root_cause.suggested_fix.clone(),
            created_at: Utc::now(),
        });
    }

    if run.status == "failed" || run.status == "error" {
        insights.push(RunInsight {
            id: Uuid::new_v4().to_string(),
            run_id: run_id.to_string(),
            insight_type: "RUN_FAILURE".to_string(),
            severity: "high".to_string(),
            message: "Run finished with a failure status.".to_string(),
            recommendation:
                "Inspect failed span artifacts first, then address the highest-confidence root cause."
                    .to_string(),
            created_at: Utc::now(),
        });
    }

    let slowest_span_ms = spans
        .iter()
        .filter_map(|span| {
            span.ended_at
                .map(|ended| (ended - span.started_at).num_milliseconds())
        })
        .max()
        .unwrap_or_default();
    if slowest_span_ms >= SLOW_SPAN_THRESHOLD_MS {
        insights.push(RunInsight {
            id: Uuid::new_v4().to_string(),
            run_id: run_id.to_string(),
            insight_type: "PERFORMANCE_SLOW_SPAN".to_string(),
            severity: if slowest_span_ms >= 15_000 {
                "high".to_string()
            } else {
                "medium".to_string()
            },
            message: format!("Slow span detected at {slowest_span_ms} ms."),
            recommendation: "Profile the slow span and reduce tool/model latency on that path."
                .to_string(),
            created_at: Utc::now(),
        });
    }

    let max_input_tokens = spans
        .iter()
        .map(|span| span.input_tokens.unwrap_or_default())
        .max()
        .unwrap_or_default();
    if max_input_tokens >= LARGE_PROMPT_THRESHOLD {
        insights.push(RunInsight {
            id: Uuid::new_v4().to_string(),
            run_id: run_id.to_string(),
            insight_type: "PROMPT_TOO_LARGE".to_string(),
            severity: "high".to_string(),
            message: format!(
                "Largest prompt reached {max_input_tokens} input tokens and may exceed model limits."
            ),
            recommendation:
                "Trim prompt context and summarize prior steps before sending to the model.".to_string(),
            created_at: Utc::now(),
        });
    }

    if insights.is_empty() {
        insights.push(RunInsight {
            id: Uuid::new_v4().to_string(),
            run_id: run_id.to_string(),
            insight_type: "NO_MAJOR_ISSUES".to_string(),
            severity: "low".to_string(),
            message: "No strong failure or performance issues were detected for this run."
                .to_string(),
            recommendation:
                "Keep monitoring this workflow and collect more runs for stronger trends."
                    .to_string(),
            created_at: Utc::now(),
        });
    }

    storage.replace_run_insights(run_id, &insights).await?;
    Ok(insights)
}

fn build_detection_insight(run_id: &str, detection: &Detection) -> RunInsight {
    RunInsight {
        id: Uuid::new_v4().to_string(),
        run_id: run_id.to_string(),
        insight_type: detection.failure_type.to_string(),
        severity: if detection.confidence >= 0.95 {
            "high".to_string()
        } else {
            "medium".to_string()
        },
        message: detection.summary.clone(),
        recommendation: recommendation_for_failure(detection.failure_type).to_string(),
        created_at: Utc::now(),
    }
}

fn recommendation_for_failure(failure_type: &str) -> &'static str {
    match failure_type {
        "SCHEMA_VALIDATION_ERROR" => {
            "Enforce stricter output schema instructions and validate before downstream usage."
        }
        "TOOL_FAILURE" => "Validate tool arguments and add retries for transient tool errors.",
        "TIMEOUT" => "Shorten long operations and add timeouts with controlled retry behavior.",
        "API_ERROR" => {
            "Handle upstream API rate limits and server errors with backoff and fallback."
        }
        "TOKEN_OVERFLOW" => "Reduce prompt size and truncate low-value context before model calls.",
        _ => "Inspect span and artifact evidence to identify and fix the failing step.",
    }
}
