#![recursion_limit = "512"]

pub mod analysis;
pub mod auth;
pub mod billing;
mod engine;
mod events;
mod limits;
mod swagger;

use std::{
    collections::{HashMap, HashSet},
    env,
    hash::{Hash, Hasher},
    sync::Arc,
};

use agentscope_common::errors::AgentScopeError;
use agentscope_storage::{
    analysis::TrendRunFilters,
    issue_rankings::{IssueImpact, IssueImpactComputation, ProjectIssueRegressionRow},
    retention::{ProjectStorageSettings, RetentionApplyResult},
    runs::RunSearchFilters,
    search::ArtifactSearchFilters,
    weekly_reports::WeeklyReportRecord,
    Storage,
};
use agentscope_trace::{
    ActiveAlert, Artifact, ArtifactSearchResponse, FailureCluster, Run, RunAnalysis,
    RunExplanation, RunInsight, RunMetrics, RunRootCause, Span, TrendReport,
};
use axum::{
    body::Bytes,
    extract::{Extension, Path, Query, State},
    http::{header, Method, StatusCode},
    middleware::from_fn_with_state,
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sqlx::FromRow;
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
    pub run_events: events::RunEventHub,
    pub run_list_events: broadcast::Sender<events::RunListEvent>,
    pub jwt: JwtSettings,
    pub billing_provider: billing::DynBillingProvider,
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

#[derive(Debug, Serialize)]
struct ProjectIssueResponse {
    issue_key: String,
    category: String,
    subcategory: String,
    frequency: f64,
    cost_impact: f64,
    priority_score: f64,
    summary: Option<String>,
    root_cause: Option<String>,
    recommended_fix: Option<String>,
    expected_impact: Option<String>,
    confidence_score: Option<f64>,
    last_seen: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
struct ProjectIssuesQuery {
    limit: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum IssueImpactResponse {
    Processing(String),
    Impact(IssueImpact),
}

#[derive(Debug, Serialize)]
struct BillingResponse {
    plan: String,
    status: String,
    runs_used: i64,
    run_limit: i64,
}

#[derive(Debug, Deserialize)]
struct CreateCheckoutSessionRequest {
    success_url: String,
    cancel_url: String,
}

#[derive(Debug, Serialize)]
struct CreateCheckoutSessionResponse {
    checkout_url: String,
}

#[derive(Debug, Deserialize)]
struct WeeklyReportTriggerRequest {
    week_start: Option<String>,
    week_end: Option<String>,
}

#[derive(Debug, Clone, FromRow)]
struct WeekUsageAggRow {
    total_runs: i64,
    before_runs: i64,
    before_errors: i64,
    after_runs: i64,
    after_errors: i64,
}

#[derive(Debug, Clone, FromRow)]
struct WeekCostAggRow {
    cost_before: f64,
    cost_after: f64,
}

#[derive(Debug, Clone, FromRow)]
struct WeeklyTopIssueRow {
    issue_key: String,
    priority_score: f64,
}

#[derive(Debug, Clone, FromRow)]
struct WeeklyFixedIssueRow {
    issue_key: String,
    fixed_at: DateTime<Utc>,
    auto_detected: bool,
    detection_confidence: Option<f64>,
}

#[derive(Debug, Clone, FromRow)]
struct WeeklyRegressionRow {
    issue_key: String,
    detected_at: DateTime<Utc>,
    regression_severity: f64,
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

    let billing_provider: billing::DynBillingProvider =
        if let Some(provider) = billing::stripe::StripeBillingProvider::from_env() {
            Arc::new(provider)
        } else {
            Arc::new(billing::NoopBillingProvider)
        };

    let state = Arc::new(AppState {
        storage,
        span_events: events::span_event_channel(),
        run_events: events::RunEventHub::default(),
        run_list_events: events::run_list_event_channel(),
        jwt,
        billing_provider,
    });

    let sdk_routes = Router::new()
        .route("/ingest", post(ingest))
        .route_layer(from_fn_with_state(state.clone(), auth::require_api_key));

    let ui_routes = Router::new()
        .route("/events/stream", get(events::stream))
        .route("/runs/stream", get(events::runs_stream))
        .route("/runs/:id/stream", get(events::run_stream))
        .route("/runs", get(list_runs))
        .route("/runs/search", get(search_runs))
        .route("/search", get(search_artifacts))
        .route("/runs/:id", get(get_run))
        .route("/runs/:id/analysis", get(get_run_analysis))
        .route("/runs/:id/explanation", get(get_run_explanation))
        .route("/runs/:id/spans", get(get_run_spans))
        .route("/runs/:id/artifacts", get(get_run_artifacts))
        .route("/runs/:id/metrics", get(get_run_metrics))
        .route("/runs/:id/insights", get(get_run_insights))
        .route("/runs/:id/root-cause", get(get_run_root_cause))
        .route("/runs/:id/compare/:other_id", get(compare_runs))
        .route("/projects/:id/insights", get(get_project_insights))
        .route("/projects/:id/issues", get(get_project_issues))
        .route("/projects/:id/billing", get(get_project_billing))
        .route(
            "/projects/:id/billing/checkout",
            post(create_billing_checkout_session),
        )
        .route(
            "/projects/:id/alerts/active",
            get(get_project_active_alerts),
        )
        .route(
            "/projects/:id/failure-clusters",
            get(get_project_failure_clusters),
        )
        .route("/projects/:id/trends", get(get_project_trends))
        .route("/projects/:id/usage", get(get_project_usage))
        .route(
            "/projects/:id/storage-settings",
            get(get_project_storage_settings).put(update_project_storage_settings),
        )
        .route(
            "/projects/:id/storage-settings/apply",
            post(apply_project_retention),
        )
        .route("/alerts", post(create_alert).get(list_alerts))
        .route("/alerts/:id", delete(delete_alert))
        .route("/projects/:id/invite", post(create_project_invite))
        .route("/projects/:id/invites", get(list_project_pending_invites))
        .route(
            "/projects/:id/invites/:invite_id/resend",
            post(resend_project_invite),
        )
        .route(
            "/projects/:id/invites/:invite_id",
            delete(cancel_project_invite),
        )
        .route("/alerts/events", get(list_alert_events))
        .route(
            "/orgs/:org_id/invites",
            post(create_org_invite).get(list_org_pending_invites),
        )
        .route(
            "/orgs/:org_id/invites/:invite_id/resend",
            post(resend_org_invite),
        )
        .route(
            "/orgs/:org_id/invites/:invite_id",
            delete(cancel_org_invite),
        )
        .route("/invites/accept", post(accept_invite))
        .route("/orgs/:org_id/members", get(list_org_members))
        .route(
            "/orgs/:org_id/members/:user_id",
            delete(remove_org_member).put(update_org_member_role),
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
        .route("/v1/stripe/webhook", post(stripe_webhook))
        .route(
            "/api/projects/:id/issues",
            get(get_project_issues)
                .route_layer(from_fn_with_state(state.clone(), auth::require_jwt)),
        )
        .route(
            "/api/projects/:id/invite",
            post(create_project_invite)
                .route_layer(from_fn_with_state(state.clone(), auth::require_jwt)),
        )
        .route(
            "/api/projects/:project_id/issues/:issue_key/fix",
            post(mark_issue_fixed)
                .route_layer(from_fn_with_state(state.clone(), auth::require_jwt)),
        )
        .route(
            "/api/projects/:project_id/issues/:issue_key/impact",
            get(get_issue_impact)
                .route_layer(from_fn_with_state(state.clone(), auth::require_jwt)),
        )
        .route(
            "/api/projects/:project_id/regressions",
            get(get_project_regressions)
                .route_layer(from_fn_with_state(state.clone(), auth::require_jwt)),
        )
        .route(
            "/api/projects/:project_id/reports/weekly",
            get(get_project_weekly_report)
                .route_layer(from_fn_with_state(state.clone(), auth::require_jwt)),
        )
        .route(
            "/api/projects/:project_id/reports/weekly/trigger",
            post(trigger_project_weekly_report)
                .route_layer(from_fn_with_state(state.clone(), auth::require_jwt)),
        )
        .route(
            "/api/projects/:id/alerts",
            get(get_project_alert_events)
                .route_layer(from_fn_with_state(state.clone(), auth::require_jwt)),
        )
        .nest("/v1", sdk_routes.merge(ui_routes))
        .layer(
            CorsLayer::new()
                .allow_origin(cors_allowed_origins)
                .allow_credentials(true)
                .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE, header::COOKIE])
                .allow_methods([
                    Method::GET,
                    Method::POST,
                    Method::PUT,
                    Method::DELETE,
                    Method::OPTIONS,
                ]),
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
    normalize_spans(&mut payload.spans, &payload.artifacts);
    sync_run_metrics_from_spans(&mut payload.run, &payload.spans);
    normalize_span_context(&mut payload.spans, &payload.artifacts);
    limits::check_rate_limit(&state, &payload.run.project_id).await?;
    limits::check_subscription_run_quota(&state, &payload.run.project_id).await?;
    limits::check_token_quota(&state, &payload.run.project_id, payload.run.total_tokens).await?;
    apply_project_storage_policies(&state, &mut payload).await?;

    state.storage.insert_run(&payload.run).await?;

    for span in &payload.spans {
        state.storage.insert_span(span).await?;
        events::publish_span_created(&state.span_events, span);
        let event = events::span_lifecycle_event(span);
        events::publish_event(&state.run_events, &payload.run.id, event).await;
    }

    for artifact in &payload.artifacts {
        state.storage.insert_artifact(artifact).await?;
        let event = if artifact.kind == "log" {
            events::log_event(artifact)
        } else {
            events::artifact_created_event(artifact)
        };
        events::publish_event(&state.run_events, &payload.run.id, event).await;
    }

    if matches!(
        payload.run.status.as_str(),
        "success" | "completed" | "failed" | "error"
    ) {
        events::publish_event(
            &state.run_events,
            &payload.run.id,
            events::run_completed_event(&payload.run),
        )
        .await;
    }

    state.storage.update_run_metrics(&payload.run.id).await?;
    events::publish_run_list_event(
        &state.run_list_events,
        events::RunListEvent::run_upsert(&payload.run),
    );
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
struct UpdateMemberRoleRequest {
    role: String,
}

#[derive(Debug, Deserialize)]
struct UpdateStorageSettingsRequest {
    retention_days: Option<i32>,
    store_prompts_responses: bool,
    compress_old_runs: bool,
    #[serde(default)]
    redact_sensitive_data: Option<bool>,
    #[serde(default)]
    require_authentication: Option<bool>,
    cleanup_mode: String,
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

fn normalize_spans(spans: &mut [Span], artifacts: &[Artifact]) {
    let llm_usage_by_span = build_llm_usage_index(artifacts);

    for span in spans {
        if let Some(usage) = llm_usage_by_span.get(&span.id) {
            if span.model.is_none() {
                span.model = usage.model.clone();
            }
            if span.provider.is_none() {
                span.provider = usage.provider.clone();
            }
            if span.input_tokens.is_none() {
                span.input_tokens = usage.input_tokens;
            }
            if span.output_tokens.is_none() {
                span.output_tokens = usage.output_tokens;
            }
            if span.total_tokens.is_none() {
                span.total_tokens = usage.total_tokens.or_else(|| {
                    Some(usage.input_tokens.unwrap_or(0) + usage.output_tokens.unwrap_or(0))
                });
            }
            if span.estimated_cost.is_none() {
                if let Some(explicit_cost) = usage.explicit_cost.filter(|value| *value > 0.0) {
                    span.estimated_cost = Some(explicit_cost);
                }
            }
        }

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
        span.context_tokens = span.context_tokens.map(|value| value.max(0));
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
        let error_type_unknown = span
            .error_type
            .as_deref()
            .is_some_and(|value| value == "unknown" || value == "unknown_failure");
        if span_failed && (span.error_type.is_none() || error_type_unknown) {
            span.error_type = Some(match span.error_source.as_deref() {
                Some("tool") => "tool_error".to_string(),
                _ => "system_error".to_string(),
            });
        }
        if span_failed && span.error_source.is_none() {
            span.error_source = Some("system".to_string());
        }

        span.evaluation = normalize_evaluation(span.evaluation.take());
    }
}

#[derive(Debug, Default, Clone)]
struct LlmUsageSnapshot {
    provider: Option<String>,
    model: Option<String>,
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
    total_tokens: Option<i64>,
    explicit_cost: Option<f64>,
}

fn build_llm_usage_index(artifacts: &[Artifact]) -> HashMap<String, LlmUsageSnapshot> {
    let mut by_span = HashMap::<String, LlmUsageSnapshot>::new();
    for artifact in artifacts {
        let Some(span_id) = artifact.span_id.as_ref() else {
            continue;
        };
        if artifact.kind != "llm.response" && artifact.kind != "llm_payload" {
            continue;
        }

        let entry = by_span.entry(span_id.clone()).or_default();
        let payload = &artifact.payload;

        if entry.provider.is_none() {
            entry.provider = payload
                .get("provider")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
        }
        if entry.model.is_none() {
            entry.model = payload
                .get("model")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
        }

        if entry.input_tokens.is_none() {
            entry.input_tokens = extract_i64(payload, &["input_tokens", "prompt_tokens"]).or_else(|| {
                payload
                    .get("usage")
                    .and_then(|usage| extract_i64(usage, &["input_tokens", "prompt_tokens"]))
            });
        }

        if entry.output_tokens.is_none() {
            entry.output_tokens =
                extract_i64(payload, &["output_tokens", "completion_tokens"]).or_else(|| {
                    payload
                        .get("usage")
                        .and_then(|usage| extract_i64(usage, &["output_tokens", "completion_tokens"]))
                });
        }

        if entry.total_tokens.is_none() {
            entry.total_tokens = extract_i64(payload, &["total_tokens"]).or_else(|| {
                payload
                    .get("usage")
                    .and_then(|usage| extract_i64(usage, &["total_tokens"]))
            });
        }

        if entry.explicit_cost.is_none() {
            entry.explicit_cost = extract_f64(
                payload,
                &["cost", "estimated_cost", "total_cost", "cost_usd", "total_cost_usd"],
            )
            .or_else(|| {
                payload.get("usage").and_then(|usage| {
                    extract_f64(
                        usage,
                        &["cost", "estimated_cost", "total_cost", "cost_usd", "total_cost_usd"],
                    )
                })
            })
            .or_else(|| {
                payload.get("response").and_then(|response| {
                    extract_f64(
                        response,
                        &["cost", "estimated_cost", "total_cost", "cost_usd", "total_cost_usd"],
                    )
                    .or_else(|| {
                        response.get("usage").and_then(|usage| {
                            extract_f64(
                                usage,
                                &[
                                    "cost",
                                    "estimated_cost",
                                    "total_cost",
                                    "cost_usd",
                                    "total_cost_usd",
                                ],
                            )
                        })
                    })
                })
            });
        }
    }
    by_span
}

fn extract_i64(value: &Value, keys: &[&str]) -> Option<i64> {
    for key in keys {
        if let Some(found) = value.get(*key) {
            if let Some(number) = found.as_i64() {
                return Some(number.max(0));
            }
            if let Some(number) = found.as_u64() {
                return Some((number.min(i64::MAX as u64)) as i64);
            }
            if let Some(text) = found.as_str() {
                if let Ok(parsed) = text.parse::<i64>() {
                    return Some(parsed.max(0));
                }
            }
        }
    }
    None
}

fn extract_f64(value: &Value, keys: &[&str]) -> Option<f64> {
    for key in keys {
        if let Some(found) = value.get(*key) {
            if let Some(number) = found.as_f64() {
                return Some(number.max(0.0));
            }
            if let Some(text) = found.as_str() {
                if let Ok(parsed) = text.parse::<f64>() {
                    return Some(parsed.max(0.0));
                }
            }
        }
    }
    None
}

#[derive(Clone)]
struct ComparableContext {
    messages: HashSet<String>,
    variables: Map<String, Value>,
    context_tokens: i64,
}

fn normalize_span_context(spans: &mut [Span], artifacts: &[Artifact]) {
    let prompt_by_span = artifacts
        .iter()
        .filter(|artifact| artifact.kind == "llm.prompt")
        .filter_map(|artifact| {
            artifact
                .span_id
                .as_ref()
                .map(|span_id| (span_id.clone(), &artifact.payload))
        })
        .collect::<HashMap<_, _>>();
    let llm_context_by_span = artifacts
        .iter()
        .filter(|artifact| artifact.kind == "llm.context")
        .filter_map(|artifact| {
            artifact
                .span_id
                .as_ref()
                .map(|span_id| (span_id.clone(), &artifact.payload))
        })
        .collect::<HashMap<_, _>>();

    let mut ordered_indices = (0..spans.len()).collect::<Vec<_>>();
    ordered_indices.sort_by_key(|index| spans[*index].started_at);

    let mut previous_context: Option<ComparableContext> = None;
    for index in ordered_indices {
        let span = &mut spans[index];
        let prompt_payload = prompt_by_span.get(&span.id).copied();
        let context_artifact_payload = llm_context_by_span.get(&span.id).copied();

        let mut messages = extract_context_messages(prompt_payload);
        let mut system_prompt = extract_system_prompt(prompt_payload, &messages);
        let mut variables = extract_context_variables(prompt_payload);
        let mut tools_available = extract_tools_available(prompt_payload);
        let instruction_sources =
            extract_instruction_sources(context_artifact_payload, &system_prompt);

        if let Some(existing_context) = span.context.as_ref().and_then(Value::as_object) {
            if messages.is_empty() {
                messages = existing_context
                    .get("messages")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
            }
            if system_prompt.is_empty() {
                system_prompt = existing_context
                    .get("system_prompt")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
            }
            if variables.is_empty() {
                variables = existing_context
                    .get("variables")
                    .and_then(Value::as_object)
                    .cloned()
                    .unwrap_or_default();
            }
            if tools_available.is_empty() {
                tools_available = existing_context
                    .get("tools_available")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
            }
        }

        let has_context = !messages.is_empty()
            || !system_prompt.is_empty()
            || !variables.is_empty()
            || !tools_available.is_empty();
        if !instruction_sources.is_empty() {
            let precedence_stack = compute_instruction_precedence_stack(&instruction_sources);
            span.instruction_context = Some(json!({
                "sources": instruction_sources,
                "precedence_stack": precedence_stack
            }));
        }

        if !has_context {
            continue;
        }

        let estimated_context_tokens = estimate_context_tokens(
            span.input_tokens,
            &messages,
            &system_prompt,
            &variables,
            &tools_available,
        );
        span.context_tokens = Some(estimated_context_tokens.max(0));

        if span.context_window.is_some() {
            span.context_usage_percent =
                compute_context_usage_percent(span.context_tokens, span.context_window);
        }

        let message_set = messages
            .iter()
            .map(value_to_diff_string)
            .collect::<HashSet<_>>();

        let diff = compute_context_diff(previous_context.as_ref(), &message_set, &variables);
        let (context_shrank_unexpectedly, tokens_near_limit) = detect_context_truncation(
            previous_context.as_ref(),
            span.context_tokens.unwrap_or_default(),
            span.context_usage_percent,
        );
        let variables_for_next = variables.clone();

        span.context = Some(json!({
            "messages": messages,
            "system_prompt": system_prompt,
            "variables": variables,
            "tools_available": tools_available,
            "diff": diff,
            "metrics": {
                "total_tokens": span.context_tokens,
                "context_window": span.context_window,
                "context_usage_percent": span.context_usage_percent
            },
            "truncation": {
                "context_shrank_unexpectedly": context_shrank_unexpectedly,
                "tokens_near_limit": tokens_near_limit
            }
        }));

        previous_context = Some(ComparableContext {
            messages: message_set,
            variables: variables_for_next,
            context_tokens: span.context_tokens.unwrap_or_default(),
        });
    }
}

fn extract_context_messages(prompt_payload: Option<&Value>) -> Vec<Value> {
    let Some(payload) = prompt_payload.and_then(Value::as_object) else {
        return Vec::new();
    };

    for candidate in [
        payload.get("messages"),
        payload
            .get("payload")
            .and_then(Value::as_object)
            .and_then(|entry| entry.get("messages")),
        payload.get("input"),
        payload.get("prompt"),
    ] {
        if let Some(Value::Array(messages)) = candidate {
            return messages.clone();
        }
    }

    for candidate in [
        payload.get("prompt"),
        payload.get("input"),
        payload
            .get("payload")
            .and_then(Value::as_object)
            .and_then(|entry| entry.get("prompt")),
        payload
            .get("payload")
            .and_then(Value::as_object)
            .and_then(|entry| entry.get("input")),
    ] {
        if let Some(Value::String(prompt)) = candidate {
            return vec![json!({"role": "user", "content": prompt})];
        }
    }

    Vec::new()
}

fn extract_system_prompt(prompt_payload: Option<&Value>, messages: &[Value]) -> String {
    if let Some(payload) = prompt_payload.and_then(Value::as_object) {
        for candidate in [
            payload.get("system_prompt"),
            payload.get("system"),
            payload
                .get("payload")
                .and_then(Value::as_object)
                .and_then(|entry| entry.get("system_prompt")),
            payload
                .get("payload")
                .and_then(Value::as_object)
                .and_then(|entry| entry.get("system")),
        ] {
            if let Some(Value::String(system_prompt)) = candidate {
                return system_prompt.clone();
            }
        }
    }

    for message in messages {
        let Some(object) = message.as_object() else {
            continue;
        };
        if object.get("role").and_then(Value::as_str) != Some("system") {
            continue;
        }

        if let Some(content) = object.get("content") {
            return value_to_diff_string(content);
        }
    }

    String::new()
}

fn extract_context_variables(prompt_payload: Option<&Value>) -> Map<String, Value> {
    let Some(payload) = prompt_payload.and_then(Value::as_object) else {
        return Map::new();
    };

    for candidate in [
        payload.get("variables"),
        payload
            .get("payload")
            .and_then(Value::as_object)
            .and_then(|entry| entry.get("variables")),
    ] {
        if let Some(Value::Object(variables)) = candidate {
            return variables.clone();
        }
    }

    Map::new()
}

fn extract_tools_available(prompt_payload: Option<&Value>) -> Vec<Value> {
    let Some(payload) = prompt_payload.and_then(Value::as_object) else {
        return Vec::new();
    };

    for candidate in [
        payload.get("tools_available"),
        payload.get("tools"),
        payload
            .get("payload")
            .and_then(Value::as_object)
            .and_then(|entry| entry.get("tools_available")),
        payload
            .get("payload")
            .and_then(Value::as_object)
            .and_then(|entry| entry.get("tools")),
    ] {
        if let Some(Value::Array(items)) = candidate {
            return items.clone();
        }
    }

    Vec::new()
}

fn estimate_context_tokens(
    input_tokens: Option<i64>,
    messages: &[Value],
    system_prompt: &str,
    variables: &Map<String, Value>,
    tools_available: &[Value],
) -> i64 {
    if let Some(tokens) = input_tokens {
        return tokens;
    }

    let mut chars = system_prompt.chars().count();
    chars += messages
        .iter()
        .map(value_to_diff_string)
        .map(|value| value.chars().count())
        .sum::<usize>();
    chars += variables
        .iter()
        .map(|(key, value)| key.len() + value_to_diff_string(value).chars().count())
        .sum::<usize>();
    chars += tools_available
        .iter()
        .map(value_to_diff_string)
        .map(|value| value.chars().count())
        .sum::<usize>();

    if chars == 0 {
        return 0;
    }

    ((chars as f64) / 4.0).ceil() as i64
}

fn compute_context_usage_percent(
    context_tokens: Option<i64>,
    context_window: Option<i64>,
) -> Option<f64> {
    let tokens = context_tokens?;
    let window = context_window?;
    if window <= 0 {
        return None;
    }
    Some((tokens as f64 / window as f64) * 100.0)
}

fn compute_context_diff(
    previous: Option<&ComparableContext>,
    current_messages: &HashSet<String>,
    current_variables: &Map<String, Value>,
) -> Value {
    let Some(previous) = previous else {
        return json!({
            "added_messages": [],
            "removed_messages": [],
            "changed_variables": {
                "added": [],
                "removed": [],
                "changed": []
            }
        });
    };

    let mut added_messages = current_messages
        .difference(&previous.messages)
        .cloned()
        .collect::<Vec<_>>();
    added_messages.sort();

    let mut removed_messages = previous
        .messages
        .difference(current_messages)
        .cloned()
        .collect::<Vec<_>>();
    removed_messages.sort();

    let previous_keys = previous.variables.keys().cloned().collect::<HashSet<_>>();
    let current_keys = current_variables.keys().cloned().collect::<HashSet<_>>();

    let mut added_keys = current_keys
        .difference(&previous_keys)
        .cloned()
        .collect::<Vec<_>>();
    added_keys.sort();

    let mut removed_keys = previous_keys
        .difference(&current_keys)
        .cloned()
        .collect::<Vec<_>>();
    removed_keys.sort();

    let mut changed_keys = current_keys
        .intersection(&previous_keys)
        .filter(|key| previous.variables.get(*key) != current_variables.get(*key))
        .cloned()
        .collect::<Vec<_>>();
    changed_keys.sort();

    json!({
        "added_messages": added_messages,
        "removed_messages": removed_messages,
        "changed_variables": {
            "added": added_keys,
            "removed": removed_keys,
            "changed": changed_keys
        }
    })
}

fn detect_context_truncation(
    previous: Option<&ComparableContext>,
    context_tokens: i64,
    usage_percent: Option<f64>,
) -> (bool, bool) {
    let context_shrank_unexpectedly = previous.is_some_and(|prev| {
        prev.context_tokens > 0
            && context_tokens > 0
            && context_tokens < ((prev.context_tokens as f64) * 0.7) as i64
            && (prev.context_tokens - context_tokens) >= 200
    });
    let tokens_near_limit = usage_percent.is_some_and(|value| value >= 80.0);
    (context_shrank_unexpectedly, tokens_near_limit)
}

fn value_to_diff_string(value: &Value) -> String {
    match value {
        Value::String(raw) => raw.clone(),
        _ => value.to_string(),
    }
}

fn extract_instruction_sources(context_payload: Option<&Value>, system_prompt: &str) -> Vec<Value> {
    let mut sources = Vec::<Value>::new();

    if let Some(payload) = context_payload {
        let data = payload.get("data").unwrap_or(payload);
        if let Some(entries) = data.get("sources").and_then(Value::as_array) {
            for entry in entries {
                let Some(object) = entry.as_object() else {
                    continue;
                };

                let name = object
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown")
                    .to_string();
                let path = object
                    .get("path")
                    .and_then(Value::as_str)
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| name.clone());
                let content = object
                    .get("content")
                    .map(value_to_diff_string)
                    .unwrap_or_default();
                let provided_type = object
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or("local");
                let source_type = classify_instruction_type(provided_type, &name, &path);
                let hash = object
                    .get("hash")
                    .and_then(Value::as_str)
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| stable_hash_hex(&content));

                sources.push(json!({
                    "name": name,
                    "type": source_type,
                    "path": path,
                    "content": content,
                    "hash": hash
                }));
            }
        }
    }

    if !system_prompt.trim().is_empty() {
        sources.push(json!({
            "name": "system_prompt",
            "type": "runtime",
            "path": "runtime:system_prompt",
            "content": system_prompt,
            "hash": stable_hash_hex(system_prompt)
        }));
    }

    dedupe_instruction_sources(sources)
}

fn classify_instruction_type(source_type: &str, name: &str, path: &str) -> &'static str {
    if source_type == "runtime" {
        return "runtime";
    }
    let upper_name = name.to_uppercase();
    let upper_path = path.to_uppercase();
    if upper_name.contains("CLAUDE.MD") || upper_path.contains("CLAUDE.MD") {
        return "global";
    }
    if upper_name.contains("AGENTS.MD") || upper_path.contains("AGENTS.MD") {
        return "local";
    }
    "local"
}

fn dedupe_instruction_sources(sources: Vec<Value>) -> Vec<Value> {
    let mut seen = HashSet::<String>::new();
    let mut deduped = Vec::new();
    for source in sources {
        let object = source.as_object().cloned().unwrap_or_default();
        let key = format!(
            "{}:{}:{}",
            object.get("type").and_then(Value::as_str).unwrap_or(""),
            object.get("path").and_then(Value::as_str).unwrap_or(""),
            object.get("hash").and_then(Value::as_str).unwrap_or("")
        );
        if seen.insert(key) {
            deduped.push(Value::Object(object));
        }
    }
    deduped
}

fn compute_instruction_precedence_stack(sources: &[Value]) -> Vec<Value> {
    let mut ranked = sources
        .iter()
        .cloned()
        .map(|source| {
            let rank = source
                .get("type")
                .and_then(Value::as_str)
                .map(instruction_precedence_rank)
                .unwrap_or(0);
            (rank, source)
        })
        .collect::<Vec<_>>();
    ranked.sort_by(|(left, _), (right, _)| right.cmp(left));
    ranked.into_iter().map(|(_, source)| source).collect()
}

fn instruction_precedence_rank(source_type: &str) -> i32 {
    match source_type {
        "runtime" => 3,
        "local" => 2,
        "global" => 1,
        _ => 0,
    }
}

fn stable_hash_hex(value: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    value.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
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

fn sync_run_metrics_from_spans(run: &mut Run, spans: &[Span]) {
    let mut sum_input = 0_i64;
    let mut sum_output = 0_i64;
    let mut sum_total = 0_i64;
    let mut sum_cost = 0.0_f64;

    for span in spans {
        sum_input += span.input_tokens.unwrap_or(0).max(0);
        sum_output += span.output_tokens.unwrap_or(0).max(0);
        sum_total += span.total_tokens.unwrap_or(0).max(0);
        sum_cost += span.estimated_cost.unwrap_or(0.0).max(0.0);
    }

    run.total_input_tokens = run.total_input_tokens.max(sum_input);
    run.total_output_tokens = run.total_output_tokens.max(sum_output);
    run.total_tokens = run.total_tokens.max(sum_total);
    run.total_cost_usd = run.total_cost_usd.max(sum_cost);
}

fn normalize_error_type(value: String) -> String {
    let raw = value.trim().to_lowercase();
    if raw.is_empty() {
        return "unknown".to_string();
    }

    // Preserve SDK-provided semantic labels instead of collapsing everything to "unknown".
    // This keeps issue grouping useful (for example: schema_missing_field, context_overflow).
    match raw.as_str() {
        "invalid_json" => "invalid_json".to_string(),
        "rate_limit" => "rate_limit".to_string(),
        "timeout" => "timeout".to_string(),
        "tool_error" => "tool_error".to_string(),
        "system_error" => "system_error".to_string(),
        _ => {
            let normalized = raw
                .chars()
                .map(|ch| match ch {
                    'a'..='z' | '0'..='9' => ch,
                    ':' | '-' | ' ' | '/' | '.' => '_',
                    _ => '_',
                })
                .collect::<String>()
                .trim_matches('_')
                .to_string();
            if normalized.is_empty() {
                "unknown".to_string()
            } else {
                normalized
            }
        }
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

#[derive(Debug, Deserialize)]
struct ProjectTrendsQuery {
    start: Option<String>,
    end: Option<String>,
    baseline_start: Option<String>,
    baseline_end: Option<String>,
    status: Option<String>,
    model: Option<String>,
    agent_name: Option<String>,
    variant: Option<String>,
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
    let mut spans = state.storage.get_spans(&id).await?;
    let artifacts = state.storage.get_artifacts(&id).await?;
    let detections = analysis::detectors::detect_failure_types(&spans, &artifacts);
    let transitions = analysis::step_transition::build_step_transitions_with_causes(
        &spans,
        &artifacts,
        &detections,
    );
    for span in &mut spans {
        span.step_transition = transitions.get(&span.id).cloned();
    }
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

async fn get_run_explanation(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<RunExplanation>, ApiError> {
    ensure_run_access(&state, &id, &user.id).await?;

    if let Some(existing) = state.storage.get_run_explanation(&id).await? {
        return Ok(Json(existing));
    }

    let run = state
        .storage
        .get_run(&id)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("run {id} not found")))?;
    let insights = match state.storage.get_run_insights(&id).await? {
        existing if existing.is_empty() => {
            analysis::run_insights_engine::analyze_run(&state.storage, &id).await?
        }
        existing => existing,
    };

    let explanation = analysis::llm_explanations::explain_run_insights(&run, &insights);
    state.storage.upsert_run_explanation(&explanation).await?;
    Ok(Json(explanation))
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

async fn get_project_issues(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Query(query): Query<ProjectIssuesQuery>,
) -> Result<Json<Vec<ProjectIssueResponse>>, ApiError> {
    ensure_project_access(&state, &id, &user.id).await?;

    let limit = query.limit.unwrap_or(20).clamp(1, 20);
    let rows = state.storage.list_project_issues(&id, limit).await?;

    let issues = rows
        .into_iter()
        .map(|row| ProjectIssueResponse {
            issue_key: row.issue_key,
            category: row.category,
            subcategory: row.subcategory,
            frequency: row.frequency,
            cost_impact: row.cost_impact,
            priority_score: row.priority_score,
            summary: row.summary,
            root_cause: row.root_cause,
            recommended_fix: row.recommended_fix,
            expected_impact: row.expected_impact,
            confidence_score: row.confidence_score,
            last_seen: row.last_seen,
        })
        .collect::<Vec<_>>();

    Ok(Json(issues))
}

async fn mark_issue_fixed(
    Path((project_id, issue_key)): Path<(String, String)>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<StatusCode, ApiError> {
    ensure_project_access(&state, &project_id, &user.id).await?;
    state
        .storage
        .mark_issue_fixed(&project_id, &issue_key, Some(&user.id))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_issue_impact(
    Path((project_id, issue_key)): Path<(String, String)>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<Option<IssueImpactResponse>>, ApiError> {
    ensure_project_access(&state, &project_id, &user.id).await?;

    let response = match state
        .storage
        .compute_issue_impact(&project_id, &issue_key)
        .await?
    {
        IssueImpactComputation::NoFix => None,
        IssueImpactComputation::Processing => {
            Some(IssueImpactResponse::Processing("processing".to_string()))
        }
        IssueImpactComputation::Ready(impact) => Some(IssueImpactResponse::Impact(impact)),
    };

    Ok(Json(response))
}

async fn get_project_regressions(
    Path(project_id): Path<String>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<ProjectIssueRegressionRow>>, ApiError> {
    ensure_project_access(&state, &project_id, &user.id).await?;
    let regressions = state.storage.list_project_regressions(&project_id).await?;
    Ok(Json(regressions))
}

async fn get_project_weekly_report(
    Path(project_id): Path<String>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<Option<WeeklyReportRecord>>, ApiError> {
    ensure_project_access(&state, &project_id, &user.id).await?;
    let report = state.storage.get_latest_weekly_report(&project_id).await?;
    Ok(Json(report))
}

async fn trigger_project_weekly_report(
    Path(project_id): Path<String>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(payload): Json<WeeklyReportTriggerRequest>,
) -> Result<Json<Option<WeeklyReportRecord>>, ApiError> {
    ensure_project_access(&state, &project_id, &user.id).await?;
    ensure_project_manage_permission(&user)?;

    let (week_start, week_end) = resolve_week_window(payload.week_start.as_deref(), payload.week_end.as_deref())?;
    state.storage.aggregate_project_usage_daily().await?;
    generate_weekly_report_for_project(&state.storage, &project_id, week_start, week_end).await?;
    let report = state.storage.get_latest_weekly_report(&project_id).await?;
    Ok(Json(report))
}

fn resolve_week_window(
    week_start: Option<&str>,
    week_end: Option<&str>,
) -> Result<(NaiveDate, NaiveDate), ApiError> {
    match (week_start, week_end) {
        (Some(start), Some(end)) => {
            let parsed_start = NaiveDate::parse_from_str(start, "%Y-%m-%d").map_err(|_| {
                ApiError::Validation("week_start must be YYYY-MM-DD".to_string())
            })?;
            let parsed_end = NaiveDate::parse_from_str(end, "%Y-%m-%d")
                .map_err(|_| ApiError::Validation("week_end must be YYYY-MM-DD".to_string()))?;
            if parsed_end < parsed_start {
                return Err(ApiError::Validation(
                    "week_end must be on or after week_start".to_string(),
                ));
            }
            Ok((parsed_start, parsed_end))
        }
        (None, None) => {
            let week_end = Utc::now().date_naive() - chrono::Duration::days(1);
            let week_start = week_end - chrono::Duration::days(6);
            Ok((week_start, week_end))
        }
        _ => Err(ApiError::Validation(
            "both week_start and week_end are required when specifying window".to_string(),
        )),
    }
}

async fn generate_weekly_report_for_project(
    storage: &Storage,
    project_id: &str,
    week_start: NaiveDate,
    week_end: NaiveDate,
) -> Result<(), ApiError> {
    let split_date = week_start + chrono::Duration::days(3);

    let usage = sqlx::query_as::<_, WeekUsageAggRow>(
        r#"
        SELECT
            COALESCE(SUM(run_count), 0)::bigint AS total_runs,
            COALESCE(SUM(CASE WHEN date <= $2 THEN run_count ELSE 0 END), 0)::bigint AS before_runs,
            COALESCE(SUM(CASE WHEN date <= $2 THEN error_count ELSE 0 END), 0)::bigint AS before_errors,
            COALESCE(SUM(CASE WHEN date > $2 THEN run_count ELSE 0 END), 0)::bigint AS after_runs,
            COALESCE(SUM(CASE WHEN date > $2 THEN error_count ELSE 0 END), 0)::bigint AS after_errors
        FROM project_usage_daily
        WHERE project_id = $1::uuid
          AND date >= $3
          AND date <= $4
        "#,
    )
    .bind(project_id)
    .bind(split_date)
    .bind(week_start)
    .bind(week_end)
    .fetch_one(&storage.pool)
    .await
    .map_err(|error| {
        ApiError::Storage(format!(
            "failed to aggregate weekly usage for project {project_id} window {week_start}..{week_end}: {error}"
        ))
    })?;

    let costs = sqlx::query_as::<_, WeekCostAggRow>(
        r#"
        SELECT
            COALESCE(SUM(CASE WHEN date <= $2 THEN failed_run_cost_usd ELSE 0 END), 0)::double precision AS cost_before,
            COALESCE(SUM(CASE WHEN date > $2 THEN failed_run_cost_usd ELSE 0 END), 0)::double precision AS cost_after
        FROM failure_metrics_daily
        WHERE project_id = $1::uuid
          AND date >= $3
          AND date <= $4
        "#,
    )
    .bind(project_id)
    .bind(split_date)
    .bind(week_start)
    .bind(week_end)
    .fetch_one(&storage.pool)
    .await
    .map_err(|error| {
        ApiError::Storage(format!(
            "failed to aggregate weekly failure costs for project {project_id} window {week_start}..{week_end}: {error}"
        ))
    })?;

    let failure_rate_before = if usage.before_runs > 0 {
        usage.before_errors as f64 / usage.before_runs as f64
    } else {
        0.0
    };
    let failure_rate_after = if usage.after_runs > 0 {
        usage.after_errors as f64 / usage.after_runs as f64
    } else {
        0.0
    };

    let week_end_exclusive = week_end + chrono::Duration::days(1);

    let top_issues = sqlx::query_as::<_, WeeklyTopIssueRow>(
        r#"
        SELECT issue_key, MAX(priority_score)::double precision AS priority_score
        FROM issue_rankings
        WHERE project_id = $1::uuid
          AND date >= $2
          AND date <= $3
        GROUP BY issue_key
        ORDER BY MAX(priority_score) DESC, issue_key ASC
        LIMIT 10
        "#,
    )
    .bind(project_id)
    .bind(week_start)
    .bind(week_end)
    .fetch_all(&storage.pool)
    .await
    .map_err(|error| {
        ApiError::Storage(format!(
            "failed to fetch top weekly issues for project {project_id}: {error}"
        ))
    })?;

    let fixed_issues = sqlx::query_as::<_, WeeklyFixedIssueRow>(
        r#"
        SELECT issue_key, fixed_at, auto_detected, detection_confidence
        FROM issue_fixes
        WHERE project_id = $1::uuid
          AND fixed_at >= $2::date
          AND fixed_at < $3::date
        ORDER BY fixed_at DESC
        LIMIT 10
        "#,
    )
    .bind(project_id)
    .bind(week_start)
    .bind(week_end_exclusive)
    .fetch_all(&storage.pool)
    .await
    .map_err(|error| {
        ApiError::Storage(format!(
            "failed to fetch fixed issues for project {project_id}: {error}"
        ))
    })?;

    let regressions = sqlx::query_as::<_, WeeklyRegressionRow>(
        r#"
        SELECT issue_key, detected_at, regression_severity
        FROM issue_regressions
        WHERE project_id = $1::uuid
          AND detected_at >= $2::date
          AND detected_at < $3::date
        ORDER BY detected_at DESC
        LIMIT 10
        "#,
    )
    .bind(project_id)
    .bind(week_start)
    .bind(week_end_exclusive)
    .fetch_all(&storage.pool)
    .await
    .map_err(|error| {
        ApiError::Storage(format!(
            "failed to fetch regressions for project {project_id}: {error}"
        ))
    })?;

    let failure_change = failure_rate_after - failure_rate_before;
    let cost_change = costs.cost_after - costs.cost_before;
    let improvement_summary = format!(
        "Failure rate changed by {:+.2}% and failed-run cost changed by {:+.2} USD over the selected week.",
        failure_change * 100.0,
        cost_change
    );

    let report_json = json!({
        "summary": {
            "failure_change": failure_change,
            "cost_change": cost_change,
            "total_runs": usage.total_runs,
        },
        "top_fixed_issues": fixed_issues.iter().map(|row| {
            json!({
                "issue_key": row.issue_key,
                "fixed_at": row.fixed_at,
                "auto_detected": row.auto_detected,
                "detection_confidence": row.detection_confidence,
            })
        }).collect::<Vec<_>>(),
        "regressions": regressions.iter().map(|row| {
            json!({
                "issue_key": row.issue_key,
                "detected_at": row.detected_at,
                "regression_severity": row.regression_severity,
            })
        }).collect::<Vec<_>>(),
        "top_issues": top_issues.iter().map(|row| {
            json!({
                "issue_key": row.issue_key,
                "priority_score": row.priority_score,
            })
        }).collect::<Vec<_>>(),
    });

    storage
        .upsert_weekly_report(agentscope_storage::weekly_reports::UpsertWeeklyReportInput {
            project_id: project_id.to_string(),
            week_start,
            week_end,
            total_runs: usage.total_runs.min(i32::MAX as i64) as i32,
            failure_rate_before,
            failure_rate_after,
            cost_before: costs.cost_before,
            cost_after: costs.cost_after,
            improvement_summary,
            report_json,
        })
        .await?;

    Ok(())
}

async fn get_project_trends(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Query(query): Query<ProjectTrendsQuery>,
) -> Result<Json<TrendReport>, ApiError> {
    ensure_project_access(&state, &id, &user.id).await?;

    let end = parse_timestamp(query.end.as_deref(), "end")?.unwrap_or_else(Utc::now);
    let start = parse_timestamp(query.start.as_deref(), "start")?
        .unwrap_or_else(|| end - Duration::hours(24));
    if start >= end {
        return Err(ApiError::Validation(
            "start must be earlier than end".to_string(),
        ));
    }

    let window = end.signed_duration_since(start);
    let baseline_end =
        parse_timestamp(query.baseline_end.as_deref(), "baseline_end")?.unwrap_or(start);
    let baseline_start = parse_timestamp(query.baseline_start.as_deref(), "baseline_start")?
        .unwrap_or_else(|| baseline_end - window);
    if baseline_start >= baseline_end {
        return Err(ApiError::Validation(
            "baseline_start must be earlier than baseline_end".to_string(),
        ));
    }

    let report = analysis::trend_analysis::analyze_trends(
        &state.storage,
        analysis::trend_analysis::TrendQuery {
            project_id: id,
            start,
            end,
            baseline_start,
            baseline_end,
            filters: TrendRunFilters {
                status: query.status,
                model: query.model,
                agent_name: query.agent_name,
                variant: query.variant,
            },
        },
    )
    .await?;

    Ok(Json(report))
}

async fn get_project_active_alerts(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<ActiveAlert>>, ApiError> {
    ensure_project_access(&state, &id, &user.id).await?;
    let alerts = match state.storage.get_active_alerts(&id).await? {
        existing if existing.is_empty() => {
            analysis::insights_engine::analyze_project(&state.storage, &id).await?;
            state.storage.get_active_alerts(&id).await?
        }
        existing => existing,
    };
    Ok(Json(alerts))
}

async fn get_project_alert_events(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<agentscope_storage::alerts::ProjectAlertEvent>>, ApiError> {
    ensure_project_access(&state, &id, &user.id).await?;
    Ok(Json(state.storage.list_project_alert_events(&id, 100).await?))
}

async fn get_project_failure_clusters(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<FailureCluster>>, ApiError> {
    ensure_project_access(&state, &id, &user.id).await?;
    let clusters = match state.storage.get_failure_clusters(&id).await? {
        existing if existing.is_empty() => {
            analysis::insights_engine::analyze_project(&state.storage, &id).await?;
            state.storage.get_failure_clusters(&id).await?
        }
        existing => existing,
    };
    Ok(Json(clusters))
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

async fn get_project_billing(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<BillingResponse>, ApiError> {
    ensure_project_access(&state, &id, &user.id).await?;
    let billing = state
        .storage
        .get_billing_overview_for_project(&id)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("project {id} not found")))?;
    Ok(Json(BillingResponse {
        plan: billing.plan,
        status: billing.status,
        runs_used: billing.runs_used,
        run_limit: billing.run_limit,
    }))
}

async fn create_billing_checkout_session(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(payload): Json<CreateCheckoutSessionRequest>,
) -> Result<Json<CreateCheckoutSessionResponse>, ApiError> {
    ensure_project_access(&state, &id, &user.id).await?;
    ensure_project_manage_permission(&user)?;

    let organization_id = state
        .storage
        .get_organization_id_for_project(&id)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("project {id} not found")))?;
    let subscription = ensure_subscription_record(&state, &organization_id).await?;
    let customer_id = if let Some(customer_id) = subscription.stripe_customer_id {
        customer_id
    } else {
        let created = state
            .billing_provider
            .create_customer(&user.email, Some(&organization_id))
            .await?;
        state
            .storage
            .set_subscription_customer_id(&organization_id, &created)
            .await?;
        created
    };

    let checkout_url = state
        .billing_provider
        .create_checkout_session(
            &customer_id,
            &organization_id,
            &payload.success_url,
            &payload.cancel_url,
        )
        .await?;
    Ok(Json(CreateCheckoutSessionResponse { checkout_url }))
}

async fn stripe_webhook(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    body: Bytes,
) -> Result<StatusCode, ApiError> {
    let update = state
        .billing_provider
        .parse_subscription_update(&headers, &body)?;
    let Some(update) = update else {
        return Ok(StatusCode::OK);
    };

    if let Some(existing) = state
        .storage
        .get_subscription_by_stripe_subscription_id(&update.stripe_subscription_id)
        .await?
    {
        state
            .storage
            .upsert_subscription(
                &existing.organization_id,
                &update.plan,
                &update.status,
                update
                    .stripe_customer_id
                    .as_deref()
                    .or(existing.stripe_customer_id.as_deref()),
                Some(&update.stripe_subscription_id),
                update.current_period_start,
                update.current_period_end,
            )
            .await?;
    } else if let Some(organization_id) = update.organization_id {
        state
            .storage
            .upsert_subscription(
                &organization_id,
                &update.plan,
                &update.status,
                update.stripe_customer_id.as_deref(),
                Some(&update.stripe_subscription_id),
                update.current_period_start,
                update.current_period_end,
            )
            .await?;
    }

    Ok(StatusCode::OK)
}

async fn get_project_storage_settings(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<ProjectStorageSettings>, ApiError> {
    ensure_project_access(&state, &id, &user.id).await?;
    let settings = state.storage.get_project_storage_settings(&id).await?;
    Ok(Json(settings))
}

async fn update_project_storage_settings(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(payload): Json<UpdateStorageSettingsRequest>,
) -> Result<Json<ProjectStorageSettings>, ApiError> {
    ensure_project_access(&state, &id, &user.id).await?;
    ensure_project_manage_permission(&user)?;
    let current_settings = state.storage.get_project_storage_settings(&id).await?;

    if payload.cleanup_mode != "soft_delete" && payload.cleanup_mode != "hard_delete" {
        return Err(ApiError::Validation(
            "cleanup_mode must be soft_delete or hard_delete".to_string(),
        ));
    }

    if let Some(retention_days) = payload.retention_days {
        if retention_days < 1 {
            return Err(ApiError::Validation(
                "retention_days must be >= 1 or null".to_string(),
            ));
        }
    }

    let settings = state
        .storage
        .upsert_project_storage_settings(
            &id,
            payload.retention_days,
            payload.store_prompts_responses,
            payload.compress_old_runs,
            payload
                .redact_sensitive_data
                .unwrap_or(current_settings.redact_sensitive_data),
            payload
                .require_authentication
                .unwrap_or(current_settings.require_authentication),
            &payload.cleanup_mode,
        )
        .await?;
    Ok(Json(settings))
}

async fn apply_project_retention(
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<RetentionApplyResult>, ApiError> {
    ensure_project_access(&state, &id, &user.id).await?;
    ensure_project_manage_permission(&user)?;
    let result = state.storage.apply_project_retention(&id).await?;
    Ok(Json(result))
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
    ensure_org_admin_access(&state, &org_id, &user).await?;
    let email = validate_and_normalize_email(&payload.email)?;
    let role = normalize_team_role(&payload.role)?;
    let invite = state
        .storage
        .create_invite(&org_id, &email, role, None)
        .await?;
    Ok(Json(invite))
}

async fn create_project_invite(
    Path(project_id): Path<String>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(payload): Json<CreateInviteRequest>,
) -> Result<Json<agentscope_storage::team::InviteRecord>, ApiError> {
    let org_id = ensure_project_admin_access(&state, &project_id, &user).await?;
    let email = validate_and_normalize_email(&payload.email)?;
    let role = normalize_team_role(&payload.role)?;
    let invite = state
        .storage
        .create_invite(&org_id, &email, role, Some(&project_id))
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

async fn list_org_pending_invites(
    Path(org_id): Path<String>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<agentscope_storage::team::InviteRecord>>, ApiError> {
    ensure_org_admin_access(&state, &org_id, &user).await?;
    let invites = state.storage.list_org_pending_invites(&org_id).await?;
    Ok(Json(invites))
}

async fn list_project_pending_invites(
    Path(project_id): Path<String>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<agentscope_storage::team::InviteRecord>>, ApiError> {
    let org_id = ensure_project_admin_access(&state, &project_id, &user).await?;
    let invites = state.storage.list_org_pending_invites(&org_id).await?;
    Ok(Json(invites))
}

async fn resend_org_invite(
    Path((org_id, invite_id)): Path<(String, String)>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<agentscope_storage::team::InviteRecord>, ApiError> {
    ensure_org_admin_access(&state, &org_id, &user).await?;
    let invite = state
        .storage
        .resend_org_invite(&org_id, &invite_id)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("pending invite {invite_id} not found")))?;
    Ok(Json(invite))
}

async fn resend_project_invite(
    Path((project_id, invite_id)): Path<(String, String)>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<agentscope_storage::team::InviteRecord>, ApiError> {
    let org_id = ensure_project_admin_access(&state, &project_id, &user).await?;
    let invite = state
        .storage
        .resend_org_invite(&org_id, &invite_id)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("pending invite {invite_id} not found")))?;
    Ok(Json(invite))
}

async fn cancel_org_invite(
    Path((org_id, invite_id)): Path<(String, String)>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<StatusCode, ApiError> {
    ensure_org_admin_access(&state, &org_id, &user).await?;
    if !state.storage.cancel_org_invite(&org_id, &invite_id).await? {
        return Err(ApiError::NotFound(format!(
            "pending invite {invite_id} not found"
        )));
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn cancel_project_invite(
    Path((project_id, invite_id)): Path<(String, String)>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<StatusCode, ApiError> {
    let org_id = ensure_project_admin_access(&state, &project_id, &user).await?;
    if !state.storage.cancel_org_invite(&org_id, &invite_id).await? {
        return Err(ApiError::NotFound(format!(
            "pending invite {invite_id} not found"
        )));
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
    ensure_org_admin_access(&state, &org_id, &user).await?;
    if !state.storage.remove_org_member(&org_id, &user_id).await? {
        return Err(ApiError::NotFound(format!(
            "member {user_id} not found in organization {org_id}"
        )));
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn update_org_member_role(
    Path((org_id, user_id)): Path<(String, String)>,
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(payload): Json<UpdateMemberRoleRequest>,
) -> Result<StatusCode, ApiError> {
    ensure_org_admin_access(&state, &org_id, &user).await?;
    let role = normalize_team_role(&payload.role)?;
    if !state
        .storage
        .update_org_member_role(&org_id, &user_id, role)
        .await?
    {
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

fn ensure_project_manage_permission(user: &AuthenticatedUser) -> Result<(), ApiError> {
    if user
        .permissions
        .iter()
        .any(|permission| permission == Permission::ProjectManage.as_str())
    {
        return Ok(());
    }

    Err(ApiError::Forbidden(
        "project changes require project:manage permission".to_string(),
    ))
}

async fn apply_project_storage_policies(
    state: &Arc<AppState>,
    payload: &mut IngestPayload,
) -> Result<(), ApiError> {
    let settings = state
        .storage
        .get_project_storage_settings(&payload.run.project_id)
        .await?;
    if settings.store_prompts_responses && !settings.redact_sensitive_data {
        return Ok(());
    }

    for artifact in &mut payload.artifacts {
        if should_redact_artifact_payload(&artifact.kind) {
            artifact.payload = serde_json::json!({
                "redacted": true,
                "reason": if settings.store_prompts_responses {
                    "redact_sensitive_data_enabled"
                } else {
                    "store_prompts_responses_disabled"
                },
            });
        }
    }

    Ok(())
}

fn should_redact_artifact_payload(kind: &str) -> bool {
    let kind = kind.to_lowercase();
    kind.contains("prompt") || kind.contains("response")
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

async fn ensure_org_admin_access(
    state: &Arc<AppState>,
    organization_id: &str,
    user: &AuthenticatedUser,
) -> Result<(), ApiError> {
    let role = state
        .storage
        .get_role_for_organization(&user.id, organization_id)
        .await?;
    let can_manage = matches!(role.as_deref(), Some("admin") | Some("owner"));
    if !can_manage {
        return Err(ApiError::Forbidden(
            "organization user management requires admin role".to_string(),
        ));
    }
    Ok(())
}

async fn ensure_project_admin_access(
    state: &Arc<AppState>,
    project_id: &str,
    user: &AuthenticatedUser,
) -> Result<String, ApiError> {
    ensure_project_access(state, project_id, &user.id).await?;
    let org_id = state
        .storage
        .get_project_organization_id(project_id)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("project {project_id} not found")))?;
    ensure_org_admin_access(state, &org_id, user).await?;
    Ok(org_id)
}

fn normalize_team_role(role: &str) -> Result<&'static str, ApiError> {
    match role.trim().to_lowercase().as_str() {
        "admin" => Ok("admin"),
        "member" => Ok("member"),
        _ => Err(ApiError::Validation(
            "role must be one of admin or member".to_string(),
        )),
    }
}

fn validate_and_normalize_email(email: &str) -> Result<String, ApiError> {
    let normalized = email.trim().to_lowercase();
    if !is_valid_email(&normalized) {
        return Err(ApiError::Validation(
            "email must be a valid email address".to_string(),
        ));
    }
    Ok(normalized)
}

fn is_valid_email(email: &str) -> bool {
    if email.is_empty() || email.len() > 254 || email.contains(char::is_whitespace) {
        return false;
    }
    let mut parts = email.split('@');
    let local = parts.next().unwrap_or_default();
    let domain = parts.next().unwrap_or_default();
    if parts.next().is_some() || local.is_empty() || domain.is_empty() {
        return false;
    }
    if domain.starts_with('.') || domain.ends_with('.') || !domain.contains('.') {
        return false;
    }
    true
}

async fn ensure_subscription_record(
    state: &Arc<AppState>,
    organization_id: &str,
) -> Result<agentscope_storage::billing::Subscription, ApiError> {
    if let Some(subscription) = state
        .storage
        .get_subscription_by_organization(organization_id)
        .await?
    {
        return Ok(subscription);
    }
    Ok(state
        .storage
        .ensure_free_subscription(organization_id)
        .await?)
}

pub enum ApiError {
    Validation(String),
    NotFound(String),
    Unauthorized(String),
    Forbidden(String),
    PaymentRequired(String),
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
            Self::PaymentRequired(message) => {
                (StatusCode::PAYMENT_REQUIRED, message).into_response()
            }
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
