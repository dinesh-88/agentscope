use std::sync::Arc;

use agentscope_storage::auth::{AuthUser, RegisteredAccount};
use axum::{
    extract::{Query, Request, State},
    http::header,
    middleware::Next,
    response::Response,
    Json,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{Duration, Utc};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

use crate::{ApiError, AppState};

const API_KEY_HEADER: &str = "x-agentscope-api-key";

#[derive(Debug, Clone)]
pub struct JwtSettings {
    pub secret: String,
    pub expiry_seconds: i64,
}

#[derive(Debug, Clone)]
pub struct AuthenticatedUser {
    pub id: String,
    pub email: String,
    pub display_name: Option<String>,
    pub is_admin: bool,
}

#[derive(Debug, Clone)]
pub struct ProjectApiKeyAuth {
    pub key_id: String,
    pub project_id: String,
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
    pub organization_name: String,
    pub project_name: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub token: String,
    pub expires_at: String,
    pub user: AuthUser,
}

#[derive(Debug, Serialize)]
pub struct RegisterResponse {
    pub token: String,
    pub expires_at: String,
    pub user: AuthUser,
    pub organization: RegisteredOrganization,
    pub project: RegisteredProject,
    pub api_key: String,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
struct JwtClaims {
    sub: String,
    email: String,
    exp: usize,
}

#[derive(Debug, Deserialize)]
pub struct AccessTokenQuery {
    access_token: Option<String>,
}

pub async fn login(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, ApiError> {
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

    Ok(Json(login_response(&state.jwt, user)?))
}

pub async fn register(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<RegisterRequest>,
) -> Result<Json<RegisterResponse>, ApiError> {
    let email = payload.email.trim();
    let password = payload.password;
    let display_name = payload
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let organization_name = payload.organization_name.trim();
    let project_name = payload
        .project_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Default Project");

    if email.is_empty() || password.is_empty() || organization_name.is_empty() {
        return Err(ApiError::Validation(
            "email, password, and organization_name are required".to_string(),
        ));
    }

    let account = state
        .storage
        .register_account(
            email,
            &password,
            display_name,
            organization_name,
            project_name,
        )
        .await?;

    let response = register_response(&state.jwt, account)?;
    Ok(Json(response))
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
        .ok_or_else(|| ApiError::Forbidden("missing api key".to_string()))?;

    let api_key = state
        .storage
        .get_project_api_key(raw_key)
        .await?
        .ok_or_else(|| ApiError::Forbidden("invalid api key".to_string()))?;

    state.storage.touch_project_api_key(&api_key.id).await?;
    request.extensions_mut().insert(ProjectApiKeyAuth {
        key_id: api_key.id,
        project_id: api_key.project_id,
    });

    Ok(next.run(request).await)
}

pub async fn require_jwt(
    State(state): State<Arc<AppState>>,
    Query(query): Query<AccessTokenQuery>,
    mut request: Request,
    next: Next,
) -> Result<Response, ApiError> {
    let token = bearer_token(
        request
            .headers()
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok()),
        query.access_token.as_deref(),
    )
    .ok_or_else(|| ApiError::Forbidden("missing bearer token".to_string()))?;

    let claims = decode_jwt(&token, &state.jwt.secret)?;

    let user = state
        .storage
        .get_user_by_id(&claims.sub)
        .await?
        .ok_or_else(|| ApiError::Forbidden("user no longer exists".to_string()))?;

    let is_admin = state.storage.user_has_elevated_membership(&user.id).await?;

    request.extensions_mut().insert(AuthenticatedUser {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        is_admin,
    });

    Ok(next.run(request).await)
}

pub async fn require_admin_role(request: Request, next: Next) -> Result<Response, ApiError> {
    let user = request
        .extensions()
        .get::<AuthenticatedUser>()
        .cloned()
        .ok_or_else(|| ApiError::Forbidden("missing authenticated user".to_string()))?;

    if !user.is_admin {
        return Err(ApiError::Forbidden(
            "sandbox access requires owner or admin role".to_string(),
        ));
    }

    Ok(next.run(request).await)
}

fn bearer_token(header_value: Option<&str>, query_value: Option<&str>) -> Option<String> {
    if let Some(value) = header_value {
        let token = value.strip_prefix("Bearer ")?;
        return Some(token.trim().to_string());
    }

    query_value
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn login_response(jwt: &JwtSettings, user: AuthUser) -> Result<LoginResponse, ApiError> {
    let expires_at = Utc::now() + Duration::seconds(jwt.expiry_seconds);
    let claims = JwtClaims {
        sub: user.id.clone(),
        email: user.email.clone(),
        exp: expires_at.timestamp() as usize,
    };

    let token = encode_jwt(&claims, &jwt.secret)?;

    Ok(LoginResponse {
        token,
        expires_at: expires_at.to_rfc3339(),
        user,
    })
}

fn register_response(
    jwt: &JwtSettings,
    account: RegisteredAccount,
) -> Result<RegisterResponse, ApiError> {
    let login = login_response(jwt, account.user)?;
    Ok(RegisterResponse {
        token: login.token,
        expires_at: login.expires_at,
        user: login.user,
        organization: RegisteredOrganization {
            id: account.organization_id,
            name: account.organization_name,
        },
        project: RegisteredProject {
            id: account.project_id,
            name: account.project_name,
        },
        api_key: account.api_key,
    })
}

fn encode_jwt(claims: &JwtClaims, secret: &str) -> Result<String, ApiError> {
    let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"HS256","typ":"JWT"}"#);
    let claims = serde_json::to_vec(claims)
        .map_err(|error| ApiError::Storage(format!("failed to serialize jwt claims: {error}")))?;
    let payload = URL_SAFE_NO_PAD.encode(claims);
    let signing_input = format!("{header}.{payload}");
    let signature = sign(signing_input.as_bytes(), secret)?;

    Ok(format!("{signing_input}.{signature}"))
}

fn decode_jwt(token: &str, secret: &str) -> Result<JwtClaims, ApiError> {
    let mut parts = token.split('.');
    let header = parts
        .next()
        .ok_or_else(|| ApiError::Forbidden("invalid bearer token".to_string()))?;
    let payload = parts
        .next()
        .ok_or_else(|| ApiError::Forbidden("invalid bearer token".to_string()))?;
    let signature = parts
        .next()
        .ok_or_else(|| ApiError::Forbidden("invalid bearer token".to_string()))?;

    if parts.next().is_some() {
        return Err(ApiError::Forbidden("invalid bearer token".to_string()));
    }

    let signing_input = format!("{header}.{payload}");
    let expected_signature = sign(signing_input.as_bytes(), secret)?;
    if signature != expected_signature {
        return Err(ApiError::Forbidden("invalid bearer token".to_string()));
    }

    let payload_bytes = URL_SAFE_NO_PAD
        .decode(payload)
        .map_err(|_| ApiError::Forbidden("invalid bearer token".to_string()))?;
    let claims: JwtClaims = serde_json::from_slice(&payload_bytes)
        .map_err(|_| ApiError::Forbidden("invalid bearer token".to_string()))?;

    if claims.exp < Utc::now().timestamp() as usize {
        return Err(ApiError::Forbidden("expired bearer token".to_string()));
    }

    Ok(claims)
}

fn sign(input: &[u8], secret: &str) -> Result<String, ApiError> {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes())
        .map_err(|error| ApiError::Storage(format!("failed to initialize jwt signer: {error}")))?;
    mac.update(input);
    Ok(URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes()))
}
