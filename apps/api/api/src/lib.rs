pub mod auth;
mod engine;
mod events;
mod routes;

use std::sync::Arc;

use agentscope_common::errors::AgentScopeError;
use agentscope_storage::Storage;
use agentscope_trace::{Artifact, Run, RunInsight, RunMetrics, RunRootCause, Span};
use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    middleware::from_fn_with_state,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;
use tracing::{error, info};

use crate::auth::{AuthenticatedUser, JwtSettings, ProjectApiKeyAuth};
use crate::engine::replay::replay_engine::{
    ModifyReplayRequest, ReplayEngine, ReplayResponse, StartReplayRequest,
};
use crate::routes::sandbox::SandboxManager;

#[derive(Clone)]
pub struct AppState {
    pub storage: Storage,
    pub span_events: broadcast::Sender<events::SpanEvent>,
    pub sandbox: SandboxManager,
    pub jwt: JwtSettings,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct IngestPayload {
    pub run: Run,
    pub spans: Vec<Span>,
    pub artifacts: Vec<Artifact>,
}

pub fn app(storage: Storage, jwt: JwtSettings) -> Router {
    let state = Arc::new(AppState {
        storage,
        span_events: events::span_event_channel(),
        sandbox: SandboxManager::new(),
        jwt,
    });

    let sdk_routes = Router::new()
        .route("/ingest", post(ingest))
        .route_layer(from_fn_with_state(state.clone(), auth::require_api_key));

    let sandbox_routes = Router::new()
        .route("/python/run", post(routes::sandbox::run_python))
        .route("/real/run", post(routes::sandbox::run_real))
        .route("/ts/run", post(routes::sandbox::run_ts))
        .route_layer(from_fn_with_state(state.clone(), auth::require_admin_role))
        .route("/status", get(routes::sandbox::status));

    let ui_routes = Router::new()
        .route("/events/stream", get(events::stream))
        .route("/runs", get(list_runs))
        .route("/runs/:id", get(get_run))
        .route("/runs/:id/spans", get(get_run_spans))
        .route("/runs/:id/artifacts", get(get_run_artifacts))
        .route("/runs/:id/metrics", get(get_run_metrics))
        .route("/runs/:id/insights", get(get_run_insights))
        .route("/runs/:id/root-cause", get(get_run_root_cause))
        .route("/replay/start", post(start_replay))
        .route("/replay/:id/step", post(step_replay))
        .route("/replay/:id/modify", post(modify_replay))
        .route("/replay/:id/resume", post(resume_replay))
        .nest("/sandbox", sandbox_routes)
        .route_layer(from_fn_with_state(state.clone(), auth::require_jwt));

    Router::new()
        .route("/v1/auth/login", post(auth::login))
        .route("/v1/auth/register", post(auth::register))
        .nest("/v1", sdk_routes.merge(ui_routes))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

async fn ingest(
    State(state): State<Arc<AppState>>,
    Extension(api_key): Extension<ProjectApiKeyAuth>,
    Json(payload): Json<IngestPayload>,
) -> Result<impl IntoResponse, ApiError> {
    info!(run_id = %payload.run.id, "received ingest request");

    validate_payload(&payload, &api_key.project_id)?;

    state.storage.insert_run(&payload.run).await?;

    for span in &payload.spans {
        state.storage.insert_span(span).await?;
        events::publish_span_created(&state.span_events, span);
    }

    for artifact in &payload.artifacts {
        state.storage.insert_artifact(artifact).await?;
    }

    Ok(StatusCode::OK)
}

fn validate_payload(payload: &IngestPayload, project_id: &str) -> Result<(), ApiError> {
    if payload.run.id.is_empty() {
        return Err(ApiError::Validation("run.id is required".to_string()));
    }

    if payload.run.project_id != project_id {
        return Err(ApiError::Forbidden(
            "api key cannot write to a different project".to_string(),
        ));
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

async fn list_runs(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<Run>>, ApiError> {
    let runs = state.storage.list_runs_for_user(&user.id).await?;
    Ok(Json(runs))
}

async fn get_run(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<Run>, ApiError> {
    let run = state.storage.get_run_for_user(&id, &user.id).await?;
    match run {
        Some(run) => Ok(Json(run)),
        None => Err(ApiError::NotFound(format!("run {id} not found"))),
    }
}

async fn get_run_spans(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<Span>>, ApiError> {
    ensure_run_access(&state, &id, &user.id).await?;
    let spans = state.storage.get_spans(&id).await?;
    Ok(Json(spans))
}

async fn get_run_artifacts(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<Artifact>>, ApiError> {
    ensure_run_access(&state, &id, &user.id).await?;
    let artifacts = state.storage.get_artifacts(&id).await?;
    Ok(Json(artifacts))
}

async fn get_run_metrics(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<RunMetrics>, ApiError> {
    ensure_run_access(&state, &id, &user.id).await?;
    let metrics = state.storage.get_run_metrics(&id).await?;
    Ok(Json(metrics))
}

async fn get_run_insights(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<RunInsight>>, ApiError> {
    ensure_run_access(&state, &id, &user.id).await?;
    let insights = state.storage.get_run_insights(&id).await?;
    Ok(Json(insights))
}

async fn get_run_root_cause(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<RunRootCause>, ApiError> {
    ensure_run_access(&state, &id, &user.id).await?;
    let root_cause = state
        .storage
        .get_run_root_causes(&id)
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| ApiError::NotFound(format!("root cause for run {id} not found")))?;

    Ok(Json(root_cause))
}

async fn start_replay(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(payload): Json<StartReplayRequest>,
) -> Result<Json<ReplayResponse>, ApiError> {
    ensure_run_access(&state, &payload.original_run_id, &user.id).await?;
    let replay = ReplayEngine::new_with_events(&state.storage, state.span_events.clone())
        .start(payload)
        .await?;
    Ok(Json(replay))
}

async fn step_replay(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<ReplayResponse>, ApiError> {
    ensure_replay_access(&state, &id, &user.id).await?;
    let replay = ReplayEngine::new_with_events(&state.storage, state.span_events.clone())
        .step(&id)
        .await?;
    Ok(Json(replay))
}

async fn modify_replay(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(payload): Json<ModifyReplayRequest>,
) -> Result<Json<ReplayResponse>, ApiError> {
    ensure_replay_access(&state, &id, &user.id).await?;
    let replay = ReplayEngine::new_with_events(&state.storage, state.span_events.clone())
        .modify(&id, payload)
        .await?;
    Ok(Json(replay))
}

async fn resume_replay(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<ReplayResponse>, ApiError> {
    ensure_replay_access(&state, &id, &user.id).await?;
    let replay = ReplayEngine::new_with_events(&state.storage, state.span_events.clone())
        .resume(&id)
        .await?;
    Ok(Json(replay))
}

async fn ensure_run_access(
    state: &Arc<AppState>,
    run_id: &str,
    user_id: &str,
) -> Result<Run, ApiError> {
    state
        .storage
        .get_run_for_user(run_id, user_id)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("run {run_id} not found")))
}

async fn ensure_replay_access(
    state: &Arc<AppState>,
    replay_id: &str,
    user_id: &str,
) -> Result<(), ApiError> {
    if state
        .storage
        .get_run_replay_for_user(replay_id, user_id)
        .await?
        .is_none()
    {
        return Err(ApiError::NotFound(format!("replay {replay_id} not found")));
    }

    Ok(())
}

pub enum ApiError {
    Validation(String),
    NotFound(String),
    Forbidden(String),
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
            Self::Forbidden(message) => (StatusCode::FORBIDDEN, message).into_response(),
            Self::Storage(message) => {
                error!(error = %message, "request failed due to storage error");
                (StatusCode::INTERNAL_SERVER_ERROR, message).into_response()
            }
        }
    }
}
