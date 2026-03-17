use std::sync::Arc;

use agentscope_storage::auth::{
    generate_session_token, AuthUser, MembershipRecord, OnboardingState, RegisteredAccount,
};
use axum::{
    extract::{Path, Query, Request, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    middleware::Next,
    response::{IntoResponse, Redirect, Response},
    Json,
};
use chrono::{Duration, Utc};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{ApiError, AppState};

pub mod api_key;
pub mod permissions;

use self::{
    api_key::API_KEY_HEADER,
    permissions::{role_permissions, Permission},
};

pub const SESSION_COOKIE_NAME: &str = "agentscope_session";
const OAUTH_STATE_COOKIE_NAME: &str = "agentscope_oauth_state";

#[derive(Debug, Clone)]
pub struct JwtSettings {
    pub secret: String,
    pub expiry_seconds: i64,
    pub cookie_name: String,
    pub secure_cookies: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuthenticatedUser {
    pub id: String,
    pub email: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub memberships: Vec<MembershipRecord>,
    pub permissions: Vec<String>,
    pub is_admin: bool,
}

#[derive(Debug, Clone)]
pub struct ProjectApiKeyAuth {
    pub key_id: String,
    pub project_id: String,
    pub organization_id: String,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    pub password: String,
    pub display_name: Option<String>,
    pub organization_name: Option<String>,
    pub project_name: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub token: String,
    pub expires_at: String,
    pub user: AuthUser,
    pub onboarding: OnboardingState,
}

#[derive(Debug, Serialize)]
pub struct RegisterResponse {
    pub token: String,
    pub expires_at: String,
    pub user: AuthUser,
    pub organization: RegisteredOrganization,
    pub project: RegisteredProject,
    pub api_key: String,
    pub onboarding: OnboardingState,
}

#[derive(Debug, Serialize)]
pub struct RegisteredOrganization {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct RegisteredProject {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct MeResponse {
    pub user: AuthenticatedUser,
    pub onboarding: OnboardingState,
}

#[derive(Debug, Deserialize)]
pub struct AccessTokenQuery {
    access_token: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct OAuthCallbackQuery {
    code: String,
    state: String,
    next: Option<String>,
}

#[derive(Debug, Serialize)]
struct OAuthUserInfo {
    provider_user_id: String,
    email: String,
    name: Option<String>,
    avatar_url: Option<String>,
    access_token: String,
    refresh_token: Option<String>,
    expires_at: Option<chrono::DateTime<Utc>>,
}

pub async fn login(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<LoginRequest>,
) -> Result<Response, ApiError> {
    if payload.email.trim().is_empty() || payload.password.is_empty() {
        return Err(ApiError::Validation(
            "email and password are required".to_string(),
        ));
    }

    let user = state
        .storage
        .authenticate_user(&payload.email, &payload.password)
        .await?
        .ok_or_else(|| ApiError::Forbidden("invalid login credentials".to_string()))?;

    let session = create_user_session(&state, &headers, &user.id, None).await?;
    let onboarding = state
        .storage
        .get_onboarding_state(&user.id, Some(&session.session_token))
        .await?;

    Ok(json_with_session_cookie(
        &state.jwt,
        &session.session_token,
        login_response(user, &session, onboarding),
    ))
}

pub async fn register(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<RegisterRequest>,
) -> Result<Response, ApiError> {
    let email = payload.email.trim();
    let password = payload.password;
    let display_name = payload
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let organization_name = payload
        .organization_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("My Organization");
    let project_name = payload
        .project_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Default Project");

    if email.is_empty() || password.is_empty() {
        return Err(ApiError::Validation(
            "email and password are required".to_string(),
        ));
    }

    let account = state
        .storage
        .register_account(email, &password, display_name, organization_name, project_name)
        .await?;

    let session =
        create_user_session(&state, &headers, &account.user.id, Some(account.api_key.as_str()))
            .await?;
    let onboarding = state
        .storage
        .get_onboarding_state(&account.user.id, Some(&session.session_token))
        .await?;

    Ok(json_with_session_cookie(
        &state.jwt,
        &session.session_token,
        register_response(account, &session, onboarding),
    ))
}

pub async fn logout(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    if let Some(token) = session_token_from_headers(&headers, &state.jwt.cookie_name) {
        state.storage.delete_session(&token).await?;
    }

    let response = (StatusCode::NO_CONTENT, "").into_response();
    Ok(with_cookie_header(
        response,
        clear_cookie_header(&state.jwt),
    ))
}

pub async fn me(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<MeResponse>, ApiError> {
    let token = session_token_from_headers(&headers, &state.jwt.cookie_name)
        .ok_or_else(|| ApiError::Unauthorized("missing session".to_string()))?;
    let session = state
        .storage
        .get_session(&token)
        .await?
        .ok_or_else(|| ApiError::Unauthorized("invalid session".to_string()))?;
    let user = build_authenticated_user(&state, &session.user_id).await?;
    let onboarding = state
        .storage
        .get_onboarding_state(&session.user_id, Some(&token))
        .await?;
    Ok(Json(MeResponse { user, onboarding }))
}

pub async fn oauth_start(
    Path(provider): Path<String>,
    State(state): State<Arc<AppState>>,
) -> Result<Response, ApiError> {
    let provider_config = load_oauth_provider(&state, &provider).await?;
    let state_token = format!("oauth_{}", Uuid::new_v4().simple());
    let authorize_url = match provider.as_str() {
        "google" => format!(
            "https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id={}&redirect_uri={}&scope=openid%20email%20profile&state={}",
            urlencoding::encode(&provider_config.client_id),
            urlencoding::encode(&provider_config.redirect_uri),
            urlencoding::encode(&state_token),
        ),
        "github" => format!(
            "https://github.com/login/oauth/authorize?client_id={}&redirect_uri={}&scope=read:user%20user:email&state={}",
            urlencoding::encode(&provider_config.client_id),
            urlencoding::encode(&provider_config.redirect_uri),
            urlencoding::encode(&state_token),
        ),
        _ => {
            return Err(ApiError::Validation(format!(
                "unsupported oauth provider {provider}"
            )))
        }
    };

    let response = Redirect::temporary(&authorize_url).into_response();
    Ok(with_cookie_header(
        response,
        oauth_state_cookie(&state.jwt, &state_token),
    ))
}

pub async fn oauth_callback(
    Path(provider): Path<String>,
    Query(query): Query<OAuthCallbackQuery>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let expected_state = cookie_value_from_headers(&headers, OAUTH_STATE_COOKIE_NAME)
        .ok_or_else(|| ApiError::Forbidden("missing oauth state".to_string()))?;
    if expected_state != query.state {
        return Err(ApiError::Forbidden("invalid oauth state".to_string()));
    }

    let provider_config = load_oauth_provider(&state, &provider).await?;
    let oauth_user = exchange_oauth_code(&provider, &provider_config, &query.code).await?;

    let linked_user_id = if let Some(identity) = state
        .storage
        .find_identity(&provider, &oauth_user.provider_user_id)
        .await?
    {
        identity.user_id
    } else if let Some(existing_user) = state.storage.find_user_by_email(&oauth_user.email).await? {
        state
            .storage
            .upsert_identity(
                &existing_user.id,
                &provider,
                &oauth_user.provider_user_id,
                Some(&oauth_user.access_token),
                oauth_user.refresh_token.as_deref(),
                oauth_user.expires_at,
            )
            .await?;
        existing_user.id
    } else {
        let user = state
            .storage
            .create_user(
                &oauth_user.email,
                oauth_user.name.as_deref(),
                oauth_user.avatar_url.as_deref(),
            )
            .await?;
        state
            .storage
            .upsert_identity(
                &user.id,
                &provider,
                &oauth_user.provider_user_id,
                Some(&oauth_user.access_token),
                oauth_user.refresh_token.as_deref(),
                oauth_user.expires_at,
            )
            .await?;
        let bootstrap = state
            .storage
            .ensure_default_workspace(&user.id, "My Organization", "Default Project")
            .await?;
        let session =
            create_user_session(&state, &headers, &user.id, Some(bootstrap.api_key.as_str()))
                .await?;
        let redirect_to = query.next.as_deref().unwrap_or("/onboarding");
        let response = Redirect::temporary(redirect_to).into_response();
        return Ok(with_cookie_header(
            with_cookie_header(response, session_cookie_header(&state.jwt, &session.session_token)),
            clear_oauth_state_cookie(&state.jwt),
        ));
    };

    state
        .storage
        .upsert_identity(
            &linked_user_id,
            &provider,
            &oauth_user.provider_user_id,
            Some(&oauth_user.access_token),
            oauth_user.refresh_token.as_deref(),
            oauth_user.expires_at,
        )
        .await?;

    let session = create_user_session(&state, &headers, &linked_user_id, None).await?;
    let redirect_to = query.next.as_deref().unwrap_or("/dashboard");
    let response = Redirect::temporary(redirect_to).into_response();
    Ok(with_cookie_header(
        with_cookie_header(response, session_cookie_header(&state.jwt, &session.session_token)),
        clear_oauth_state_cookie(&state.jwt),
    ))
}

pub async fn require_api_key(
    State(state): State<Arc<AppState>>,
    mut request: Request,
    next: Next,
) -> Result<Response, ApiError> {
    let raw_key = request
        .headers()
        .get(API_KEY_HEADER)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::Unauthorized("missing api key".to_string()))?;

    let api_key = state
        .storage
        .get_project_api_key(raw_key)
        .await?
        .ok_or_else(|| ApiError::Unauthorized("invalid api key".to_string()))?;

    state.storage.touch_project_api_key(&api_key.id).await?;
    request.extensions_mut().insert(ProjectApiKeyAuth {
        key_id: api_key.id,
        project_id: api_key.project_id,
        organization_id: api_key.organization_id,
    });

    Ok(next.run(request).await)
}

pub async fn require_jwt(
    State(state): State<Arc<AppState>>,
    Query(query): Query<AccessTokenQuery>,
    mut request: Request,
    next: Next,
) -> Result<Response, ApiError> {
    let token = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(|value| value.trim().to_string())
        .or_else(|| {
            query
                .access_token
                .as_deref()
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
        .or_else(|| cookie_value(&request, &state.jwt.cookie_name))
        .ok_or_else(|| ApiError::Unauthorized("missing session".to_string()))?;

    let session = state
        .storage
        .get_session(&token)
        .await?
        .ok_or_else(|| ApiError::Unauthorized("invalid session".to_string()))?;
    let user = build_authenticated_user(&state, &session.user_id).await?;
    request.extensions_mut().insert(user);

    Ok(next.run(request).await)
}

pub async fn require_admin_role(request: Request, next: Next) -> Result<Response, ApiError> {
    let user = request
        .extensions()
        .get::<AuthenticatedUser>()
        .cloned()
        .ok_or_else(|| ApiError::Forbidden("missing authenticated user".to_string()))?;

    if !user.permissions.iter().any(|permission| permission == Permission::SandboxRun.as_str()) {
        return Err(ApiError::Forbidden(
            "sandbox access requires sandbox:run permission".to_string(),
        ));
    }

    Ok(next.run(request).await)
}

async fn build_authenticated_user(
    state: &Arc<AppState>,
    user_id: &str,
) -> Result<AuthenticatedUser, ApiError> {
    let user = state
        .storage
        .get_user_by_id(user_id)
        .await?
        .ok_or_else(|| ApiError::Unauthorized("user no longer exists".to_string()))?;
    let memberships = state.storage.get_memberships_for_user(user_id).await?;
    let mut permissions = memberships
        .iter()
        .flat_map(|membership| role_permissions(&membership.role))
        .map(|permission| permission.as_str().to_string())
        .collect::<Vec<_>>();
    permissions.sort();
    permissions.dedup();
    let is_admin = permissions
        .iter()
        .any(|permission| permission == Permission::SandboxRun.as_str());

    Ok(AuthenticatedUser {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        memberships,
        permissions,
        is_admin,
    })
}

async fn create_user_session(
    state: &Arc<AppState>,
    headers: &HeaderMap,
    user_id: &str,
    bootstrap_api_key: Option<&str>,
) -> Result<agentscope_storage::auth::UserSession, ApiError> {
    let token = generate_session_token();
    let expires_at = Utc::now() + Duration::seconds(state.jwt.expiry_seconds);
    let ip_address = headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .map(ToString::to_string);
    let user_agent = headers
        .get(header::USER_AGENT)
        .and_then(|value| value.to_str().ok())
        .map(ToString::to_string);

    state
        .storage
        .create_session(
            user_id,
            &token,
            expires_at,
            ip_address.as_deref(),
            user_agent.as_deref(),
            bootstrap_api_key,
        )
        .await
        .map_err(ApiError::from)
}

fn login_response(
    user: AuthUser,
    session: &agentscope_storage::auth::UserSession,
    onboarding: OnboardingState,
) -> LoginResponse {
    LoginResponse {
        token: session.session_token.clone(),
        expires_at: session.expires_at.to_rfc3339(),
        user,
        onboarding,
    }
}

fn register_response(
    account: RegisteredAccount,
    session: &agentscope_storage::auth::UserSession,
    onboarding: OnboardingState,
) -> RegisterResponse {
    RegisterResponse {
        token: session.session_token.clone(),
        expires_at: session.expires_at.to_rfc3339(),
        user: account.user,
        organization: RegisteredOrganization {
            id: account.organization_id,
            name: account.organization_name,
        },
        project: RegisteredProject {
            id: account.project_id,
            name: account.project_name,
        },
        api_key: account.api_key,
        onboarding,
    }
}

fn json_with_session_cookie<T: Serialize>(
    settings: &JwtSettings,
    session_token: &str,
    payload: T,
) -> Response {
    let response = Json(payload).into_response();
    with_cookie_header(response, session_cookie_header(settings, session_token))
}

fn with_cookie_header(mut response: Response, value: String) -> Response {
    response.headers_mut().append(
        header::SET_COOKIE,
        HeaderValue::from_str(&value).expect("cookie header must be valid"),
    );
    response
}

fn session_cookie_header(settings: &JwtSettings, session_token: &str) -> String {
    let secure = if settings.secure_cookies { "; Secure" } else { "" };
    format!(
        "{}={}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}{}",
        settings.cookie_name,
        session_token,
        settings.expiry_seconds,
        secure
    )
}

fn clear_cookie_header(settings: &JwtSettings) -> String {
    let secure = if settings.secure_cookies { "; Secure" } else { "" };
    format!(
        "{}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0{}",
        settings.cookie_name, secure
    )
}

fn oauth_state_cookie(settings: &JwtSettings, state: &str) -> String {
    let secure = if settings.secure_cookies { "; Secure" } else { "" };
    format!(
        "{}={}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600{}",
        OAUTH_STATE_COOKIE_NAME, state, secure
    )
}

fn clear_oauth_state_cookie(settings: &JwtSettings) -> String {
    let secure = if settings.secure_cookies { "; Secure" } else { "" };
    format!(
        "{}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0{}",
        OAUTH_STATE_COOKIE_NAME, secure
    )
}

fn session_token_from_headers(headers: &HeaderMap, cookie_name: &str) -> Option<String> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(|value| value.trim().to_string())
        .or_else(|| cookie_value_from_headers(headers, cookie_name))
}

fn cookie_value(request: &Request, name: &str) -> Option<String> {
    cookie_value_from_headers(request.headers(), name)
}

fn cookie_value_from_headers(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(header::COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|header_value| {
            header_value
                .split(';')
                .map(str::trim)
                .find_map(|entry| entry.strip_prefix(&format!("{name}=")).map(ToString::to_string))
        })
}

async fn load_oauth_provider(
    state: &Arc<AppState>,
    provider: &str,
) -> Result<agentscope_storage::auth::OauthProviderRecord, ApiError> {
    if let (Ok(client_id), Ok(client_secret), Ok(redirect_uri)) = (
        std::env::var(format!("{}_OAUTH_CLIENT_ID", provider.to_uppercase())),
        std::env::var(format!("{}_OAUTH_CLIENT_SECRET", provider.to_uppercase())),
        std::env::var(format!("{}_OAUTH_REDIRECT_URI", provider.to_uppercase())),
    ) {
        state
            .storage
            .upsert_oauth_provider(provider, &client_id, &client_secret, &redirect_uri, true)
            .await?;
    }

    let provider_config = state
        .storage
        .get_oauth_provider(provider)
        .await?
        .filter(|record| record.enabled)
        .ok_or_else(|| ApiError::Validation(format!("oauth provider {provider} is not configured")))?;

    Ok(provider_config)
}

async fn exchange_oauth_code(
    provider: &str,
    provider_config: &agentscope_storage::auth::OauthProviderRecord,
    code: &str,
) -> Result<OAuthUserInfo, ApiError> {
    let client = Client::new();
    match provider {
        "google" => exchange_google_code(&client, provider_config, code).await,
        "github" => exchange_github_code(&client, provider_config, code).await,
        _ => Err(ApiError::Validation(format!(
            "unsupported oauth provider {provider}"
        ))),
    }
}

async fn exchange_google_code(
    client: &Client,
    provider_config: &agentscope_storage::auth::OauthProviderRecord,
    code: &str,
) -> Result<OAuthUserInfo, ApiError> {
    #[derive(Deserialize)]
    struct GoogleTokenResponse {
        access_token: String,
        expires_in: Option<i64>,
        refresh_token: Option<String>,
    }
    #[derive(Deserialize)]
    struct GoogleUserInfo {
        sub: String,
        email: String,
        name: Option<String>,
        picture: Option<String>,
    }

    let token = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("code", code),
            ("client_id", provider_config.client_id.as_str()),
            ("client_secret", provider_config.client_secret.as_str()),
            ("redirect_uri", provider_config.redirect_uri.as_str()),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await
        .map_err(|error| ApiError::Storage(format!("google token exchange failed: {error}")))?
        .error_for_status()
        .map_err(|error| ApiError::Forbidden(format!("google token exchange rejected: {error}")))?
        .json::<GoogleTokenResponse>()
        .await
        .map_err(|error| ApiError::Storage(format!("failed to parse google token response: {error}")))?;

    let profile = client
        .get("https://openidconnect.googleapis.com/v1/userinfo")
        .bearer_auth(&token.access_token)
        .send()
        .await
        .map_err(|error| ApiError::Storage(format!("google profile request failed: {error}")))?
        .error_for_status()
        .map_err(|error| ApiError::Forbidden(format!("google profile request rejected: {error}")))?
        .json::<GoogleUserInfo>()
        .await
        .map_err(|error| ApiError::Storage(format!("failed to parse google profile: {error}")))?;

    Ok(OAuthUserInfo {
        provider_user_id: profile.sub,
        email: profile.email,
        name: profile.name,
        avatar_url: profile.picture,
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at: token
            .expires_in
            .map(|seconds| Utc::now() + Duration::seconds(seconds)),
    })
}

async fn exchange_github_code(
    client: &Client,
    provider_config: &agentscope_storage::auth::OauthProviderRecord,
    code: &str,
) -> Result<OAuthUserInfo, ApiError> {
    #[derive(Deserialize)]
    struct GithubTokenResponse {
        access_token: String,
    }
    #[derive(Deserialize)]
    struct GithubProfile {
        id: i64,
        avatar_url: Option<String>,
        name: Option<String>,
        email: Option<String>,
    }
    #[derive(Clone, Deserialize)]
    struct GithubEmail {
        email: String,
        primary: bool,
        verified: bool,
    }

    let token = client
        .post("https://github.com/login/oauth/access_token")
        .header(header::ACCEPT, "application/json")
        .form(&[
            ("client_id", provider_config.client_id.as_str()),
            ("client_secret", provider_config.client_secret.as_str()),
            ("code", code),
            ("redirect_uri", provider_config.redirect_uri.as_str()),
        ])
        .send()
        .await
        .map_err(|error| ApiError::Storage(format!("github token exchange failed: {error}")))?
        .error_for_status()
        .map_err(|error| ApiError::Forbidden(format!("github token exchange rejected: {error}")))?
        .json::<GithubTokenResponse>()
        .await
        .map_err(|error| ApiError::Storage(format!("failed to parse github token response: {error}")))?;

    let profile = client
        .get("https://api.github.com/user")
        .header(header::USER_AGENT, "AgentScope")
        .bearer_auth(&token.access_token)
        .send()
        .await
        .map_err(|error| ApiError::Storage(format!("github profile request failed: {error}")))?
        .error_for_status()
        .map_err(|error| ApiError::Forbidden(format!("github profile request rejected: {error}")))?
        .json::<GithubProfile>()
        .await
        .map_err(|error| ApiError::Storage(format!("failed to parse github profile: {error}")))?;

    let email = if let Some(email) = profile.email.clone() {
        email
    } else {
        let emails = client
            .get("https://api.github.com/user/emails")
            .header(header::USER_AGENT, "AgentScope")
            .bearer_auth(&token.access_token)
            .send()
            .await
            .map_err(|error| ApiError::Storage(format!("github email request failed: {error}")))?
            .error_for_status()
            .map_err(|error| ApiError::Forbidden(format!("github email request rejected: {error}")))?
            .json::<Vec<GithubEmail>>()
            .await
            .map_err(|error| ApiError::Storage(format!("failed to parse github emails: {error}")))?;
        emails
            .iter()
            .find(|email| email.primary && email.verified)
            .or_else(|| emails.iter().find(|email| email.verified))
            .map(|email| email.email.clone())
            .ok_or_else(|| ApiError::Forbidden("github account has no verified email".to_string()))?
    };

    Ok(OAuthUserInfo {
        provider_user_id: profile.id.to_string(),
        email,
        name: profile.name,
        avatar_url: profile.avatar_url,
        access_token: token.access_token,
        refresh_token: None,
        expires_at: None,
    })
}
