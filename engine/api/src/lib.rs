use std::sync::Arc;

use agentscope_common::errors::AgentScopeError;
use agentscope_storage::Storage;
use agentscope_trace::{Artifact, Run, Span};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tracing::{error, info};

#[derive(Clone)]
pub struct AppState {
    pub storage: Storage,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct IngestPayload {
    pub run: Run,
    pub spans: Vec<Span>,
    pub artifacts: Vec<Artifact>,
}

pub fn app(storage: Storage) -> Router {
    let state = Arc::new(AppState { storage });

    Router::new()
        .route("/v1/ingest", post(ingest))
        .route("/v1/runs", get(list_runs))
        .route("/v1/runs/:id", get(get_run))
        .route("/v1/runs/:id/spans", get(get_run_spans))
        .with_state(state)
}

async fn ingest(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<IngestPayload>,
) -> Result<impl IntoResponse, ApiError> {
    info!(run_id = %payload.run.id, "received ingest request");

    validate_payload(&payload)?;

    state.storage.insert_run(&payload.run).await?;

    for span in &payload.spans {
        state.storage.insert_span(span).await?;
    }

    for artifact in &payload.artifacts {
        state.storage.insert_artifact(artifact).await?;
    }

    Ok(StatusCode::OK)
}

fn validate_payload(payload: &IngestPayload) -> Result<(), ApiError> {
    if payload.run.id.is_empty() {
        return Err(ApiError::Validation("run.id is required".to_string()));
    }

    for span in &payload.spans {
        if span.run_id != payload.run.id {
            return Err(ApiError::Validation(
                "every span.run_id must match run.id".to_string(),
            ));
        }
    }

    for artifact in &payload.artifacts {
        if artifact.run_id != payload.run.id {
            return Err(ApiError::Validation(
                "every artifact.run_id must match run.id".to_string(),
            ));
        }
    }

    Ok(())
}

async fn list_runs(State(state): State<Arc<AppState>>) -> Result<Json<Vec<Run>>, ApiError> {
    let runs = state.storage.list_runs().await?;
    Ok(Json(runs))
}

async fn get_run(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> Result<Json<Run>, ApiError> {
    let run = state.storage.get_run(&id).await?;
    match run {
        Some(run) => Ok(Json(run)),
        None => Err(ApiError::NotFound(format!("run {id} not found"))),
    }
}

async fn get_run_spans(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<Span>>, ApiError> {
    let spans = state.storage.get_spans(&id).await?;
    Ok(Json(spans))
}

pub enum ApiError {
    Validation(String),
    NotFound(String),
    Storage(String),
}

impl From<AgentScopeError> for ApiError {
    fn from(value: AgentScopeError) -> Self {
        match value {
            AgentScopeError::Validation(message) => Self::Validation(message),
            AgentScopeError::Storage(message) => Self::Storage(message),
            AgentScopeError::Config(message) => Self::Storage(message),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        match self {
            Self::Validation(message) => (StatusCode::BAD_REQUEST, message).into_response(),
            Self::NotFound(message) => (StatusCode::NOT_FOUND, message).into_response(),
            Self::Storage(message) => {
                error!(error = %message, "request failed due to storage error");
                (StatusCode::INTERNAL_SERVER_ERROR, message).into_response()
            }
        }
    }
}
