use agentscope_trace::{Artifact, Span};
use serde_json::{json, Value};

#[derive(Debug, Clone)]
pub struct Detection {
    pub failure_type: &'static str,
    pub confidence: f64,
    pub summary: String,
    pub span_count: usize,
    pub affected_spans: Vec<String>,
    pub evidence: Value,
}

pub fn detect_failure_types(spans: &[Span], artifacts: &[Artifact]) -> Vec<Detection> {
    let mut detections = Vec::new();

    if let Some(detection) = detect_schema_validation_error(artifacts) {
        detections.push(detection);
    }
    if let Some(detection) = detect_tool_failure(spans, artifacts) {
        detections.push(detection);
    }
    if let Some(detection) = detect_timeout(spans, artifacts) {
        detections.push(detection);
    }
    if let Some(detection) = detect_api_error(spans, artifacts) {
        detections.push(detection);
    }
    if let Some(detection) = detect_token_overflow(spans, artifacts) {
        detections.push(detection);
    }

    detections.sort_by(|left, right| right.confidence.total_cmp(&left.confidence));
    detections
}

fn detect_schema_validation_error(artifacts: &[Artifact]) -> Option<Detection> {
    let artifact = artifacts.iter().find(|artifact| {
        let kind = artifact.kind.to_lowercase();
        let message = payload_message(&artifact.payload);
        kind.contains("schema")
            || message.contains("schema validation")
            || message.contains("invalid json")
            || message.contains("json parse")
            || message.contains("jsondecodeerror")
    })?;

    Some(Detection {
        failure_type: "SCHEMA_VALIDATION_ERROR",
        confidence: 0.97,
        summary: "The run produced output that could not be parsed or validated against the expected schema.".to_string(),
        span_count: artifact.span_id.as_ref().map(|_| 1).unwrap_or(0),
        affected_spans: artifact.span_id.clone().into_iter().collect(),
        evidence: artifact.payload.clone(),
    })
}

fn detect_tool_failure(spans: &[Span], artifacts: &[Artifact]) -> Option<Detection> {
    let span = spans.iter().find(|span| {
        span.span_type == "tool_call"
            && matches!(span.status.as_str(), "error" | "failed" | "timeout")
    })?;

    let evidence = artifacts
        .iter()
        .find(|artifact| {
            artifact.span_id.as_deref() == Some(span.id.as_str()) && artifact.kind.contains("error")
        })
        .map(|artifact| artifact.payload.clone())
        .unwrap_or_else(|| {
            json!({
                "span_id": span.id,
                "span_name": span.name,
                "status": span.status
            })
        });

    Some(Detection {
        failure_type: "TOOL_FAILURE",
        confidence: 0.95,
        summary: format!("Tool span {} failed during execution.", span.name),
        span_count: 1,
        affected_spans: vec![span.id.clone()],
        evidence,
    })
}

fn detect_timeout(spans: &[Span], artifacts: &[Artifact]) -> Option<Detection> {
    if let Some(span) = spans.iter().find(|span| {
        let status = span.status.to_lowercase();
        status.contains("timeout") || payload_contains_timeout(span.metadata.as_ref())
    }) {
        return Some(Detection {
            failure_type: "TIMEOUT",
            confidence: 0.94,
            summary: format!("Span {} timed out before completion.", span.name),
            span_count: 1,
            affected_spans: vec![span.id.clone()],
            evidence: json!({
                "span_id": span.id,
                "status": span.status,
                "metadata": span.metadata
            }),
        });
    }

    let artifact = artifacts
        .iter()
        .find(|artifact| payload_contains_timeout(Some(&artifact.payload)))?;

    Some(Detection {
        failure_type: "TIMEOUT",
        confidence: 0.92,
        summary: "A timeout was detected in run artifacts.".to_string(),
        span_count: artifact.span_id.as_ref().map(|_| 1).unwrap_or(0),
        affected_spans: artifact.span_id.clone().into_iter().collect(),
        evidence: artifact.payload.clone(),
    })
}

fn detect_api_error(spans: &[Span], artifacts: &[Artifact]) -> Option<Detection> {
    let artifact = artifacts.iter().find(|artifact| {
        extract_http_status(&artifact.payload).is_some_and(|status| status >= 400)
            || payload_message(&artifact.payload).contains("api error")
            || payload_message(&artifact.payload).contains("rate limit")
    })?;

    let http_status = extract_http_status(&artifact.payload);
    let span = artifact
        .span_id
        .as_ref()
        .and_then(|span_id| spans.iter().find(|span| span.id == *span_id));
    let span_id = span.map(|value| value.id.clone());
    let provider = span.and_then(|value| value.provider.clone());

    Some(Detection {
        failure_type: "API_ERROR",
        confidence: if http_status.unwrap_or_default() >= 500 {
            0.93
        } else {
            0.88
        },
        summary: match http_status {
            Some(status) => format!("An upstream API request failed with status {status}."),
            None => "An upstream API request failed.".to_string(),
        },
        span_count: span_id.as_ref().map(|_| 1).unwrap_or(0),
        affected_spans: span_id.clone().into_iter().collect(),
        evidence: json!({
            "artifact": artifact.payload,
            "span_id": span_id,
            "provider": provider
        }),
    })
}

fn detect_token_overflow(spans: &[Span], artifacts: &[Artifact]) -> Option<Detection> {
    if let Some(span) = spans.iter().find(|span| {
        span.model
            .as_deref()
            .and_then(estimate_context_window)
            .zip(span.input_tokens)
            .is_some_and(|(window, tokens)| tokens > window)
    }) {
        let model = span.model.clone().unwrap_or_else(|| "unknown".to_string());
        let window = estimate_context_window(&model).unwrap_or_default();
        return Some(Detection {
            failure_type: "TOKEN_OVERFLOW",
            confidence: 0.99,
            summary: format!(
                "Span {} exceeded the estimated context window for model {}.",
                span.name, model
            ),
            span_count: 1,
            affected_spans: vec![span.id.clone()],
            evidence: json!({
                "span_id": span.id,
                "model": model,
                "input_tokens": span.input_tokens,
                "context_window": window
            }),
        });
    }

    let artifact = artifacts.iter().find(|artifact| {
        let message = payload_message(&artifact.payload);
        message.contains("context length")
            || message.contains("maximum context")
            || message.contains("token limit")
    })?;

    Some(Detection {
        failure_type: "TOKEN_OVERFLOW",
        confidence: 0.95,
        summary: "The run exceeded the model token or context limit.".to_string(),
        span_count: artifact.span_id.as_ref().map(|_| 1).unwrap_or(0),
        affected_spans: artifact.span_id.clone().into_iter().collect(),
        evidence: artifact.payload.clone(),
    })
}

fn payload_message(payload: &Value) -> String {
    [
        payload.get("message"),
        payload.get("error"),
        payload.get("detail"),
        payload
            .get("response")
            .and_then(|value| value.get("message")),
        payload
            .get("payload")
            .and_then(|value| value.get("message")),
    ]
    .into_iter()
    .flatten()
    .find_map(Value::as_str)
    .unwrap_or_default()
    .to_lowercase()
}

fn payload_contains_timeout(payload: Option<&Value>) -> bool {
    let Some(payload) = payload else {
        return false;
    };

    payload_message(payload).contains("timeout")
        || payload
            .get("timed_out")
            .and_then(Value::as_bool)
            .unwrap_or(false)
}

fn extract_http_status(payload: &Value) -> Option<i64> {
    [
        payload.get("http_status"),
        payload.get("status"),
        payload.get("status_code"),
        payload
            .get("response")
            .and_then(|value| value.get("http_status")),
        payload
            .get("response")
            .and_then(|value| value.get("status_code")),
    ]
    .into_iter()
    .flatten()
    .find_map(Value::as_i64)
}

pub fn estimate_context_window(model: &str) -> Option<i64> {
    let model = model.to_lowercase();

    if model.contains("gpt-4.1") || model.contains("gpt-4o") || model.contains("gpt-5") {
        return Some(128_000);
    }
    if model.contains("claude-3") || model.contains("claude-sonnet-4") {
        return Some(200_000);
    }
    if model.contains("gemini-1.5") || model.contains("gemini-2.0") {
        return Some(1_000_000);
    }
    if model.contains("llama") {
        return Some(128_000);
    }

    None
}
