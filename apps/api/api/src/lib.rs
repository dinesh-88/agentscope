#![recursion_limit = "512"]

pub mod analysis;
pub mod auth;
mod engine;
mod events;
mod limits;
mod swagger;

use std::{env, sync::Arc};

use agentscope_common::errors::AgentScopeError;
use agentscope_storage::{runs::RunSearchFilters, search::ArtifactSearchFilters, Storage};
use agentscope_trace::{
    Artifact, ArtifactSearchResponse, Run, RunAnalysis, RunInsight, RunMetrics, RunRootCause, Span,
};
use axum::{
    extract::{Extension, Path, Query, State},
    http::{header, Method, StatusCode},
    middleware::from_fn_with_state,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;
use tracing::{error, info};
use uuid::Uuid;

use crate::analysis::pricing;
use crate::analysis::run_compare::RunCompareResponse;
use crate::auth::{permissions::Permission, AuthenticatedUser, JwtSettings, ProjectApiKeyAuth};
use crate::engine::replay::replay_engine::{
    ModifyReplayRequest, ReplayEngine, ReplayResponse, StartReplayRequest,
};

#[derive(Clone)]
pub struct AppState {
    pub storage: Storage,
    pub span_events: broadcast::Sender<events::SpanEvent>,
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
    let cors_allowed_origins = env::var("CORS_ALLOWED_ORIGINS")
        .ok()
        .map(|value| {
            value
                .split(',')
                .filter_map(|origin| {
                    let trimmed = origin.trim();
                    if trimmed.is_empty() {
                        return None;
                    }
                    trimmed.parse::<header::HeaderValue>().ok()
                })
                .collect::<Vec<_>>()
        })
        .filter(|origins| !origins.is_empty())
        .unwrap_or_else(|| {
            vec!["http://localhost:3000"
                .parse::<header::HeaderValue>()
                .expect("localhost origin must parse")]
        });

    let state = Arc::new(AppState {
        storage,
        span_events: events::span_event_channel(),
        jwt,
    });

    let sdk_routes = Router::new()
        .route("/ingest", post(ingest))
        .route_layer(from_fn_with_state(state.clone(), auth::require_api_key));

    let ui_routes = Router::new()
        .route("/events/stream", get(events::stream))
        .route("/runs", get(list_runs))
        .route("/runs/search", get(search_runs))
        .route("/search", get(search_artifacts))
        .route("/runs/:id", get(get_run))
        .route("/runs/:id/analysis", get(get_run_analysis))
        .route("/runs/:id/spans", get(get_run_spans))
        .route("/runs/:id/artifacts", get(get_run_artifacts))
        .route("/runs/:id/metrics", get(get_run_metrics))
        .route("/runs/:id/insights", get(get_run_insights))
        .route("/runs/:id/root-cause", get(get_run_root_cause))
        .route("/runs/:id/compare/:other_id", get(compare_runs))
        .route("/projects/:id/insights", get(get_project_insights))
        .route("/projects/:id/usage", get(get_project_usage))
        .route("/alerts", post(create_alert).get(list_alerts))
        .route("/alerts/:id", axum::routing::delete(delete_alert))
        .route("/alerts/events", get(list_alert_events))
        .route("/orgs/:org_id/invites", post(create_org_invite))
        .route("/invites/accept", post(accept_invite))
        .route("/orgs/:org_id/members", get(list_org_members))
        .route(
            "/orgs/:org_id/members/:user_id",
            axum::routing::delete(remove_org_member),
        )
        .route("/projects/:id/api-keys", post(create_project_api_key))
        .route("/onboarding/state", get(get_onboarding_state))
        .route("/replay/start", post(start_replay))
        .route("/replay/:id/step", post(step_replay))
        .route("/replay/:id/modify", post(modify_replay))
        .route("/replay/:id/resume", post(resume_replay))
        .route_layer(from_fn_with_state(state.clone(), auth::require_jwt));

    Router::new()
        .route("/openapi.json", get(swagger::openapi_json))
        .route("/swagger", get(swagger::swagger_ui))
        .route("/v1/auth/login", post(auth::login))
        .route("/v1/auth/register", post(auth::register))
        .route("/v1/auth/logout", post(auth::logout))
        .route("/v1/auth/me", get(auth::me))
        .route("/v1/auth/oidc", get(auth::oidc_start))
        .route("/v1/auth/oidc/callback", get(auth::oidc_callback))
        .route("/v1/auth/oauth/:provider", get(auth::oauth_start))
        .route(
            "/v1/auth/oauth/:provider/callback",
            get(auth::oauth_callback),
        )
        .nest("/v1", sdk_routes.merge(ui_routes))
        .layer(
            CorsLayer::new()
                .allow_origin(cors_allowed_origins)
                .allow_credentials(true)
                .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE, header::COOKIE])
                .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS]),
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
    normalize_run(&mut payload.run);
    normalize_spans(&mut payload.spans);
    limits::check_rate_limit(&state, &payload.run.project_id).await?;
    limits::check_token_quota(&state, &payload.run.project_id, payload.run.total_tokens).await?;

    state.storage.insert_run(&payload.run).await?;

    for span in &payload.spans {
        state.storage.insert_span(span).await?;
        events::publish_span_created(&state.span_events, span);
    }

    for artifact in &payload.artifacts {
        state.storage.insert_artifact(artifact).await?;
    }

    state.storage.update_run_metrics(&payload.run.id).await?;
    limits::increment_usage(&state, &payload.run.project_id, payload.run.total_tokens).await?;

    Ok(StatusCode::OK)
}

#[derive(Debug, Deserialize)]
struct CreateAlertRequest {
    project_id: String,
    name: String,
    condition_type: String,
    threshold_value: f64,
    window_minutes: i32,
}

#[derive(Debug, Serialize)]
struct ProjectUsagePoint {
    date: String,
    runs: i32,
    tokens: i64,
    cost: f64,
    errors: i32,
}

#[derive(Debug, Deserialize)]
struct CreateInviteRequest {
    email: String,
    role: String,
}

#[derive(Debug, Deserialize)]
struct AcceptInviteRequest {
    token: String,
}

fn validate_payload(payload: &IngestPayload) -> Result<(), ApiError> {
    if payload.run.id.is_empty() {
        return Err(ApiError::Validation("run.id is required".to_string()));
    }
    if Uuid::parse_str(&payload.run.id).is_err() {
        return Err(ApiError::Validation(
            "run.id must be a valid UUID".to_string(),
        ));
    }

    for span in &payload.spans {
        if Uuid::parse_str(&span.id).is_err() {
            return Err(ApiError::Validation(
                "every span.id must be a valid UUID".to_string(),
            ));
        }
        if span.run_id != payload.run.id {
            return Err(ApiError::Validation(
                "every span.run_id must match run.id".to_string(),
            ));
        }
        if Uuid::parse_str(&span.run_id).is_err() {
            return Err(ApiError::Validation(
                "every span.run_id must be a valid UUID".to_string(),
            ));
        }
        if let Some(parent_span_id) = &span.parent_span_id {
            if Uuid::parse_str(parent_span_id).is_err() {
                return Err(ApiError::Validation(
                    "every span.parent_span_id must be a valid UUID".to_string(),
                ));
            }
        }
    }

    for artifact in &payload.artifacts {
        if Uuid::parse_str(&artifact.id).is_err() {
            return Err(ApiError::Validation(
                "every artifact.id must be a valid UUID".to_string(),
            ));
        }
        if artifact.run_id != payload.run.id {
            return Err(ApiError::Validation(
                "every artifact.run_id must match run.id".to_string(),
            ));
        }
        if Uuid::parse_str(&artifact.run_id).is_err() {
            return Err(ApiError::Validation(
                "every artifact.run_id must be a valid UUID".to_string(),
            ));
        }
        if let Some(span_id) = &artifact.span_id {
            if Uuid::parse_str(span_id).is_err() {
                return Err(ApiError::Validation(
                    "every artifact.span_id must be a valid UUID".to_string(),
                ));
            }
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
        if let Some(error) = span.error.take() {
            if span.error_type.is_none() {
                span.error_type = error.error_type;
            }
            if span.error_source.is_none() {
                span.error_source = error.error_source;
            }
            if span.retryable.is_none() {
                span.retryable = error.retryable;
            }
            if let Some(raw_error_metadata) = error.metadata {
                let mut metadata = span
                    .metadata
                    .take()
                    .and_then(|value| value.as_object().cloned())
                    .unwrap_or_default();
                metadata.insert("error_metadata".to_string(), raw_error_metadata);
                span.metadata = Some(Value::Object(metadata));
            }
        }

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

        span.input_tokens = span.input_tokens.map(|value| value.max(0));
        span.output_tokens = span.output_tokens.map(|value| value.max(0));
        span.total_tokens = span.total_tokens.map(|value| value.max(0));
        span.context_window = span.context_window.map(|value| value.max(0));
        span.max_tokens = span.max_tokens.map(|value| value.max(0));
        span.retry_attempt = span.retry_attempt.map(|value| value.max(0));
        span.max_attempts = span.max_attempts.map(|value| value.max(0));
        span.temperature = span.temperature.map(|value| value.clamp(0.0, 2.0));
        span.top_p = span.top_p.map(|value| value.clamp(0.0, 1.0));
        span.context_usage_percent = span
            .context_usage_percent
            .map(|value| value.clamp(0.0, 1000.0));
        span.latency_ms = span.latency_ms.map(|value| value.max(0.0));
        span.tool_latency_ms = span.tool_latency_ms.map(|value| value.max(0.0));

        if span.latency_ms.is_none() {
            if let Some(ended_at) = span.ended_at {
                let delta = ended_at
                    .signed_duration_since(span.started_at)
                    .num_milliseconds();
                span.latency_ms = Some(delta.max(0) as f64);
            }
        }

        if span.success.is_none() {
            span.success = Some(matches!(
                span.status.as_str(),
                "success" | "ok" | "completed"
            ));
        }

        span.error_type = span.error_type.take().map(normalize_error_type);
        span.error_source = span.error_source.take().map(normalize_error_source);
        let span_failed = matches!(span.status.as_str(), "failed" | "error");
        if span_failed && span.error_type.is_none() {
            span.error_type = Some("unknown".to_string());
        }
        if span_failed && span.error_source.is_none() {
            span.error_source = Some("system".to_string());
        }

        span.evaluation = normalize_evaluation(span.evaluation.take());
    }
}

fn normalize_run(run: &mut Run) {
    run.total_input_tokens = run.total_input_tokens.max(0);
    run.total_output_tokens = run.total_output_tokens.max(0);
    run.total_tokens = run.total_tokens.max(0);
    run.total_cost_usd = run.total_cost_usd.max(0.0);

    run.environment =
        run.environment
            .take()
            .map(|value| match value.trim().to_lowercase().as_str() {
                "prod" | "production" => "prod".to_string(),
                "staging" => "staging".to_string(),
                "dev" | "development" => "dev".to_string(),
                _ => "dev".to_string(),
            });

    run.tags = run.tags.take().map(|tags| {
        tags.into_iter()
            .map(|tag| tag.trim().chars().take(64).collect::<String>())
            .filter(|tag| !tag.is_empty())
            .take(20)
            .collect::<Vec<_>>()
    });
}

fn normalize_error_type(value: String) -> String {
    match value.trim().to_lowercase().as_str() {
        "invalid_json" => "invalid_json".to_string(),
        "rate_limit" => "rate_limit".to_string(),
        "timeout" => "timeout".to_string(),
        "tool_error" => "tool_error".to_string(),
        _ => "unknown".to_string(),
    }
}

fn normalize_error_source(value: String) -> String {
    match value.trim().to_lowercase().as_str() {
        "provider" => "provider".to_string(),
        "tool" => "tool".to_string(),
        "system" => "system".to_string(),
        _ => "system".to_string(),
    }
}

fn normalize_evaluation(evaluation: Option<Value>) -> Option<Value> {
    let mut value = evaluation?;
    let object = match value.as_object_mut() {
        Some(object) => object,
        None => return None,
    };

    clamp_score(object);
    constrain_string_field(object, "reason", 2048);
    constrain_string_field(object, "evaluator", 32);

    if serde_json::to_vec(&value)
        .map(|bytes| bytes.len() > 16 * 1024)
        .unwrap_or(true)
    {
        return None;
    }

    Some(value)
}

fn clamp_score(object: &mut Map<String, Value>) {
    let score = object
        .get("score")
        .and_then(|value| value.as_f64())
        .map(|value| value.clamp(0.0, 1.0));
    if let Some(score) = score {
        object.insert("score".to_string(), Value::from(score));
    }
}

fn constrain_string_field(object: &mut Map<String, Value>, key: &str, max_chars: usize) {
    let value = object
        .get(key)
        .and_then(|value| value.as_str())
        .map(|value| value.chars().take(max_chars).collect::<String>());
    if let Some(value) = value {
        object.insert(key.to_string(), Value::String(value));
    }
}

async fn list_runs(
    State(state): State<Arc<AppState>>,
    Query(filters): Query<ListRunsQuery>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<Run>>, ApiError> {
    let filters = filters.into_storage_filters()?;
    let runs = state
        .storage
        .list_runs_for_user_filtered(&user.id, &filters)
        .await?;
    Ok(Json(runs))
}

async fn search_runs(
    State(state): State<Arc<AppState>>,
    Query(filters): Query<ListRunsQuery>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<Run>>, ApiError> {
    let filters = filters.into_storage_filters()?;
    let runs = state
        .storage
        .list_runs_for_user_filtered(&user.id, &filters)
        .await?;
    Ok(Json(runs))
}

async fn search_artifacts(
    State(state): State<Arc<AppState>>,
    Query(query): Query<SearchArtifactsQuery>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<ArtifactSearchResponse>, ApiError> {
    let filters = query.into_storage_filters()?;
    let results = state
        .storage
        .search_artifacts_for_user(&user.id, &filters)
        .await?;
    Ok(Json(results))
}

#[derive(Debug, Deserialize)]
struct ListRunsQuery {
    query: Option<String>,
    status: Option<String>,
    model: Option<String>,
    agent: Option<String>,
    workflow_name: Option<String>,
    agent_name: Option<String>,
    tokens_min: Option<i64>,
    tokens_max: Option<i64>,
    duration_min_ms: Option<i64>,
    duration_max_ms: Option<i64>,
    time_from: Option<String>,
    time_to: Option<String>,
    project_id: Option<String>,
    limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct SearchArtifactsQuery {
    query: Option<String>,
    error_type: Option<String>,
    model: Option<String>,
    span_type: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(rename = "tags[]", default)]
    tags_bracketed: Vec<String>,
    limit: Option<i64>,
    offset: Option<i64>,
}

impl ListRunsQuery {
    fn into_storage_filters(self) -> Result<RunSearchFilters, ApiError> {
        Ok(RunSearchFilters {
            query: self.query,
            status: self.status,
            model: self.model,
            agent: self.agent,
            workflow_name: self.workflow_name,
            agent_name: self.agent_name,
            tokens_min: self.tokens_min,
            tokens_max: self.tokens_max,
            duration_min_ms: self.duration_min_ms,
            duration_max_ms: self.duration_max_ms,
            time_from: parse_timestamp(self.time_from.as_deref(), "time_from")?,
            time_to: parse_timestamp(self.time_to.as_deref(), "time_to")?,
            project_id: self.project_id,
            limit: self.limit,
        })
    }
}

impl SearchArtifactsQuery {
    fn into_storage_filters(self) -> Result<ArtifactSearchFilters, ApiError> {
        let query = self
            .query
            .unwrap_or_default()
            .trim()
            .chars()
            .take(512)
            .collect::<String>();
        if query.is_empty() {
            return Err(ApiError::Validation("query is required".to_string()));
        }

        let limit = self.limit.unwrap_or(25);
        if !(1..=100).contains(&limit) {
            return Err(ApiError::Validation(
                "limit must be between 1 and 100".to_string(),
            ));
        }

        let offset = self.offset.unwrap_or(0);
        if offset < 0 {
            return Err(ApiError::Validation(
                "offset must be greater than or equal to 0".to_string(),
            ));
        }

        let tags = self
            .tags
            .into_iter()
            .chain(self.tags_bracketed)
            .map(|value| value.trim().chars().take(64).collect::<String>())
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>();

        Ok(ArtifactSearchFilters {
            query,
            error_type: self.error_type.filter(|value| !value.is_empty()),
            model: self.model.filter(|value| !value.is_empty()),
            span_type: self.span_type.filter(|value| !value.is_empty()),
            tags: if tags.is_empty() { None } else { Some(tags) },
            limit,
            offset,
        })
    }
}

fn parse_timestamp(value: Option<&str>, field: &str) -> Result<Option<DateTime<Utc>>, ApiError> {
    let Some(value) = value.filter(|value| !value.is_empty()) else {
        return Ok(None);
    };

    DateTime::parse_from_rfc3339(value)
        .map(|timestamp| Some(timestamp.with_timezone(&Utc)))
        .map_err(|_| ApiError::Validation(format!("{field} must be RFC3339 timestamp")))
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
    let insights = match state.storage.get_run_insights(&id).await? {
        existing if existing.is_empty() => {
            analysis::run_insights_engine::analyze_run(&state.storage, &id).await?
        }
        existing => existing,
    };
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
) -> Result<Json<Vec<analysis::insights_engine::InsightCard>>, ApiError> {
    ensure_project_access(&state, &id, &user.id).await?;

    let insights = match state.storage.get_project_insights(&id).await? {
        existing if existing.is_empty() => {
            analysis::insights_engine::analyze_project(&state.storage, &id).await?
        }
        existing => existing,
    };

    Ok(Json(analysis::insights_engine::to_insight_cards(&insights)))
}

async fn get_project_usage(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<ProjectUsagePoint>>, ApiError> {
    ensure_project_access(&state, &id, &user.id).await?;
    state.storage.aggregate_project_usage_daily().await?;
    let rows = state.storage.get_project_usage_daily(&id).await?;
    let response = rows
        .into_iter()
        .map(|row| ProjectUsagePoint {
            date: row.date.to_string(),
            runs: row.run_count,
            tokens: row.total_tokens,
            cost: row.cost_usd,
            errors: row.error_count,
        })
        .collect::<Vec<_>>();
    Ok(Json(response))
}

async fn create_alert(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(payload): Json<CreateAlertRequest>,
) -> Result<Json<agentscope_storage::alerts::Alert>, ApiError> {
    ensure_project_access(&state, &payload.project_id, &user.id).await?;
    let allowed_conditions = [
        "failure_rate",
        "latency_ms",
        "token_usage",
        "cost_usd",
        "tool_error_rate",
    ];
    if !allowed_conditions.contains(&payload.condition_type.as_str()) {
        return Err(ApiError::Validation(
            "condition_type must be one of failure_rate, latency_ms, token_usage, cost_usd, tool_error_rate"
                .to_string(),
        ));
    }
    let alert = state
        .storage
        .create_alert(
            &payload.project_id,
            &payload.name,
            &payload.condition_type,
            payload.threshold_value,
            payload.window_minutes,
        )
        .await?;
    Ok(Json(alert))
}

async fn list_alerts(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<agentscope_storage::alerts::Alert>>, ApiError> {
    Ok(Json(state.storage.list_alerts_for_user(&user.id).await?))
}

async fn delete_alert(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<StatusCode, ApiError> {
    if !state.storage.delete_alert_for_user(&id, &user.id).await? {
        return Err(ApiError::NotFound(format!("alert {id} not found")));
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn list_alert_events(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<agentscope_storage::alerts::AlertEvent>>, ApiError> {
    Ok(Json(
        state.storage.list_alert_events_for_user(&user.id).await?,
    ))
}

async fn create_org_invite(
    Path(org_id): Path<String>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(payload): Json<CreateInviteRequest>,
) -> Result<Json<agentscope_storage::team::InviteRecord>, ApiError> {
    ensure_org_manage_access(&state, &org_id, &user).await?;
    let allowed_roles = ["owner", "admin", "developer", "viewer"];
    if !allowed_roles.contains(&payload.role.as_str()) {
        return Err(ApiError::Validation(
            "role must be one of owner, admin, developer, viewer".to_string(),
        ));
    }
    let invite = state
        .storage
        .create_invite(&org_id, &payload.email, &payload.role)
        .await?;
    Ok(Json(invite))
}

async fn accept_invite(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(payload): Json<AcceptInviteRequest>,
) -> Result<StatusCode, ApiError> {
    let accepted = state
        .storage
        .accept_invite(&payload.token, &user.id, &user.email)
        .await?;
    if accepted.is_none() {
        return Err(ApiError::Validation(
            "invalid or expired invite token".to_string(),
        ));
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn list_org_members(
    Path(org_id): Path<String>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<agentscope_storage::team::TeamMember>>, ApiError> {
    ensure_org_member_access(&state, &org_id, &user.id).await?;
    let members = state.storage.list_org_members(&org_id).await?;
    Ok(Json(members))
}

async fn remove_org_member(
    Path((org_id, user_id)): Path<(String, String)>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<StatusCode, ApiError> {
    ensure_org_manage_access(&state, &org_id, &user).await?;
    if !state.storage.remove_org_member(&org_id, &user_id).await? {
        return Err(ApiError::NotFound(format!(
            "member {user_id} not found in organization {org_id}"
        )));
    }
    Ok(StatusCode::NO_CONTENT)
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
    if !user
        .permissions
        .iter()
        .any(|permission| permission == Permission::ProjectManage.as_str())
    {
        return Err(ApiError::Forbidden(
            "project changes require project:manage permission".to_string(),
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

async fn ensure_org_member_access(
    state: &Arc<AppState>,
    organization_id: &str,
    user_id: &str,
) -> Result<(), ApiError> {
    if state
        .storage
        .get_role_for_organization(user_id, organization_id)
        .await?
        .is_none()
    {
        return Err(ApiError::NotFound(format!(
            "organization {organization_id} not found"
        )));
    }

    Ok(())
}

async fn ensure_org_manage_access(
    state: &Arc<AppState>,
    organization_id: &str,
    user: &AuthenticatedUser,
) -> Result<(), ApiError> {
    let role = state
        .storage
        .get_role_for_organization(&user.id, organization_id)
        .await?;
    let can_manage = matches!(role.as_deref(), Some("owner") | Some("admin"));
    if !can_manage {
        return Err(ApiError::Forbidden(
            "organization user management requires user:manage permission".to_string(),
        ));
    }
    Ok(())
}

pub enum ApiError {
    Validation(String),
    NotFound(String),
    Unauthorized(String),
    Forbidden(String),
    TooManyRequests(String),
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
            Self::TooManyRequests(message) => {
                (StatusCode::TOO_MANY_REQUESTS, message).into_response()
            }
            Self::Storage(message) => {
                error!(error = %message, "request failed due to storage error");
                (StatusCode::INTERNAL_SERVER_ERROR, message).into_response()
            }
        }
    }
}
