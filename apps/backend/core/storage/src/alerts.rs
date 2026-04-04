use agentscope_common::errors::AgentScopeError;
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{FromRow, Row};
use tracing::info;

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

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ProjectAlertEvent {
    pub id: String,
    pub project_id: String,
    pub alert_type: String,
    pub issue_key: Option<String>,
    pub message: String,
    pub severity: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AlertMetricSnapshot {
    pub failure_rate: f64,
    pub latency_ms: f64,
    pub token_usage: f64,
    pub cost_usd: f64,
    pub tool_error_rate: f64,
}

#[derive(Debug, Clone, FromRow)]
struct NewIssueCandidate {
    issue_key: String,
    priority_score: f64,
}

#[derive(Debug, Clone, FromRow)]
struct RegressionAlertCandidate {
    issue_key: String,
    regression_severity: f64,
    current_frequency: f64,
}

#[derive(Debug, Clone, FromRow)]
struct DailyCostPoint {
    date: NaiveDate,
    run_count: i64,
    cost_usd: f64,
}

#[derive(Debug, Clone, FromRow)]
struct WeeklyReportAlertCandidate {
    week_start: NaiveDate,
    week_end: NaiveDate,
}

const ALERT_TYPE_NEW_ISSUE: &str = "new_issue";
const ALERT_TYPE_REGRESSION: &str = "regression";
const ALERT_TYPE_COST_SPIKE: &str = "cost_spike";
const ALERT_TYPE_WEEKLY_REPORT: &str = "weekly_report";
const INTELLIGENCE_ALERT_COOLDOWN_HOURS: i32 = 6;
const NEW_ISSUE_PRIORITY_THRESHOLD: f64 = 0.65;
const COST_SPIKE_RATIO_THRESHOLD: f64 = 0.30;
const COST_SPIKE_MIN_BASELINE_USD: f64 = 0.10;
const COST_SPIKE_MIN_RUNS: i64 = 50;

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

    pub async fn list_projects_for_intelligence_alerts(&self) -> Result<Vec<String>, AgentScopeError> {
        sqlx::query_scalar::<_, String>(
            r#"
            SELECT DISTINCT project_id::text
            FROM (
                SELECT project_id FROM issue_rankings WHERE date >= CURRENT_DATE - 14
                UNION
                SELECT project_id FROM issue_regressions WHERE detected_at >= now() - interval '14 days'
                UNION
                SELECT project_id FROM project_usage_daily WHERE date >= CURRENT_DATE - 14
                UNION
                SELECT project_id FROM weekly_reports WHERE created_at >= now() - interval '14 days'
            ) project_ids
            ORDER BY project_id::text
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to list projects for intelligence alerts: {error}"
            ))
        })
    }

    pub async fn list_project_alert_events(
        &self,
        project_id: &str,
        limit: i64,
    ) -> Result<Vec<ProjectAlertEvent>, AgentScopeError> {
        let normalized_limit = limit.clamp(1, 200);
        sqlx::query_as::<_, ProjectAlertEvent>(
            r#"
            SELECT
                id::text AS id,
                project_id::text AS project_id,
                COALESCE(type, 'unknown') AS alert_type,
                issue_key,
                COALESCE(message, payload->>'message', payload::text) AS message,
                COALESCE(severity, payload->>'severity', 'medium') AS severity,
                COALESCE(created_at, triggered_at) AS created_at
            FROM alert_events
            WHERE project_id = $1::uuid
              AND type IS NOT NULL
            ORDER BY COALESCE(created_at, triggered_at) DESC
            LIMIT $2
            "#,
        )
        .bind(project_id)
        .bind(normalized_limit)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to list project alert events for project {project_id}: {error}"
            ))
        })
    }

    async fn insert_project_alert_event(
        &self,
        project_id: &str,
        alert_type: &str,
        issue_key: Option<&str>,
        message: &str,
        severity: &str,
        payload: Value,
    ) -> Result<bool, AgentScopeError> {
        let recent_exists = sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM alert_events
                WHERE project_id = $1::uuid
                  AND type = $2
                  AND issue_key IS NOT DISTINCT FROM $3
                  AND created_at >= now() - ($4::text || ' hours')::interval
            )
            "#,
        )
        .bind(project_id)
        .bind(alert_type)
        .bind(issue_key)
        .bind(INTELLIGENCE_ALERT_COOLDOWN_HOURS.to_string())
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to check cooldown for project alert event on project {project_id}: {error}"
            ))
        })?;

        if recent_exists {
            info!(
                project_id,
                alert_type,
                issue_key,
                cooldown_hours = INTELLIGENCE_ALERT_COOLDOWN_HOURS,
                "project alert skipped due to cooldown"
            );
            return Ok(false);
        }

        sqlx::query(
            r#"
            INSERT INTO alert_events (
                id,
                alert_id,
                project_id,
                type,
                issue_key,
                message,
                severity,
                payload,
                created_at
            )
            VALUES (
                gen_random_uuid(),
                NULL,
                $1::uuid,
                $2,
                $3,
                $4,
                $5,
                $6::jsonb,
                now()
            )
            "#,
        )
        .bind(project_id)
        .bind(alert_type)
        .bind(issue_key)
        .bind(message)
        .bind(severity)
        .bind(payload)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to insert project alert event on project {project_id}: {error}"
            ))
        })?;

        Ok(true)
    }

    pub async fn evaluate_issue_alerts_for_project(
        &self,
        project_id: &str,
    ) -> Result<usize, AgentScopeError> {
        let mut created = 0usize;
        created += self
            .detect_new_issue_alerts_for_project(project_id)
            .await?;
        created += self
            .detect_regression_alerts_for_project(project_id)
            .await?;
        created += self
            .detect_cost_spike_alert_for_project(project_id)
            .await?;
        created += self
            .detect_weekly_report_alert_for_project(project_id)
            .await?;
        Ok(created)
    }

    async fn detect_new_issue_alerts_for_project(
        &self,
        project_id: &str,
    ) -> Result<usize, AgentScopeError> {
        let rows = sqlx::query_as::<_, NewIssueCandidate>(
            r#"
            WITH latest AS (
                SELECT MAX(date) AS date
                FROM issue_rankings
                WHERE project_id = $1::uuid
            )
            SELECT
                ir.issue_key,
                ir.priority_score
            FROM issue_rankings ir
            JOIN latest
              ON latest.date IS NOT NULL
             AND ir.date = latest.date
            WHERE ir.project_id = $1::uuid
              AND ir.priority_score > $2
              AND ir.first_seen_at::date = latest.date
            ORDER BY ir.priority_score DESC, ir.issue_key ASC
            LIMIT 20
            "#,
        )
        .bind(project_id)
        .bind(NEW_ISSUE_PRIORITY_THRESHOLD)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to detect new issue alerts for project {project_id}: {error}"
            ))
        })?;

        let mut created = 0usize;
        for row in rows {
            let severity = if row.priority_score >= 0.9 {
                "critical"
            } else if row.priority_score >= 0.75 {
                "high"
            } else {
                "medium"
            };
            let message = format!(
                "New high-impact issue detected: {} (priority {:.2})",
                row.issue_key, row.priority_score
            );
            let payload = json!({
                "type": ALERT_TYPE_NEW_ISSUE,
                "issue_key": row.issue_key,
                "priority_score": row.priority_score,
                "threshold": NEW_ISSUE_PRIORITY_THRESHOLD,
                "message": message,
                "severity": severity
            });

            if self
                .insert_project_alert_event(
                    project_id,
                    ALERT_TYPE_NEW_ISSUE,
                    Some(&row.issue_key),
                    &message,
                    severity,
                    payload,
                )
                .await?
            {
                created += 1;
            }
        }

        Ok(created)
    }

    async fn detect_regression_alerts_for_project(
        &self,
        project_id: &str,
    ) -> Result<usize, AgentScopeError> {
        let rows = sqlx::query_as::<_, RegressionAlertCandidate>(
            r#"
            SELECT
                issue_key,
                regression_severity,
                current_frequency
            FROM issue_regressions
            WHERE project_id = $1::uuid
              AND detected_at >= now() - interval '24 hours'
            ORDER BY detected_at DESC
            LIMIT 50
            "#,
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to detect regression alerts for project {project_id}: {error}"
            ))
        })?;

        let mut created = 0usize;
        for row in rows {
            let severity = if row.regression_severity >= 1.0 {
                "critical"
            } else if row.regression_severity >= 0.5 {
                "high"
            } else {
                "medium"
            };
            let message = format!(
                "Regression detected for {} (severity {:.2}, current frequency {:.3})",
                row.issue_key, row.regression_severity, row.current_frequency
            );
            let payload = json!({
                "type": ALERT_TYPE_REGRESSION,
                "issue_key": row.issue_key,
                "regression_severity": row.regression_severity,
                "current_frequency": row.current_frequency,
                "message": message,
                "severity": severity
            });

            if self
                .insert_project_alert_event(
                    project_id,
                    ALERT_TYPE_REGRESSION,
                    Some(&row.issue_key),
                    &message,
                    severity,
                    payload,
                )
                .await?
            {
                created += 1;
            }
        }

        Ok(created)
    }

    async fn detect_cost_spike_alert_for_project(
        &self,
        project_id: &str,
    ) -> Result<usize, AgentScopeError> {
        let points = sqlx::query_as::<_, DailyCostPoint>(
            r#"
            SELECT
                date,
                run_count::bigint AS run_count,
                cost_usd
            FROM project_usage_daily
            WHERE project_id = $1::uuid
              AND date >= CURRENT_DATE - 8
            ORDER BY date DESC
            LIMIT 8
            "#,
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to detect cost spike alerts for project {project_id}: {error}"
            ))
        })?;

        let Some(current) = points.first() else {
            return Ok(0);
        };
        let baseline_points = points
            .iter()
            .skip(1)
            .filter(|point| point.run_count > 0)
            .collect::<Vec<_>>();
        if baseline_points.is_empty() {
            return Ok(0);
        }

        let baseline_cost =
            baseline_points.iter().map(|point| point.cost_usd).sum::<f64>() / baseline_points.len() as f64;
        if baseline_cost < COST_SPIKE_MIN_BASELINE_USD || current.run_count < COST_SPIKE_MIN_RUNS {
            return Ok(0);
        }

        let ratio = (current.cost_usd - baseline_cost) / baseline_cost;
        if ratio <= COST_SPIKE_RATIO_THRESHOLD {
            return Ok(0);
        }

        let severity = if ratio >= 1.0 {
            "critical"
        } else if ratio >= 0.5 {
            "high"
        } else {
            "medium"
        };
        let message = format!(
            "Cost spike detected: {:.1}% above baseline (${:.2} vs ${:.2})",
            ratio * 100.0,
            current.cost_usd,
            baseline_cost
        );
        let payload = json!({
            "type": ALERT_TYPE_COST_SPIKE,
            "date": current.date,
            "current_cost_usd": current.cost_usd,
            "baseline_cost_usd": baseline_cost,
            "ratio": ratio,
            "threshold_ratio": COST_SPIKE_RATIO_THRESHOLD,
            "message": message,
            "severity": severity
        });

        if self
            .insert_project_alert_event(
                project_id,
                ALERT_TYPE_COST_SPIKE,
                Some("project-cost"),
                &message,
                severity,
                payload,
            )
            .await?
        {
            return Ok(1);
        }

        Ok(0)
    }

    async fn detect_weekly_report_alert_for_project(
        &self,
        project_id: &str,
    ) -> Result<usize, AgentScopeError> {
        let report = sqlx::query_as::<_, WeeklyReportAlertCandidate>(
            r#"
            SELECT week_start, week_end
            FROM weekly_reports
            WHERE project_id = $1::uuid
            ORDER BY week_start DESC
            LIMIT 1
            "#,
        )
        .bind(project_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to detect weekly report alert for project {project_id}: {error}"
            ))
        })?;

        let Some(report) = report else {
            return Ok(0);
        };
        let week_key = format!("week:{}", report.week_start);
        let message = format!(
            "Weekly report is ready ({} to {})",
            report.week_start, report.week_end
        );
        let payload = json!({
            "type": ALERT_TYPE_WEEKLY_REPORT,
            "week_start": report.week_start,
            "week_end": report.week_end,
            "message": message,
            "severity": "low"
        });

        if self
            .insert_project_alert_event(
                project_id,
                ALERT_TYPE_WEEKLY_REPORT,
                Some(&week_key),
                &message,
                "low",
                payload,
            )
            .await?
        {
            return Ok(1);
        }

        Ok(0)
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
