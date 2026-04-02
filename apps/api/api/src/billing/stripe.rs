use async_trait::async_trait;
use axum::http::HeaderMap;
use chrono::{DateTime, Utc};
use reqwest::Client;
use serde_json::Value;

use super::{BillingProvider, SubscriptionUpdate};
use crate::ApiError;

#[derive(Debug, Clone)]
pub struct StripeBillingProvider {
    secret_key: String,
    pro_price_id: Option<String>,
    webhook_secret: Option<String>,
}

impl StripeBillingProvider {
    pub fn from_env() -> Option<Self> {
        let secret_key = std::env::var("STRIPE_SECRET_KEY")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())?;
        let pro_price_id = std::env::var("STRIPE_PRICE_PRO")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let webhook_secret = std::env::var("STRIPE_WEBHOOK_SECRET")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());

        Some(Self {
            secret_key,
            pro_price_id,
            webhook_secret,
        })
    }

    fn parse_plan(object: &Value) -> String {
        let lookup_key = object
            .get("items")
            .and_then(|value| value.get("data"))
            .and_then(Value::as_array)
            .and_then(|items| items.first())
            .and_then(|item| item.get("price"))
            .and_then(|price| price.get("lookup_key"))
            .and_then(Value::as_str)
            .unwrap_or("free");
        if lookup_key == "pro" || lookup_key.contains("pro") {
            "pro".to_string()
        } else {
            "free".to_string()
        }
    }
}

#[async_trait]
impl BillingProvider for StripeBillingProvider {
    async fn create_customer(
        &self,
        email: &str,
        organization_id: Option<&str>,
    ) -> Result<String, ApiError> {
        let client = Client::new();
        let mut params = vec![("email".to_string(), email.to_string())];
        if let Some(org_id) = organization_id {
            params.push(("metadata[organization_id]".to_string(), org_id.to_string()));
        }
        let response = client
            .post("https://api.stripe.com/v1/customers")
            .basic_auth(&self.secret_key, Some(""))
            .form(&params)
            .send()
            .await
            .map_err(|error| {
                ApiError::Storage(format!("failed to create stripe customer: {error}"))
            })?;
        if !response.status().is_success() {
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "unknown stripe error".to_string());
            return Err(ApiError::Storage(format!(
                "failed to create stripe customer: {body}"
            )));
        }
        let payload: Value = response.json().await.map_err(|error| {
            ApiError::Storage(format!("invalid stripe customer response: {error}"))
        })?;
        let customer_id = payload
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| ApiError::Storage("stripe customer id missing".to_string()))?;
        Ok(customer_id.to_string())
    }

    async fn create_checkout_session(
        &self,
        customer_id: &str,
        organization_id: &str,
        success_url: &str,
        cancel_url: &str,
    ) -> Result<String, ApiError> {
        let price_id = self
            .pro_price_id
            .as_deref()
            .ok_or_else(|| ApiError::Storage("STRIPE_PRICE_PRO is not configured".to_string()))?;

        let client = Client::new();
        let response = client
            .post("https://api.stripe.com/v1/checkout/sessions")
            .basic_auth(&self.secret_key, Some(""))
            .form(&[
                ("mode", "subscription"),
                ("customer", customer_id),
                ("line_items[0][price]", price_id),
                ("line_items[0][quantity]", "1"),
                ("success_url", success_url),
                ("cancel_url", cancel_url),
                ("metadata[organization_id]", organization_id),
                (
                    "subscription_data[metadata][organization_id]",
                    organization_id,
                ),
            ])
            .send()
            .await
            .map_err(|error| {
                ApiError::Storage(format!("failed to create stripe checkout session: {error}"))
            })?;
        if !response.status().is_success() {
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "unknown stripe error".to_string());
            return Err(ApiError::Storage(format!(
                "failed to create stripe checkout session: {body}"
            )));
        }
        let payload: Value = response.json().await.map_err(|error| {
            ApiError::Storage(format!("invalid stripe checkout response: {error}"))
        })?;
        let checkout_url = payload
            .get("url")
            .and_then(Value::as_str)
            .ok_or_else(|| ApiError::Storage("stripe checkout url missing".to_string()))?;
        Ok(checkout_url.to_string())
    }

    fn parse_subscription_update(
        &self,
        headers: &HeaderMap,
        body: &[u8],
    ) -> Result<Option<SubscriptionUpdate>, ApiError> {
        if self.webhook_secret.is_some() {
            let _signature = headers
                .get("stripe-signature")
                .and_then(|value| value.to_str().ok())
                .unwrap_or_default();
        }

        let event: Value = serde_json::from_slice(body).map_err(|error| {
            ApiError::Validation(format!("invalid stripe webhook payload: {error}"))
        })?;
        let event_type = event
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if event_type != "customer.subscription.updated"
            && event_type != "customer.subscription.created"
        {
            return Ok(None);
        }

        let object = event
            .get("data")
            .and_then(|value| value.get("object"))
            .ok_or_else(|| ApiError::Validation("missing stripe event object".to_string()))?;
        let stripe_subscription_id = object
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| ApiError::Validation("missing stripe subscription id".to_string()))?;

        let status = object
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("active")
            .to_string();
        let organization_id = object
            .get("metadata")
            .and_then(|value| value.get("organization_id"))
            .and_then(Value::as_str)
            .map(ToString::to_string);
        let stripe_customer_id = object
            .get("customer")
            .and_then(Value::as_str)
            .map(ToString::to_string);
        let current_period_start = object
            .get("current_period_start")
            .and_then(Value::as_i64)
            .and_then(|epoch| DateTime::<Utc>::from_timestamp(epoch, 0));
        let current_period_end = object
            .get("current_period_end")
            .and_then(Value::as_i64)
            .and_then(|epoch| DateTime::<Utc>::from_timestamp(epoch, 0));

        Ok(Some(SubscriptionUpdate {
            organization_id,
            stripe_customer_id,
            stripe_subscription_id: stripe_subscription_id.to_string(),
            plan: Self::parse_plan(object),
            status,
            current_period_start,
            current_period_end,
        }))
    }
}
