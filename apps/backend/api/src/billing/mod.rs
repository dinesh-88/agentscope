use std::sync::Arc;

use async_trait::async_trait;
use axum::http::HeaderMap;
use chrono::{DateTime, Utc};

use crate::ApiError;

pub mod stripe;

#[derive(Debug, Clone)]
pub struct SubscriptionUpdate {
    pub organization_id: Option<String>,
    pub stripe_customer_id: Option<String>,
    pub stripe_subscription_id: String,
    pub plan: String,
    pub status: String,
    pub current_period_start: Option<DateTime<Utc>>,
    pub current_period_end: Option<DateTime<Utc>>,
}

#[async_trait]
pub trait BillingProvider: Send + Sync {
    async fn create_customer(
        &self,
        email: &str,
        organization_id: Option<&str>,
    ) -> Result<String, ApiError>;

    async fn create_checkout_session(
        &self,
        customer_id: &str,
        organization_id: &str,
        success_url: &str,
        cancel_url: &str,
    ) -> Result<String, ApiError>;

    fn parse_subscription_update(
        &self,
        headers: &HeaderMap,
        body: &[u8],
    ) -> Result<Option<SubscriptionUpdate>, ApiError>;
}

pub type DynBillingProvider = Arc<dyn BillingProvider>;

pub struct NoopBillingProvider;

#[async_trait]
impl BillingProvider for NoopBillingProvider {
    async fn create_customer(
        &self,
        _email: &str,
        _organization_id: Option<&str>,
    ) -> Result<String, ApiError> {
        Err(ApiError::Storage(
            "billing provider is not configured".to_string(),
        ))
    }

    async fn create_checkout_session(
        &self,
        _customer_id: &str,
        _organization_id: &str,
        _success_url: &str,
        _cancel_url: &str,
    ) -> Result<String, ApiError> {
        Err(ApiError::Storage(
            "billing provider is not configured".to_string(),
        ))
    }

    fn parse_subscription_update(
        &self,
        _headers: &HeaderMap,
        _body: &[u8],
    ) -> Result<Option<SubscriptionUpdate>, ApiError> {
        Ok(None)
    }
}
