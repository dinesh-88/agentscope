use chrono::{Duration, Utc};
use reqwest::Client;
use serde::Deserialize;

use crate::ApiError;

use super::OAuthUserInfo;

#[derive(Debug, Deserialize)]
pub(crate) struct OpenIdDiscoveryDocument {
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub userinfo_endpoint: Option<String>,
}

pub(crate) async fn fetch_oidc_discovery(
    provider_config: &agentscope_storage::auth::OauthProviderRecord,
) -> Result<OpenIdDiscoveryDocument, ApiError> {
    let issuer = provider_config
        .issuer_url
        .as_deref()
        .ok_or_else(|| ApiError::Validation("oidc issuer_url is not configured".to_string()))?;
    let discovery_url = format!(
        "{}/.well-known/openid-configuration",
        issuer.trim_end_matches('/')
    );
    Client::new()
        .get(discovery_url)
        .send()
        .await
        .map_err(|error| ApiError::Storage(format!("oidc discovery request failed: {error}")))?
        .error_for_status()
        .map_err(|error| ApiError::Forbidden(format!("oidc discovery rejected: {error}")))?
        .json::<OpenIdDiscoveryDocument>()
        .await
        .map_err(|error| ApiError::Storage(format!("failed to parse oidc discovery: {error}")))
}

pub(crate) async fn exchange_oidc_code(
    client: &Client,
    provider_config: &agentscope_storage::auth::OauthProviderRecord,
    code: &str,
) -> Result<OAuthUserInfo, ApiError> {
    #[derive(Debug, Deserialize)]
    struct OidcTokenResponse {
        access_token: String,
        expires_in: Option<i64>,
        refresh_token: Option<String>,
    }

    #[derive(Debug, Deserialize)]
    struct OidcProfile {
        sub: String,
        email: Option<String>,
        name: Option<String>,
        picture: Option<String>,
        preferred_username: Option<String>,
    }

    let discovery = fetch_oidc_discovery(provider_config).await?;
    let token = client
        .post(&discovery.token_endpoint)
        .form(&[
            ("code", code),
            ("client_id", provider_config.client_id.as_str()),
            ("client_secret", provider_config.client_secret.as_str()),
            ("redirect_uri", provider_config.redirect_uri.as_str()),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await
        .map_err(|error| ApiError::Storage(format!("oidc token exchange failed: {error}")))?
        .error_for_status()
        .map_err(|error| ApiError::Forbidden(format!("oidc token exchange rejected: {error}")))?
        .json::<OidcTokenResponse>()
        .await
        .map_err(|error| ApiError::Storage(format!("failed to parse oidc token response: {error}")))?;

    let userinfo_endpoint = discovery
        .userinfo_endpoint
        .ok_or_else(|| ApiError::Validation("oidc userinfo endpoint is missing".to_string()))?;

    let profile = client
        .get(userinfo_endpoint)
        .bearer_auth(&token.access_token)
        .send()
        .await
        .map_err(|error| ApiError::Storage(format!("oidc userinfo request failed: {error}")))?
        .error_for_status()
        .map_err(|error| ApiError::Forbidden(format!("oidc userinfo request rejected: {error}")))?
        .json::<OidcProfile>()
        .await
        .map_err(|error| ApiError::Storage(format!("failed to parse oidc userinfo response: {error}")))?;

    let email = profile
        .email
        .or(profile.preferred_username)
        .ok_or_else(|| ApiError::Forbidden("oidc profile has no email".to_string()))?;

    Ok(OAuthUserInfo {
        provider_user_id: profile.sub,
        email,
        name: profile.name,
        avatar_url: profile.picture,
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at: token
            .expires_in
            .map(|seconds| Utc::now() + Duration::seconds(seconds)),
    })
}
