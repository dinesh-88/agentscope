use agentscope_common::errors::AgentScopeError;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{FromRow, Row};

use crate::Storage;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Alert {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub condition_type: String,
    pub threshold_value: f64,
    pub window_minutes: i32,
    pub enabled: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct AlertEvent {
    pub id: String,
    pub alert_id: String,
    pub triggered_at: DateTime<Utc>,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct AlertMetricSnapshot {
    pub failure_rate: f64,
    pub latency_ms: f64,
    pub token_usage: f64,
    pub cost_usd: f64,
    pub tool_error_rate: f64,
}

impl Storage {
    pub async fn create_alert(
        &self,
        project_id: &str,
        name: &str,
        condition_type: &str,
        threshold_value: f64,
        window_minutes: i32,
    ) -> Result<Alert, AgentScopeError> {
        let alert = sqlx::query_as::<_, Alert>(
            r#"
            INSERT INTO alerts (
                project_id,
                name,
                condition_type,
                threshold_value,
                window_minutes,
                enabled
            )
            VALUES ($1::uuid, $2, $3, $4, $5, true)
            RETURNING id::text AS id,
                      project_id::text AS project_id,
                      name,
                      condition_type,
                      threshold_value,
                      window_minutes,
                      enabled,
                      created_at
            "#,
        )
        .bind(project_id)
        .bind(name)
        .bind(condition_type)
        .bind(threshold_value)
        .bind(window_minutes)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to create alert for project {project_id}: {error}"
            ))
        })?;

        Ok(alert)
    }

    pub async fn list_alerts_for_user(&self, user_id: &str) -> Result<Vec<Alert>, AgentScopeError> {
        let alerts = sqlx::query_as::<_, Alert>(
            r#"
            SELECT alerts.id::text AS id,
                   alerts.project_id::text AS project_id,
                   alerts.name,
                   alerts.condition_type,
                   alerts.threshold_value,
                   alerts.window_minutes,
                   alerts.enabled,
                   alerts.created_at
            FROM alerts
            INNER JOIN projects ON projects.id = alerts.project_id
            INNER JOIN memberships ON memberships.organization_id = projects.organization_id
            WHERE memberships.user_id = $1::uuid
            ORDER BY alerts.created_at DESC
            "#,
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!("failed to list alerts for user {user_id}: {error}"))
        })?;

        Ok(alerts)
    }

    pub async fn list_enabled_alerts(&self) -> Result<Vec<Alert>, AgentScopeError> {
        let alerts = sqlx::query_as::<_, Alert>(
            r#"
            SELECT id::text AS id,
                   project_id::text AS project_id,
                   name,
                   condition_type,
                   threshold_value,
                   window_minutes,
                   enabled,
                   created_at
            FROM alerts
            WHERE enabled = true
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!("failed to list enabled alerts: {error}"))
        })?;

        Ok(alerts)
    }

    pub async fn delete_alert_for_user(
        &self,
        alert_id: &str,
        user_id: &str,
    ) -> Result<bool, AgentScopeError> {
        let rows = sqlx::query(
            r#"
            DELETE FROM alerts
            WHERE id = $1::uuid
              AND project_id IN (
                SELECT projects.id
                FROM projects
                INNER JOIN memberships ON memberships.organization_id = projects.organization_id
                WHERE memberships.user_id = $2::uuid
              )
            "#,
        )
        .bind(alert_id)
        .bind(user_id)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to delete alert {alert_id} for user {user_id}: {error}"
            ))
        })?;

        Ok(rows.rows_affected() > 0)
    }

    pub async fn insert_alert_event(
        &self,
        alert_id: &str,
        payload: Value,
    ) -> Result<AlertEvent, AgentScopeError> {
        let event = sqlx::query_as::<_, AlertEvent>(
            r#"
            INSERT INTO alert_events (alert_id, payload)
            VALUES ($1::uuid, $2)
            RETURNING id::text AS id,
                      alert_id::text AS alert_id,
                      triggered_at,
                      payload
            "#,
        )
        .bind(alert_id)
        .bind(payload)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to insert alert event for alert {alert_id}: {error}"
            ))
        })?;

        Ok(event)
    }

    pub async fn list_alert_events_for_user(
        &self,
        user_id: &str,
    ) -> Result<Vec<AlertEvent>, AgentScopeError> {
        let events = sqlx::query_as::<_, AlertEvent>(
            r#"
            SELECT alert_events.id::text AS id,
                   alert_events.alert_id::text AS alert_id,
                   alert_events.triggered_at,
                   alert_events.payload
            FROM alert_events
            INNER JOIN alerts ON alerts.id = alert_events.alert_id
            INNER JOIN projects ON projects.id = alerts.project_id
            INNER JOIN memberships ON memberships.organization_id = projects.organization_id
            WHERE memberships.user_id = $1::uuid
            ORDER BY alert_events.triggered_at DESC
            LIMIT 200
            "#,
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to list alert events for user {user_id}: {error}"
            ))
        })?;

        Ok(events)
    }

    pub async fn compute_alert_metrics(
        &self,
        project_id: &str,
        window_minutes: i32,
    ) -> Result<AlertMetricSnapshot, AgentScopeError> {
        let row = sqlx::query(
            r#"
            SELECT
                COALESCE(AVG(CASE WHEN runs.status IN ('failed', 'error') THEN 1.0 ELSE 0.0 END), 0.0) AS failure_rate,
                COALESCE(AVG(EXTRACT(EPOCH FROM (COALESCE(runs.ended_at, now()) - runs.started_at)) * 1000.0), 0.0) AS latency_ms,
                COALESCE(SUM(runs.total_tokens), 0)::double precision AS token_usage,
                COALESCE(SUM(runs.total_cost_usd), 0)::double precision AS cost_usd,
                COALESCE(
                    AVG(
                        CASE
                            WHEN spans.span_type = 'tool' AND spans.status IN ('failed', 'error') THEN 1.0
                            WHEN spans.span_type = 'tool' THEN 0.0
                            ELSE NULL
                        END
                    ),
                    0.0
                ) AS tool_error_rate
            FROM runs
            LEFT JOIN spans ON spans.run_id = runs.id
            WHERE runs.project_id = $1::uuid
              AND runs.started_at >= now() - ($2::text || ' minutes')::interval
            "#,
        )
        .bind(project_id)
        .bind(window_minutes)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to compute alert metrics for project {project_id}: {error}"
            ))
        })?;

        Ok(AlertMetricSnapshot {
            failure_rate: row.get::<f64, _>("failure_rate"),
            latency_ms: row.get::<f64, _>("latency_ms"),
            token_usage: row.get::<f64, _>("token_usage"),
            cost_usd: row.get::<f64, _>("cost_usd"),
            tool_error_rate: row.get::<f64, _>("tool_error_rate"),
        })
    }

    pub async fn evaluate_and_trigger_alerts(&self) -> Result<usize, AgentScopeError> {
        let alerts = self.list_enabled_alerts().await?;
        let mut triggered = 0usize;

        for alert in alerts {
            let metrics = self
                .compute_alert_metrics(&alert.project_id, alert.window_minutes)
                .await?;

            let metric_value = match alert.condition_type.as_str() {
                "failure_rate" => metrics.failure_rate,
                "latency_ms" => metrics.latency_ms,
                "token_usage" => metrics.token_usage,
                "cost_usd" => metrics.cost_usd,
                "tool_error_rate" => metrics.tool_error_rate,
                _ => continue,
            };

            if metric_value > alert.threshold_value {
                let payload = json!({
                    "project_id": alert.project_id,
                    "alert_name": alert.name,
                    "condition_type": alert.condition_type,
                    "threshold": alert.threshold_value,
                    "observed": metric_value,
                    "window_minutes": alert.window_minutes,
                    "metrics": {
                        "failure_rate": metrics.failure_rate,
                        "latency_ms": metrics.latency_ms,
                        "token_usage": metrics.token_usage,
                        "cost_usd": metrics.cost_usd,
                        "tool_error_rate": metrics.tool_error_rate
                    },
                    "channels": ["email", "webhook"]
                });
                self.insert_alert_event(&alert.id, payload).await?;
                triggered += 1;
            }
        }

        Ok(triggered)
    }
}
