pub mod analysis;
pub mod auth;
pub mod demo;
mod engine;
mod events;
mod routes;
mod swagger;

use std::sync::Arc;

use agentscope_common::errors::AgentScopeError;
use agentscope_storage::{runs::RunSearchFilters, Storage};
use agentscope_trace::{
    Artifact, ProjectInsight, Run, RunAnalysis, RunInsight, RunMetrics, RunRootCause, Span,
};
use axum::{
    extract::{Extension, Path, Query, State},
    http::{header, Method, StatusCode},
    middleware::from_fn_with_state,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;
use tracing::{error, info};
use uuid::Uuid;

use crate::analysis::pricing;
use crate::analysis::run_compare::RunCompareResponse;
use crate::auth::{
    permissions::Permission, AuthenticatedUser, JwtSettings, ProjectApiKeyAuth,
};
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

#[derive(Debug, Serialize)]
pub struct ProjectApiKeyResponse {
    pub api_key: String,
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
        .route("/runs/:id/analysis", get(get_run_analysis))
        .route("/runs/:id/spans", get(get_run_spans))
        .route("/runs/:id/artifacts", get(get_run_artifacts))
        .route("/runs/:id/metrics", get(get_run_metrics))
        .route("/runs/:id/insights", get(get_run_insights))
        .route("/runs/:id/root-cause", get(get_run_root_cause))
        .route("/runs/:id/compare/:other_id", get(compare_runs))
        .route("/demo/scenarios", get(routes::demo::list_scenarios))
        .route("/demo/run", post(routes::demo::run_demo))
        .route("/projects/:id/insights", get(get_project_insights))
        .route("/projects/:id/api-keys", post(create_project_api_key))
        .route("/onboarding/state", get(get_onboarding_state))
        .route("/replay/start", post(start_replay))
        .route("/replay/:id/step", post(step_replay))
        .route("/replay/:id/modify", post(modify_replay))
        .route("/replay/:id/resume", post(resume_replay))
        .nest("/sandbox", sandbox_routes)
        .route_layer(from_fn_with_state(state.clone(), auth::require_jwt));

    Router::new()
        .route("/openapi.json", get(swagger::openapi_json))
        .route("/swagger", get(swagger::swagger_ui))
        .route("/v1/auth/login", post(auth::login))
        .route("/v1/auth/register", post(auth::register))
        .route("/v1/auth/logout", post(auth::logout))
        .route("/v1/auth/me", get(auth::me))
        .route("/v1/auth/oauth/:provider", get(auth::oauth_start))
        .route("/v1/auth/oauth/:provider/callback", get(auth::oauth_callback))
        .nest("/v1", sdk_routes.merge(ui_routes))
        .layer(
            CorsLayer::new()
                .allow_origin("http://localhost:3000".parse::<header::HeaderValue>().unwrap())
                .allow_credentials(true)
                .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE, header::COOKIE])
                .allow_methods([Method::GET, Method::POST, Method::OPTIONS]),
        )
        .with_state(state)
}

async fn ingest(
    State(state): State<Arc<AppState>>,
    Extension(api_key): Extension<ProjectApiKeyAuth>,
    Json(mut payload): Json<IngestPayload>,
) -> Result<impl IntoResponse, ApiError> {
    info!(run_id = %payload.run.id, "received ingest request");

    validate_payload(&payload)?;
    attach_project_context(&mut payload, &api_key);
    normalize_spans(&mut payload.spans);

    state.storage.insert_run(&payload.run).await?;

    for span in &payload.spans {
        state.storage.insert_span(span).await?;
        events::publish_span_created(&state.span_events, span);
    }

    for artifact in &payload.artifacts {
        state.storage.insert_artifact(artifact).await?;
    }

    state.storage.update_run_metrics(&payload.run.id).await?;

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

fn attach_project_context(payload: &mut IngestPayload, api_key: &ProjectApiKeyAuth) {
    payload.run.project_id = api_key.project_id.clone();
    payload.run.organization_id = Some(api_key.organization_id.clone());
}

fn normalize_spans(spans: &mut [Span]) {
    for span in spans {
        if span.total_tokens.is_none() {
            span.total_tokens = match (span.input_tokens, span.output_tokens) {
                (None, None) => None,
                (input, output) => Some(input.unwrap_or(0) + output.unwrap_or(0)),
            };
        }

        if span.estimated_cost.is_none() {
            if let Some(model) = span.model.as_deref() {
                let estimated = pricing::estimate_cost(
                    model,
                    span.input_tokens.unwrap_or(0) as i32,
                    span.output_tokens.unwrap_or(0) as i32,
                );
                if estimated > 0.0 {
                    span.estimated_cost = Some(estimated);
                }
            }
        }

        if span.context_usage_percent.is_none() {
            if let (Some(total_tokens), Some(context_window)) =
                (span.total_tokens, span.context_window)
            {
                if context_window > 0 {
                    span.context_usage_percent =
                        Some((total_tokens as f64 / context_window as f64) * 100.0);
                }
            }
        }
    }
}

async fn list_runs(
    State(state): State<Arc<AppState>>,
    Query(filters): Query<ListRunsQuery>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<Run>>, ApiError> {
    let runs = state
        .storage
        .list_runs_for_user_filtered(
            &user.id,
            &RunSearchFilters {
                query: filters.query,
                status: filters.status,
                workflow_name: filters.workflow_name,
                agent_name: filters.agent_name,
                project_id: filters.project_id,
                limit: filters.limit,
            },
        )
        .await?;
    Ok(Json(runs))
}

#[derive(Debug, Deserialize)]
struct ListRunsQuery {
    query: Option<String>,
    status: Option<String>,
    workflow_name: Option<String>,
    agent_name: Option<String>,
    project_id: Option<String>,
    limit: Option<i64>,
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

async fn get_run_analysis(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<RunAnalysis>, ApiError> {
    ensure_run_access(&state, &id, &user.id).await?;

    let analysis = match state.storage.get_run_analysis(&id).await? {
        Some(analysis) => analysis,
        None => analysis::rca_engine::analyze_run(&state.storage, &id).await?,
    };

    Ok(Json(analysis))
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

async fn compare_runs(
    Path((id, other_id)): Path<(String, String)>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<RunCompareResponse>, ApiError> {
    ensure_run_access(&state, &id, &user.id).await?;
    ensure_run_access(&state, &other_id, &user.id).await?;
    let comparison = analysis::run_compare::compare_runs(&state.storage, &id, &other_id).await?;
    Ok(Json(comparison))
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

async fn get_project_insights(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<ProjectInsight>>, ApiError> {
    ensure_project_access(&state, &id, &user.id).await?;

    let insights = match state.storage.get_project_insights(&id).await? {
        existing if existing.is_empty() => {
            analysis::insights_engine::analyze_project(&state.storage, &id).await?
        }
        existing => existing,
    };

    Ok(Json(insights))
}

async fn create_project_api_key(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<ProjectApiKeyResponse>, ApiError> {
    ensure_project_access(&state, &id, &user.id).await?;

    if !user
        .permissions
        .iter()
        .any(|permission| permission == Permission::ApiKeyCreate.as_str())
    {
        return Err(ApiError::Forbidden(
            "project api key creation requires api_key:create permission".to_string(),
        ));
    }

    let raw_key = auth::api_key::generate_project_api_key();
    let label = format!("sdk-key-{}", Uuid::new_v4().simple());
    state
        .storage
        .create_project_api_key(&id, &label, &raw_key)
        .await?;

    Ok(Json(ProjectApiKeyResponse { api_key: raw_key }))
}

async fn get_onboarding_state(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<agentscope_storage::auth::OnboardingState>, ApiError> {
    let onboarding = state.storage.get_onboarding_state(&user.id, None).await?;
    Ok(Json(onboarding))
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

async fn ensure_project_access(
    state: &Arc<AppState>,
    project_id: &str,
    user_id: &str,
) -> Result<(), ApiError> {
    if !state
        .storage
        .user_has_project_access(user_id, project_id)
        .await?
    {
        return Err(ApiError::NotFound(format!(
            "project {project_id} not found"
        )));
    }

    Ok(())
}

pub enum ApiError {
    Validation(String),
    NotFound(String),
    Unauthorized(String),
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
            Self::Unauthorized(message) => (StatusCode::UNAUTHORIZED, message).into_response(),
            Self::Forbidden(message) => (StatusCode::FORBIDDEN, message).into_response(),
            Self::Storage(message) => {
                error!(error = %message, "request failed due to storage error");
                (StatusCode::INTERNAL_SERVER_ERROR, message).into_response()
            }
        }
    }
}
