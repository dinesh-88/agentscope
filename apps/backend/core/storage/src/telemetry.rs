use agentscope_common::errors::AgentScopeError;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

use crate::Storage;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SdkTelemetryEvent {
    pub project_id: String,
    pub event: String,
    pub sdk: String,
    pub sdk_version: String,
    pub runtime: String,
    pub env: String,
    pub timestamp: DateTime<Utc>,
    pub error_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct AdminTelemetryOverview {
    pub total_events: i64,
    pub active_projects: i64,
    pub events_today: i64,
    pub events_last_7_days: i64,
    pub error_rate: f64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct AdminTelemetryDayPoint {
    pub day: chrono::NaiveDate,
    pub events: i64,
    pub active_projects: i64,
    pub error_rate: f64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct AdminTelemetrySdkBreakdown {
    pub sdk: String,
    pub events: i64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct AdminTelemetryVersionBreakdown {
    pub sdk_version: String,
    pub events: i64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct AdminTelemetryIngestOverview {
    pub runs_today: i64,
    pub runs_last_7_days: i64,
    pub spans_last_7_days: i64,
    pub artifacts_last_7_days: i64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct AdminTelemetrySourceBreakdown {
    pub source: String,
    pub sdk_events: i64,
    pub ingested_runs: i64,
    pub failed_runs: i64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct AdminTelemetryPipelineDayPoint {
    pub day: chrono::NaiveDate,
    pub sdk_events: i64,
    pub ingested_runs: i64,
    pub proxy_runs: i64,
    pub proxy_errors: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AdminTelemetryMetrics {
    pub overview: AdminTelemetryOverview,
    pub timeline: Vec<AdminTelemetryDayPoint>,
    pub sdk_breakdown: Vec<AdminTelemetrySdkBreakdown>,
    pub version_breakdown: Vec<AdminTelemetryVersionBreakdown>,
    pub ingest_overview: AdminTelemetryIngestOverview,
    pub source_breakdown: Vec<AdminTelemetrySourceBreakdown>,
    pub pipeline_daily: Vec<AdminTelemetryPipelineDayPoint>,
}

impl Storage {
    pub async fn insert_telemetry_event(
        &self,
        telemetry: &SdkTelemetryEvent,
    ) -> Result<(), AgentScopeError> {
        sqlx::query(
            r#"
            INSERT INTO telemetry_events (
                project_id,
                event,
                sdk,
                sdk_version,
                runtime,
                env,
                "timestamp",
                error_type
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            "#,
        )
        .bind(&telemetry.project_id)
        .bind(&telemetry.event)
        .bind(&telemetry.sdk)
        .bind(&telemetry.sdk_version)
        .bind(&telemetry.runtime)
        .bind(&telemetry.env)
        .bind(telemetry.timestamp)
        .bind(&telemetry.error_type)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!("failed to insert sdk telemetry event: {error}"))
        })?;

        Ok(())
    }

    pub async fn prune_telemetry_events(
        &self,
        retention_days: i64,
    ) -> Result<i64, AgentScopeError> {
        let cutoff = Utc::now() - Duration::days(retention_days);
        let result = sqlx::query(
            r#"
            DELETE FROM telemetry_events
            WHERE "timestamp" < $1
            "#,
        )
        .bind(cutoff)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!("failed to prune sdk telemetry events: {error}"))
        })?;

        Ok(result.rows_affected() as i64)
    }

    pub async fn get_admin_telemetry_metrics(
        &self,
    ) -> Result<AdminTelemetryMetrics, AgentScopeError> {
        let overview = sqlx::query_as::<_, AdminTelemetryOverview>(
            r#"
            SELECT
                COUNT(*)::bigint AS total_events,
                COUNT(DISTINCT project_id)::bigint AS active_projects,
                COUNT(*) FILTER (WHERE "timestamp" >= date_trunc('day', now()))::bigint AS events_today,
                COUNT(*) FILTER (WHERE "timestamp" >= now() - interval '7 days')::bigint AS events_last_7_days,
                COALESCE(
                    (COUNT(*) FILTER (WHERE error_type IS NOT NULL))::double precision
                    / NULLIF(COUNT(*)::double precision, 0.0),
                    0.0
                ) AS error_rate
            FROM telemetry_events
            "#,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(|error| AgentScopeError::Storage(format!("failed to load telemetry overview: {error}")))?;

        let timeline = sqlx::query_as::<_, AdminTelemetryDayPoint>(
            r#"
            WITH days AS (
                SELECT generate_series(
                    (CURRENT_DATE - interval '29 days')::date,
                    CURRENT_DATE::date,
                    interval '1 day'
                )::date AS day
            ),
            grouped AS (
                SELECT
                    DATE("timestamp") AS day,
                    COUNT(*)::bigint AS events,
                    COUNT(DISTINCT project_id)::bigint AS active_projects,
                    COALESCE(
                        (COUNT(*) FILTER (WHERE error_type IS NOT NULL))::double precision
                        / NULLIF(COUNT(*)::double precision, 0.0),
                        0.0
                    ) AS error_rate
                FROM telemetry_events
                WHERE "timestamp" >= CURRENT_DATE - interval '29 days'
                GROUP BY DATE("timestamp")
            )
            SELECT
                days.day,
                COALESCE(grouped.events, 0)::bigint AS events,
                COALESCE(grouped.active_projects, 0)::bigint AS active_projects,
                COALESCE(grouped.error_rate, 0.0)::double precision AS error_rate
            FROM days
            LEFT JOIN grouped ON grouped.day = days.day
            ORDER BY days.day ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!("failed to load telemetry timeline: {error}"))
        })?;

        let sdk_breakdown = sqlx::query_as::<_, AdminTelemetrySdkBreakdown>(
            r#"
            SELECT sdk, COUNT(*)::bigint AS events
            FROM telemetry_events
            GROUP BY sdk
            ORDER BY events DESC, sdk ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!("failed to load sdk breakdown: {error}"))
        })?;

        let version_breakdown = sqlx::query_as::<_, AdminTelemetryVersionBreakdown>(
            r#"
            SELECT sdk_version, COUNT(*)::bigint AS events
            FROM telemetry_events
            GROUP BY sdk_version
            ORDER BY events DESC, sdk_version ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!("failed to load version breakdown: {error}"))
        })?;

        let ingest_overview = sqlx::query_as::<_, AdminTelemetryIngestOverview>(
            r#"
            SELECT
                COUNT(*) FILTER (WHERE started_at >= date_trunc('day', now()))::bigint AS runs_today,
                COUNT(*) FILTER (WHERE started_at >= now() - interval '7 days')::bigint AS runs_last_7_days,
                (
                    SELECT COUNT(*)::bigint
                    FROM spans
                    WHERE started_at >= now() - interval '7 days'
                ) AS spans_last_7_days,
                (
                    SELECT COUNT(*)::bigint
                    FROM artifacts a
                    INNER JOIN runs r ON r.id = a.run_id
                    WHERE r.started_at >= now() - interval '7 days'
                ) AS artifacts_last_7_days
            FROM runs
            "#,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!("failed to load ingest overview: {error}"))
        })?;

        let source_breakdown = sqlx::query_as::<_, AdminTelemetrySourceBreakdown>(
            r#"
            WITH source_names AS (
                SELECT unnest(ARRAY['sdk_python', 'sdk_ts', 'llm_proxy', 'unknown']) AS source
            ),
            sdk_counts AS (
                SELECT
                    CASE
                        WHEN sdk = 'python' THEN 'sdk_python'
                        WHEN sdk = 'ts' THEN 'sdk_ts'
                        ELSE 'unknown'
                    END AS source,
                    COUNT(*)::bigint AS sdk_events
                FROM telemetry_events
                GROUP BY 1
            ),
            ingest_counts AS (
                SELECT
                    CASE
                        WHEN COALESCE(NULLIF(BTRIM(metadata ->> 'telemetry_source'), ''), 'unknown') IN ('sdk_python', 'sdk_ts', 'llm_proxy')
                            THEN COALESCE(NULLIF(BTRIM(metadata ->> 'telemetry_source'), ''), 'unknown')
                        ELSE 'unknown'
                    END AS source,
                    COUNT(*)::bigint AS ingested_runs,
                    COUNT(*) FILTER (WHERE status IN ('failed', 'error'))::bigint AS failed_runs
                FROM runs
                GROUP BY 1
            )
            SELECT
                source_names.source,
                COALESCE(sdk_counts.sdk_events, 0)::bigint AS sdk_events,
                COALESCE(ingest_counts.ingested_runs, 0)::bigint AS ingested_runs,
                COALESCE(ingest_counts.failed_runs, 0)::bigint AS failed_runs
            FROM source_names
            LEFT JOIN sdk_counts ON sdk_counts.source = source_names.source
            LEFT JOIN ingest_counts ON ingest_counts.source = source_names.source
            ORDER BY source_names.source ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!("failed to load source breakdown: {error}"))
        })?;

        let pipeline_daily = sqlx::query_as::<_, AdminTelemetryPipelineDayPoint>(
            r#"
            WITH days AS (
                SELECT generate_series(
                    (CURRENT_DATE - interval '29 days')::date,
                    CURRENT_DATE::date,
                    interval '1 day'
                )::date AS day
            ),
            sdk_events AS (
                SELECT DATE("timestamp") AS day, COUNT(*)::bigint AS sdk_events
                FROM telemetry_events
                WHERE "timestamp" >= CURRENT_DATE - interval '29 days'
                GROUP BY DATE("timestamp")
            ),
            ingest_runs AS (
                SELECT DATE(started_at) AS day, COUNT(*)::bigint AS ingested_runs
                FROM runs
                WHERE started_at >= CURRENT_DATE - interval '29 days'
                GROUP BY DATE(started_at)
            ),
            proxy_runs AS (
                SELECT
                    DATE(started_at) AS day,
                    COUNT(*)::bigint AS proxy_runs,
                    COUNT(*) FILTER (WHERE status IN ('failed', 'error'))::bigint AS proxy_errors
                FROM runs
                WHERE started_at >= CURRENT_DATE - interval '29 days'
                  AND COALESCE(NULLIF(BTRIM(metadata ->> 'telemetry_source'), ''), 'unknown') = 'llm_proxy'
                GROUP BY DATE(started_at)
            )
            SELECT
                days.day,
                COALESCE(sdk_events.sdk_events, 0)::bigint AS sdk_events,
                COALESCE(ingest_runs.ingested_runs, 0)::bigint AS ingested_runs,
                COALESCE(proxy_runs.proxy_runs, 0)::bigint AS proxy_runs,
                COALESCE(proxy_runs.proxy_errors, 0)::bigint AS proxy_errors
            FROM days
            LEFT JOIN sdk_events ON sdk_events.day = days.day
            LEFT JOIN ingest_runs ON ingest_runs.day = days.day
            LEFT JOIN proxy_runs ON proxy_runs.day = days.day
            ORDER BY days.day ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!("failed to load telemetry pipeline daily: {error}"))
        })?;

        Ok(AdminTelemetryMetrics {
            overview,
            timeline,
            sdk_breakdown,
            version_breakdown,
            ingest_overview,
            source_breakdown,
            pipeline_daily,
        })
    }
}
