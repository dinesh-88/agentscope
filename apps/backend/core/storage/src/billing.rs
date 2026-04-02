use agentscope_common::errors::AgentScopeError;
use chrono::{DateTime, Datelike, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

use crate::Storage;

pub const PLAN_FREE: &str = "free";
pub const PLAN_PRO: &str = "pro";

pub const PLAN_FREE_RUN_LIMIT: i64 = 1_000;
pub const PLAN_PRO_RUN_LIMIT: i64 = 50_000;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Subscription {
    pub id: String,
    pub organization_id: String,
    pub plan: String,
    pub status: String,
    pub stripe_customer_id: Option<String>,
    pub stripe_subscription_id: Option<String>,
    pub current_period_start: Option<DateTime<Utc>>,
    pub current_period_end: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BillingOverview {
    pub organization_id: String,
    pub plan: String,
    pub status: String,
    pub runs_used: i64,
    pub run_limit: i64,
}

#[derive(Debug, Clone, Copy)]
pub struct PlanLimits {
    pub run_limit_per_month: i64,
}

pub fn plan_limits(plan: &str) -> PlanLimits {
    match plan {
        PLAN_PRO => PlanLimits {
            run_limit_per_month: PLAN_PRO_RUN_LIMIT,
        },
        _ => PlanLimits {
            run_limit_per_month: PLAN_FREE_RUN_LIMIT,
        },
    }
}

impl Storage {
    pub async fn get_subscription_by_organization(
        &self,
        organization_id: &str,
    ) -> Result<Option<Subscription>, AgentScopeError> {
        let subscription = sqlx::query_as::<_, Subscription>(
            r#"
            SELECT id::text AS id,
                   organization_id::text AS organization_id,
                   plan,
                   status,
                   stripe_customer_id,
                   stripe_subscription_id,
                   current_period_start,
                   current_period_end,
                   created_at,
                   updated_at
            FROM subscriptions
            WHERE organization_id = $1::uuid
            "#,
        )
        .bind(organization_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to load subscription for organization {organization_id}: {error}"
            ))
        })?;

        Ok(subscription)
    }

    pub async fn ensure_free_subscription(
        &self,
        organization_id: &str,
    ) -> Result<Subscription, AgentScopeError> {
        let subscription = sqlx::query_as::<_, Subscription>(
            r#"
            INSERT INTO subscriptions (
                organization_id,
                plan,
                status
            )
            VALUES ($1::uuid, 'free', 'active')
            ON CONFLICT (organization_id)
            DO UPDATE SET updated_at = now()
            RETURNING id::text AS id,
                      organization_id::text AS organization_id,
                      plan,
                      status,
                      stripe_customer_id,
                      stripe_subscription_id,
                      current_period_start,
                      current_period_end,
                      created_at,
                      updated_at
            "#,
        )
        .bind(organization_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to ensure free subscription for organization {organization_id}: {error}"
            ))
        })?;

        Ok(subscription)
    }

    pub async fn upsert_subscription(
        &self,
        organization_id: &str,
        plan: &str,
        status: &str,
        stripe_customer_id: Option<&str>,
        stripe_subscription_id: Option<&str>,
        current_period_start: Option<DateTime<Utc>>,
        current_period_end: Option<DateTime<Utc>>,
    ) -> Result<Subscription, AgentScopeError> {
        let subscription = sqlx::query_as::<_, Subscription>(
            r#"
            INSERT INTO subscriptions (
                organization_id,
                plan,
                status,
                stripe_customer_id,
                stripe_subscription_id,
                current_period_start,
                current_period_end
            )
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (organization_id)
            DO UPDATE SET
                plan = EXCLUDED.plan,
                status = EXCLUDED.status,
                stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, subscriptions.stripe_customer_id),
                stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, subscriptions.stripe_subscription_id),
                current_period_start = EXCLUDED.current_period_start,
                current_period_end = EXCLUDED.current_period_end,
                updated_at = now()
            RETURNING id::text AS id,
                      organization_id::text AS organization_id,
                      plan,
                      status,
                      stripe_customer_id,
                      stripe_subscription_id,
                      current_period_start,
                      current_period_end,
                      created_at,
                      updated_at
            "#,
        )
        .bind(organization_id)
        .bind(plan)
        .bind(status)
        .bind(stripe_customer_id)
        .bind(stripe_subscription_id)
        .bind(current_period_start)
        .bind(current_period_end)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to upsert subscription for organization {organization_id}: {error}"
            ))
        })?;

        Ok(subscription)
    }

    pub async fn set_subscription_customer_id(
        &self,
        organization_id: &str,
        stripe_customer_id: &str,
    ) -> Result<(), AgentScopeError> {
        sqlx::query(
            r#"
            UPDATE subscriptions
            SET stripe_customer_id = $2,
                updated_at = now()
            WHERE organization_id = $1::uuid
            "#,
        )
        .bind(organization_id)
        .bind(stripe_customer_id)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to set stripe customer id for organization {organization_id}: {error}"
            ))
        })?;

        Ok(())
    }

    pub async fn get_subscription_by_stripe_subscription_id(
        &self,
        stripe_subscription_id: &str,
    ) -> Result<Option<Subscription>, AgentScopeError> {
        let subscription = sqlx::query_as::<_, Subscription>(
            r#"
            SELECT id::text AS id,
                   organization_id::text AS organization_id,
                   plan,
                   status,
                   stripe_customer_id,
                   stripe_subscription_id,
                   current_period_start,
                   current_period_end,
                   created_at,
                   updated_at
            FROM subscriptions
            WHERE stripe_subscription_id = $1
            "#,
        )
        .bind(stripe_subscription_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to load subscription by stripe_subscription_id {stripe_subscription_id}: {error}"
            ))
        })?;

        Ok(subscription)
    }

    pub async fn get_organization_id_for_project(
        &self,
        project_id: &str,
    ) -> Result<Option<String>, AgentScopeError> {
        let organization_id = sqlx::query_scalar::<_, String>(
            r#"
            SELECT organization_id::text
            FROM projects
            WHERE id = $1::uuid
            "#,
        )
        .bind(project_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to load organization for project {project_id}: {error}"
            ))
        })?;

        Ok(organization_id)
    }

    pub async fn get_subscription_for_project(
        &self,
        project_id: &str,
    ) -> Result<Option<Subscription>, AgentScopeError> {
        let subscription = sqlx::query_as::<_, Subscription>(
            r#"
            SELECT s.id::text AS id,
                   s.organization_id::text AS organization_id,
                   s.plan,
                   s.status,
                   s.stripe_customer_id,
                   s.stripe_subscription_id,
                   s.current_period_start,
                   s.current_period_end,
                   s.created_at,
                   s.updated_at
            FROM projects p
            INNER JOIN subscriptions s
                ON s.organization_id = p.organization_id
            WHERE p.id = $1::uuid
            "#,
        )
        .bind(project_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to load subscription for project {project_id}: {error}"
            ))
        })?;

        Ok(subscription)
    }

    pub async fn count_monthly_runs_for_project(
        &self,
        project_id: &str,
        month_start: DateTime<Utc>,
        month_end: DateTime<Utc>,
    ) -> Result<i64, AgentScopeError> {
        let count = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT COUNT(*)
            FROM runs
            WHERE project_id = $1::uuid
              AND deleted_at IS NULL
              AND started_at >= $2
              AND started_at < $3
            "#,
        )
        .bind(project_id)
        .bind(month_start)
        .bind(month_end)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to count monthly runs for project {project_id}: {error}"
            ))
        })?;

        Ok(count)
    }

    pub async fn get_billing_overview_for_project(
        &self,
        project_id: &str,
    ) -> Result<Option<BillingOverview>, AgentScopeError> {
        let organization_id = self.get_organization_id_for_project(project_id).await?;
        let Some(organization_id) = organization_id else {
            return Ok(None);
        };

        let subscription = self
            .get_subscription_by_organization(&organization_id)
            .await?
            .unwrap_or(self.ensure_free_subscription(&organization_id).await?);

        let now = Utc::now();
        let month_start = Utc
            .with_ymd_and_hms(now.year(), now.month(), 1, 0, 0, 0)
            .single()
            .unwrap_or(now);
        let (next_year, next_month) = if now.month() == 12 {
            (now.year() + 1, 1)
        } else {
            (now.year(), now.month() + 1)
        };
        let month_end = Utc
            .with_ymd_and_hms(next_year, next_month, 1, 0, 0, 0)
            .single()
            .unwrap_or(now);

        let runs_used = self
            .count_monthly_runs_for_project(project_id, month_start, month_end)
            .await?;

        let run_limit = plan_limits(&subscription.plan).run_limit_per_month;

        Ok(Some(BillingOverview {
            organization_id,
            plan: subscription.plan,
            status: subscription.status,
            runs_used,
            run_limit,
        }))
    }
}
