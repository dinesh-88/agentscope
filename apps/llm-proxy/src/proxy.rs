use std::{sync::Arc, time::Instant};

use axum::{
    body::{Body, Bytes},
    extract::State,
    http::{HeaderMap, HeaderName, HeaderValue, Response, StatusCode},
    response::IntoResponse,
    routing::post,
    Router,
};
use futures_util::StreamExt;
use reqwest::Client;
use serde_json::Value;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tracing::{error, info};
use uuid::Uuid;

use crate::{
    models::{ChatCompletionRequest, Usage},
    telemetry::{extract_usage_from_json, TelemetryClient, TelemetryRecord},
};

const OPENAI_CHAT_COMPLETIONS_URL: &str = "https://api.openai.com/v1/chat/completions";

#[derive(Clone)]
pub struct AppState {
    pub openai_client: Client,
    pub telemetry_client: TelemetryClient,
    pub openai_api_key: String,
}

pub fn app(state: AppState) -> Router {
    Router::new()
        .route("/v1/chat/completions", post(chat_completions))
        .with_state(Arc::new(state))
}

async fn chat_completions(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response<Body> {
    let request: ChatCompletionRequest = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(err) => {
            return (StatusCode::BAD_REQUEST, format!("invalid JSON body: {err}")).into_response();
        }
    };

    let request_id = Uuid::new_v4().to_string();
    let started_at = chrono::Utc::now();
    let start = Instant::now();

    info!(
        request_id = %request_id,
        model = %request.model,
        stream = request.stream,
        "LLM request received"
    );

    let forwarded_headers = build_upstream_headers(&headers, &state.openai_api_key);
    let upstream_result = state
        .openai_client
        .post(OPENAI_CHAT_COMPLETIONS_URL)
        .headers(forwarded_headers)
        .body(body)
        .send()
        .await;

    let upstream_response = match upstream_result {
        Ok(response) => response,
        Err(err) => {
            error!(request_id = %request_id, error = %err, "upstream request failed");
            return (
                StatusCode::BAD_GATEWAY,
                format!("failed to contact OpenAI API: {err}"),
            )
                .into_response();
        }
    };

    if request.stream {
        stream_response(
            state,
            request,
            request_id,
            started_at,
            start,
            upstream_response,
        )
        .await
    } else {
        buffered_response(
            state,
            request,
            request_id,
            started_at,
            start,
            upstream_response,
        )
        .await
    }
}

async fn buffered_response(
    state: Arc<AppState>,
    request: ChatCompletionRequest,
    request_id: String,
    started_at: chrono::DateTime<chrono::Utc>,
    start: Instant,
    upstream_response: reqwest::Response,
) -> Response<Body> {
    let status = upstream_response.status();
    let headers = upstream_response.headers().clone();

    match upstream_response.bytes().await {
        Ok(bytes) => {
            let latency_ms = start.elapsed().as_millis();
            let ended_at = chrono::Utc::now();
            let (response_text, usage) = parse_buffered_payload(&bytes);

            log_completion(&request.model, usage.input_tokens, latency_ms);

            tokio::spawn(send_telemetry(
                state.telemetry_client.clone(),
                TelemetryRecord {
                    request_id,
                    request,
                    latency_ms,
                    response_text,
                    usage,
                    started_at,
                    ended_at,
                },
            ));

            build_response(status, &headers, Body::from(bytes))
        }
        Err(err) => {
            error!(error = %err, "failed to read upstream response");
            (
                StatusCode::BAD_GATEWAY,
                format!("failed to read OpenAI response: {err}"),
            )
                .into_response()
        }
    }
}

async fn stream_response(
    state: Arc<AppState>,
    request: ChatCompletionRequest,
    request_id: String,
    started_at: chrono::DateTime<chrono::Utc>,
    start: Instant,
    upstream_response: reqwest::Response,
) -> Response<Body> {
    let status = upstream_response.status();
    let headers = upstream_response.headers().clone();
    let mut upstream_stream = upstream_response.bytes_stream();
    let (tx, rx) = mpsc::channel(16);
    let telemetry_client = state.telemetry_client.clone();
    let request_for_task = request.clone();
    let model = request.model.clone();

    tokio::spawn(async move {
        let mut response_bytes = Vec::new();
        let mut usage = Usage {
            input_tokens: None,
            output_tokens: None,
            total_tokens: None,
        };

        while let Some(item) = upstream_stream.next().await {
            match item {
                Ok(chunk) => {
                    update_usage_from_sse_chunk(&mut usage, &chunk);
                    response_bytes.extend_from_slice(&chunk);
                    if tx.send(Ok::<Bytes, std::io::Error>(chunk)).await.is_err() {
                        return;
                    }
                }
                Err(err) => {
                    let latency_ms = start.elapsed().as_millis();
                    error!(request_id = %request_id, error = %err, "streaming upstream failed");
                    let _ = tx.send(Err(std::io::Error::other(err.to_string()))).await;
                    let ended_at = chrono::Utc::now();
                    let response_text = extract_stream_text(&response_bytes);
                    log_completion(&model, usage.input_tokens, latency_ms);
                    send_telemetry(
                        telemetry_client,
                        TelemetryRecord {
                            request_id,
                            request: request_for_task,
                            latency_ms,
                            response_text,
                            usage,
                            started_at,
                            ended_at,
                        },
                    )
                    .await;
                    return;
                }
            }
        }

        let latency_ms = start.elapsed().as_millis();
        let ended_at = chrono::Utc::now();
        let response_text = extract_stream_text(&response_bytes);
        log_completion(&model, usage.input_tokens, latency_ms);
        send_telemetry(
            telemetry_client,
            TelemetryRecord {
                request_id,
                request: request_for_task,
                latency_ms,
                response_text,
                usage,
                started_at,
                ended_at,
            },
        )
        .await;
    });

    build_response(status, &headers, Body::from_stream(ReceiverStream::new(rx)))
}

async fn send_telemetry(client: TelemetryClient, record: TelemetryRecord) {
    client.send(record).await;
}

fn build_upstream_headers(headers: &HeaderMap, openai_api_key: &str) -> HeaderMap {
    let mut forwarded = HeaderMap::new();

    for (name, value) in headers {
        if should_skip_request_header(name) {
            continue;
        }
        forwarded.insert(name.clone(), value.clone());
    }

    if !forwarded.contains_key(axum::http::header::AUTHORIZATION) {
        let auth_value = format!("Bearer {openai_api_key}");
        if let Ok(value) = HeaderValue::from_str(&auth_value) {
            forwarded.insert(axum::http::header::AUTHORIZATION, value);
        }
    }

    if !forwarded.contains_key(axum::http::header::CONTENT_TYPE) {
        forwarded.insert(
            axum::http::header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
    }

    forwarded
}

fn build_response(status: reqwest::StatusCode, headers: &HeaderMap, body: Body) -> Response<Body> {
    let mut response = Response::new(body);
    *response.status_mut() = status;

    for (name, value) in headers {
        if should_skip_response_header(name) {
            continue;
        }
        response.headers_mut().insert(name.clone(), value.clone());
    }

    response
}

fn should_skip_request_header(name: &HeaderName) -> bool {
    matches!(
        name.as_str().to_ascii_lowercase().as_str(),
        "host" | "content-length" | "connection"
    )
}

fn should_skip_response_header(name: &HeaderName) -> bool {
    matches!(
        name.as_str().to_ascii_lowercase().as_str(),
        "content-length" | "connection" | "transfer-encoding"
    )
}

fn parse_buffered_payload(bytes: &[u8]) -> (Option<String>, Usage) {
    match serde_json::from_slice::<Value>(bytes) {
        Ok(value) => (
            extract_non_stream_text(&value),
            extract_usage_from_json(&value),
        ),
        Err(_) => (
            None,
            Usage {
                input_tokens: None,
                output_tokens: None,
                total_tokens: None,
            },
        ),
    }
}

fn extract_non_stream_text(value: &Value) -> Option<String> {
    value
        .get("choices")
        .and_then(Value::as_array)
        .map(|choices| {
            choices
                .iter()
                .filter_map(|choice| {
                    choice
                        .get("message")
                        .and_then(|message| message.get("content"))
                        .and_then(extract_content_value)
                })
                .collect::<Vec<_>>()
                .join("")
        })
        .filter(|text| !text.is_empty())
}

fn extract_content_value(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.to_string());
    }

    value
        .as_array()
        .map(|parts| {
            parts
                .iter()
                .filter_map(|part| {
                    part.get("text")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .or_else(|| {
                            part.get("content")
                                .and_then(Value::as_str)
                                .map(str::to_string)
                        })
                })
                .collect::<Vec<_>>()
                .join("")
        })
        .filter(|text| !text.is_empty())
}

fn extract_stream_text(bytes: &[u8]) -> Option<String> {
    let mut content = String::new();
    let payload = String::from_utf8_lossy(bytes);

    for line in payload.lines() {
        let data = match line.strip_prefix("data: ") {
            Some(data) if data != "[DONE]" => data,
            _ => continue,
        };

        let Ok(value) = serde_json::from_str::<Value>(data) else {
            continue;
        };

        if let Some(choices) = value.get("choices").and_then(Value::as_array) {
            for choice in choices {
                if let Some(text) = choice
                    .get("delta")
                    .and_then(|delta| delta.get("content"))
                    .and_then(extract_content_value)
                {
                    content.push_str(&text);
                }
            }
        }
    }

    if content.is_empty() {
        None
    } else {
        Some(content)
    }
}

fn update_usage_from_sse_chunk(usage: &mut Usage, chunk: &[u8]) {
    let payload = String::from_utf8_lossy(chunk);
    for line in payload.lines() {
        let data = match line.strip_prefix("data: ") {
            Some(data) if data != "[DONE]" => data,
            _ => continue,
        };

        let Ok(value) = serde_json::from_str::<Value>(data) else {
            continue;
        };
        let candidate = extract_usage_from_json(&value);
        if candidate.input_tokens.is_some() {
            usage.input_tokens = candidate.input_tokens;
        }
        if candidate.output_tokens.is_some() {
            usage.output_tokens = candidate.output_tokens;
        }
        if candidate.total_tokens.is_some() {
            usage.total_tokens = candidate.total_tokens;
        }
    }
}

fn log_completion(model: &str, prompt_tokens: Option<i64>, latency_ms: u128) {
    info!("Model: {model}");
    info!("Prompt tokens: {}", prompt_tokens.unwrap_or_default());
    info!("Latency: {latency_ms}ms");
}
