use std::cmp::Ordering;
use std::collections::HashMap;

use agentscope_common::errors::AgentScopeError;
use chrono::{DateTime, Utc};
use chrono::{NaiveDate, NaiveDateTime};
use serde::Serialize;
use sqlx::{FromRow, Postgres, QueryBuilder};
use tracing::{info, warn};
use uuid::Uuid;

use crate::Storage;

const FREQUENCY_WEIGHT: f64 = 0.5;
const COST_WEIGHT: f64 = 0.3;
const SEVERITY_WEIGHT: f64 = 0.2;
const AUTO_FIX_BASELINE_MIN_FREQUENCY: f64 = 0.05;
const AUTO_FIX_DROP_MULTIPLIER: f64 = 0.5;
const AUTO_FIX_STABILITY_POINTS: usize = 3;
const AUTO_FIX_BASELINE_POINTS: usize = 3;
const AUTO_FIX_MIN_TOTAL_RUNS: i64 = 50;
const REGRESSION_INCREASE_MULTIPLIER: f64 = 1.5;
const REGRESSION_MIN_FREQUENCY: f64 = 0.05;
const REGRESSION_STABILITY_POINTS: usize = 3;
const REGRESSION_MIN_TOTAL_RUNS: i64 = 50;
const REGRESSION_DEDUP_HOURS: i64 = 6;

#[derive(Debug, FromRow)]
struct FailureDailyAggRow {
    project_id: Uuid,
    version_id: Option<Uuid>,
    category: String,
    subcategory: String,
    event_count: i64,
    affected_run_count: i64,
    failed_run_cost_usd: f64,
}

#[derive(Debug, Clone)]
struct IssueScoreRow {
    project_id: Uuid,
    version_id: Uuid,
    issue_key: String,
    category: String,
    subcategory: String,
    severity: String,
    frequency_score: f64,
    cost_score: f64,
    severity_score: f64,
    priority_score: f64,
    event_count: i64,
    affected_run_count: i64,
    failed_run_cost_usd: f64,
    rank_position: i32,
}

#[derive(Debug, Clone, FromRow)]
pub struct ProjectIssueRow {
    pub issue_key: String,
    pub category: String,
    pub subcategory: String,
    pub frequency: f64,
    pub cost_impact: f64,
    pub priority_score: f64,
    pub summary: Option<String>,
    pub root_cause: Option<String>,
    pub recommended_fix: Option<String>,
    pub expected_impact: Option<String>,
    pub confidence_score: Option<f64>,
    pub last_seen: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct IssueImpactSlice {
    pub failure_rate: f64,
    pub cost: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct IssueImpactImprovement {
    pub failure_delta: f64,
    pub cost_saved: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct IssueImpact {
    pub auto_detected: bool,
    pub detection_confidence: Option<f64>,
    pub before: IssueImpactSlice,
    pub after: IssueImpactSlice,
    pub improvement: IssueImpactImprovement,
}

#[derive(Debug, Clone, Serialize)]
pub enum IssueImpactComputation {
    NoFix,
    Processing,
    Ready(IssueImpact),
}

#[derive(Debug, Clone, FromRow)]
struct IssueFixMetaRow {
    fixed_at: DateTime<Utc>,
    auto_detected: bool,
    detection_confidence: Option<f64>,
}

#[derive(Debug, Clone, FromRow)]
struct IssueRankingPoint {
    issue_key: String,
    frequency_score: f64,
    rn: i64,
    already_fixed: bool,
}

#[derive(Debug, Clone, FromRow)]
struct FixedIssueRow {
    issue_key: String,
    baseline_frequency: Option<f64>,
}

#[derive(Debug, Clone, FromRow)]
struct IssueRegressionPoint {
    issue_key: String,
    frequency_score: f64,
    rn: i64,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct ProjectIssueRegressionRow {
    pub issue_key: String,
    pub baseline_frequency: f64,
    pub current_frequency: f64,
    pub regression_severity: f64,
    pub detected_at: DateTime<Utc>,
}

fn severity_score_for_category(category: &str) -> f64 {
    match category.trim().to_ascii_lowercase().as_str() {
        "tool_error" => 1.0,
        "system_error" => 1.0,
        "context_issue" => 0.8,
        "hallucination" => 0.7,
        "latency" => 0.5,
        _ => 0.3,
    }
}

fn severity_label(score: f64) -> String {
    if score >= 0.9 {
        "high".to_string()
    } else if score >= 0.7 {
        "medium".to_string()
    } else {
        "low".to_string()
    }
}

impl Storage {
    pub async fn mark_issue_fixed(
        &self,
        project_id: &str,
        issue_key: &str,
        created_by: Option<&str>,
    ) -> Result<(), AgentScopeError> {
        let issue_key = issue_key.trim();
        if issue_key.is_empty() {
            return Err(AgentScopeError::Validation(
                "issue_key must not be empty".to_string(),
            ));
        }

        let latest_frequency = sqlx::query_scalar::<_, Option<f64>>(
            r#"
            SELECT ir.frequency_score
            FROM issue_rankings ir
            WHERE ir.project_id = $1::uuid
              AND ir.issue_key = $2
            ORDER BY ir.date DESC
            LIMIT 1
            "#,
        )
        .bind(project_id)
        .bind(issue_key)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to fetch latest issue frequency for project {project_id} issue {issue_key}: {error}"
            ))
        })?;

        sqlx::query(
            r#"
            INSERT INTO issue_fixes (
                id,
                project_id,
                issue_key,
                fixed_at,
                created_by,
                auto_detected,
                detection_confidence,
                baseline_frequency,
                current_frequency
            )
            VALUES (
                gen_random_uuid(),
                $1::uuid,
                $2,
                now(),
                $3::uuid,
                false,
                NULL,
                $4::double precision,
                $4::double precision
            )
            ON CONFLICT (project_id, issue_key)
            DO UPDATE
            SET fixed_at = now(),
                created_by = COALESCE(EXCLUDED.created_by, issue_fixes.created_by),
                auto_detected = false,
                detection_confidence = NULL,
                baseline_frequency = EXCLUDED.baseline_frequency,
                current_frequency = EXCLUDED.current_frequency
            "#,
        )
        .bind(project_id)
        .bind(issue_key)
        .bind(created_by)
        .bind(latest_frequency)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to upsert issue fix marker for project {project_id} issue {issue_key}: {error}"
            ))
        })?;

        Ok(())
    }

    pub async fn compute_issue_impact(
        &self,
        project_id: &str,
        issue_key: &str,
    ) -> Result<IssueImpactComputation, AgentScopeError> {
        let issue_key = issue_key.trim();
        if issue_key.is_empty() {
            return Err(AgentScopeError::Validation(
                "issue_key must not be empty".to_string(),
            ));
        }

        let fix_meta = sqlx::query_as::<_, IssueFixMetaRow>(
            r#"
            SELECT
                fixed_at,
                auto_detected,
                detection_confidence
            FROM issue_fixes
            WHERE project_id = $1::uuid
              AND issue_key = $2
            "#,
        )
        .bind(project_id)
        .bind(issue_key)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to fetch issue fix marker for project {project_id} issue {issue_key}: {error}"
            ))
        })?;

        let Some(fix_meta) = fix_meta else {
            return Ok(IssueImpactComputation::NoFix);
        };
        let fixed_at = fix_meta.fixed_at;

        let before_start = fixed_at - chrono::Duration::hours(24);
        let before_end = fixed_at;
        let after_start = fixed_at;
        let after_end = fixed_at + chrono::Duration::hours(24);

        if Utc::now() < after_end {
            return Ok(IssueImpactComputation::Processing);
        }

        let before_start_date = before_start.date_naive();
        let before_end_date = before_end.date_naive();
        let after_start_date = after_start.date_naive();
        let after_end_date = after_end.date_naive();

        let (affected_runs_before, cost_before) = sqlx::query_as::<_, (i64, f64)>(
            r#"
            SELECT
                COALESCE(SUM(fmd.affected_run_count), 0)::bigint AS affected_runs,
                COALESCE(SUM(fmd.failed_run_cost_usd), 0)::double precision AS failed_cost
            FROM failure_metrics_daily fmd
            WHERE fmd.project_id = $1::uuid
              AND fmd.date >= $2
              AND fmd.date < $3
              AND (fmd.failure_key = $4 OR (fmd.category || ':' || fmd.subcategory) = $4)
            "#,
        )
        .bind(project_id)
        .bind(before_start_date)
        .bind(before_end_date)
        .bind(issue_key)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to compute before-window failure metrics for project {project_id} issue {issue_key}: {error}"
            ))
        })?;

        let (affected_runs_after, cost_after) = sqlx::query_as::<_, (i64, f64)>(
            r#"
            SELECT
                COALESCE(SUM(fmd.affected_run_count), 0)::bigint AS affected_runs,
                COALESCE(SUM(fmd.failed_run_cost_usd), 0)::double precision AS failed_cost
            FROM failure_metrics_daily fmd
            WHERE fmd.project_id = $1::uuid
              AND fmd.date >= $2
              AND fmd.date < $3
              AND (fmd.failure_key = $4 OR (fmd.category || ':' || fmd.subcategory) = $4)
            "#,
        )
        .bind(project_id)
        .bind(after_start_date)
        .bind(after_end_date)
        .bind(issue_key)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to compute after-window failure metrics for project {project_id} issue {issue_key}: {error}"
            ))
        })?;

        let total_runs_before = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT COALESCE(SUM(run_count), 0)::bigint
            FROM project_usage_daily
            WHERE project_id = $1::uuid
              AND date >= $2
              AND date < $3
            "#,
        )
        .bind(project_id)
        .bind(before_start_date)
        .bind(before_end_date)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to compute before-window total runs for project {project_id}: {error}"
            ))
        })?;

        let total_runs_after = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT COALESCE(SUM(run_count), 0)::bigint
            FROM project_usage_daily
            WHERE project_id = $1::uuid
              AND date >= $2
              AND date < $3
            "#,
        )
        .bind(project_id)
        .bind(after_start_date)
        .bind(after_end_date)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to compute after-window total runs for project {project_id}: {error}"
            ))
        })?;

        if total_runs_after <= 0 {
            return Ok(IssueImpactComputation::Processing);
        }

        let failure_rate_before = if total_runs_before > 0 {
            affected_runs_before as f64 / total_runs_before as f64
        } else {
            0.0
        };

        let failure_rate_after = if total_runs_after > 0 {
            affected_runs_after as f64 / total_runs_after as f64
        } else {
            0.0
        };

        let impact = IssueImpact {
            auto_detected: fix_meta.auto_detected,
            detection_confidence: fix_meta.detection_confidence,
            before: IssueImpactSlice {
                failure_rate: failure_rate_before,
                cost: cost_before,
            },
            after: IssueImpactSlice {
                failure_rate: failure_rate_after,
                cost: cost_after,
            },
            improvement: IssueImpactImprovement {
                failure_delta: failure_rate_after - failure_rate_before,
                cost_saved: cost_before - cost_after,
            },
        };

        Ok(IssueImpactComputation::Ready(impact))
    }

    pub async fn list_projects_with_issue_rankings(
        &self,
        lookback_days: i32,
    ) -> Result<Vec<String>, AgentScopeError> {
        let normalized_lookback = lookback_days.max(1);
        sqlx::query_scalar::<_, String>(
            r#"
            SELECT DISTINCT project_id::text
            FROM issue_rankings
            WHERE date >= (CURRENT_DATE - $1::int)
            ORDER BY project_id::text
            "#,
        )
        .bind(normalized_lookback)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to list projects with issue rankings: {error}"
            ))
        })
    }

    pub async fn detect_fixed_issues(&self, project_id: &str) -> Result<usize, AgentScopeError> {
        let latest_date = sqlx::query_scalar::<_, Option<NaiveDate>>(
            r#"
            SELECT MAX(date)
            FROM issue_rankings
            WHERE project_id = $1::uuid
            "#,
        )
        .bind(project_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to fetch latest issue ranking date for project {project_id}: {error}"
            ))
        })?;

        let Some(latest_date) = latest_date else {
            info!(
                project_id,
                "auto-fix detection skipped: no issue_rankings data"
            );
            return Ok(0);
        };

        let required_points = (AUTO_FIX_STABILITY_POINTS + AUTO_FIX_BASELINE_POINTS) as i64;
        let points = sqlx::query_as::<_, IssueRankingPoint>(
            r#"
            WITH current_issues AS (
                SELECT DISTINCT issue_key
                FROM issue_rankings
                WHERE project_id = $1::uuid
                  AND date = $2
            ),
            ranked AS (
                SELECT
                    ir.issue_key,
                    ir.date,
                    ir.frequency_score,
                    ROW_NUMBER() OVER (PARTITION BY ir.issue_key ORDER BY ir.date DESC) AS rn
                FROM issue_rankings ir
                JOIN current_issues ci
                  ON ci.issue_key = ir.issue_key
                WHERE ir.project_id = $1::uuid
            )
            SELECT
                r.issue_key,
                r.frequency_score,
                r.rn,
                EXISTS (
                    SELECT 1
                    FROM issue_fixes f
                    WHERE f.project_id = $1::uuid
                      AND f.issue_key = r.issue_key
                ) AS already_fixed
            FROM ranked r
            WHERE r.rn <= $3
            ORDER BY r.issue_key ASC, r.rn ASC
            "#,
        )
        .bind(project_id)
        .bind(latest_date)
        .bind(required_points)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to fetch issue ranking points for project {project_id}: {error}"
            ))
        })?;

        if points.is_empty() {
            info!(
                project_id,
                %latest_date,
                "auto-fix detection skipped: no current issues for latest ranking date"
            );
            return Ok(0);
        }

        let stability_window_start =
            latest_date - chrono::Duration::days((AUTO_FIX_STABILITY_POINTS - 1) as i64);
        let recent_total_runs = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT COALESCE(SUM(run_count), 0)::bigint
            FROM project_usage_daily
            WHERE project_id = $1::uuid
              AND date >= $2
              AND date <= $3
            "#,
        )
        .bind(project_id)
        .bind(stability_window_start)
        .bind(latest_date)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to fetch recent total runs for project {project_id}: {error}"
            ))
        })?;

        if recent_total_runs < AUTO_FIX_MIN_TOTAL_RUNS {
            info!(
                project_id,
                %latest_date,
                recent_total_runs,
                min_total_runs = AUTO_FIX_MIN_TOTAL_RUNS,
                "auto-fix detection skipped: total runs below threshold"
            );
            return Ok(0);
        }

        let mut by_issue: HashMap<String, (bool, Vec<IssueRankingPoint>)> = HashMap::new();
        for point in points {
            let entry = by_issue
                .entry(point.issue_key.clone())
                .or_insert_with(|| (point.already_fixed, Vec::new()));
            entry.0 = point.already_fixed;
            entry.1.push(point);
        }

        let mut detected_count = 0usize;

        for (issue_key, (already_fixed, mut issue_points)) in by_issue {
            if already_fixed {
                info!(
                    project_id,
                    issue_key = %issue_key,
                    "auto-fix detection skipped: issue already fixed"
                );
                continue;
            }

            issue_points.sort_by_key(|point| point.rn);

            if issue_points.len() < (AUTO_FIX_STABILITY_POINTS + AUTO_FIX_BASELINE_POINTS) {
                info!(
                    project_id,
                    issue_key = %issue_key,
                    points = issue_points.len(),
                    required_points = AUTO_FIX_STABILITY_POINTS + AUTO_FIX_BASELINE_POINTS,
                    "auto-fix detection skipped: insufficient ranking points"
                );
                continue;
            }

            let stability_points = &issue_points[..AUTO_FIX_STABILITY_POINTS];
            let baseline_points = &issue_points
                [AUTO_FIX_STABILITY_POINTS..AUTO_FIX_STABILITY_POINTS + AUTO_FIX_BASELINE_POINTS];
            let baseline_frequency = baseline_points
                .iter()
                .map(|point| point.frequency_score)
                .sum::<f64>()
                / baseline_points.len() as f64;
            let current_frequency = stability_points[0].frequency_score;

            if baseline_frequency <= AUTO_FIX_BASELINE_MIN_FREQUENCY {
                info!(
                    project_id,
                    issue_key = %issue_key,
                    baseline_frequency,
                    min_frequency = AUTO_FIX_BASELINE_MIN_FREQUENCY,
                    "auto-fix detection skipped: baseline below threshold"
                );
                continue;
            }

            let threshold = baseline_frequency * AUTO_FIX_DROP_MULTIPLIER;
            let stable_drop = stability_points
                .iter()
                .all(|point| point.frequency_score < threshold);
            if !(current_frequency < threshold && stable_drop) {
                info!(
                    project_id,
                    issue_key = %issue_key,
                    baseline_frequency,
                    current_frequency,
                    threshold,
                    "auto-fix detection skipped: drop is not stable"
                );
                continue;
            }

            let confidence =
                ((baseline_frequency - current_frequency) / baseline_frequency).clamp(0.0, 1.0);

            let insert_result = sqlx::query(
                r#"
                INSERT INTO issue_fixes (
                    id,
                    project_id,
                    issue_key,
                    fixed_at,
                    created_by,
                    auto_detected,
                    detection_confidence,
                    baseline_frequency,
                    current_frequency
                )
                VALUES (
                    gen_random_uuid(),
                    $1::uuid,
                    $2,
                    now(),
                    NULL,
                    true,
                    $3::double precision,
                    $4::double precision,
                    $5::double precision
                )
                ON CONFLICT (project_id, issue_key) DO NOTHING
                "#,
            )
            .bind(project_id)
            .bind(&issue_key)
            .bind(confidence)
            .bind(baseline_frequency)
            .bind(current_frequency)
            .execute(&self.pool)
            .await
            .map_err(|error| {
                AgentScopeError::Storage(format!(
                    "failed to insert auto-detected issue fix for project {project_id} issue {issue_key}: {error}"
                ))
            })?;

            if insert_result.rows_affected() > 0 {
                detected_count += 1;
                info!(
                    project_id,
                    issue_key = %issue_key,
                    baseline_frequency,
                    current_frequency,
                    confidence,
                    "auto-fix detected and inserted"
                );
            } else {
                warn!(
                    project_id,
                    issue_key = %issue_key,
                    "auto-fix detection resolved as duplicate insert"
                );
            }
        }

        info!(
            project_id,
            %latest_date,
            recent_total_runs,
            detected_count,
            "auto-fix detection cycle complete"
        );

        Ok(detected_count)
    }

    pub async fn detect_regressions(&self, project_id: &str) -> Result<usize, AgentScopeError> {
        let fixed_issues = sqlx::query_as::<_, FixedIssueRow>(
            r#"
            SELECT issue_key, baseline_frequency
            FROM issue_fixes
            WHERE project_id = $1::uuid
            "#,
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to fetch fixed issues for project {project_id}: {error}"
            ))
        })?;

        if fixed_issues.is_empty() {
            info!(project_id, "regression detection skipped: no fixed issues");
            return Ok(0);
        }

        let latest_date = sqlx::query_scalar::<_, Option<NaiveDate>>(
            r#"
            SELECT MAX(date)
            FROM issue_rankings
            WHERE project_id = $1::uuid
            "#,
        )
        .bind(project_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to fetch latest issue ranking date for project {project_id}: {error}"
            ))
        })?;

        let Some(latest_date) = latest_date else {
            info!(
                project_id,
                "regression detection skipped: no issue rankings"
            );
            return Ok(0);
        };

        let window_start =
            latest_date - chrono::Duration::days((REGRESSION_STABILITY_POINTS - 1) as i64);
        let recent_total_runs = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT COALESCE(SUM(run_count), 0)::bigint
            FROM project_usage_daily
            WHERE project_id = $1::uuid
              AND date >= $2
              AND date <= $3
            "#,
        )
        .bind(project_id)
        .bind(window_start)
        .bind(latest_date)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to fetch recent total runs for regression detection on project {project_id}: {error}"
            ))
        })?;

        if recent_total_runs < REGRESSION_MIN_TOTAL_RUNS {
            info!(
                project_id,
                %latest_date,
                recent_total_runs,
                min_total_runs = REGRESSION_MIN_TOTAL_RUNS,
                "regression detection skipped: total runs below threshold"
            );
            return Ok(0);
        }

        let issue_keys = fixed_issues
            .iter()
            .map(|row| row.issue_key.clone())
            .collect::<Vec<_>>();
        let required_points = REGRESSION_STABILITY_POINTS as i64;

        let points = sqlx::query_as::<_, IssueRegressionPoint>(
            r#"
            WITH ranked AS (
                SELECT
                    ir.issue_key,
                    ir.frequency_score,
                    ROW_NUMBER() OVER (PARTITION BY ir.issue_key ORDER BY ir.date DESC) AS rn
                FROM issue_rankings ir
                WHERE ir.project_id = $1::uuid
                  AND ir.issue_key = ANY($2::text[])
            )
            SELECT issue_key, frequency_score, rn
            FROM ranked
            WHERE rn <= $3
            ORDER BY issue_key ASC, rn ASC
            "#,
        )
        .bind(project_id)
        .bind(&issue_keys)
        .bind(required_points)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to fetch recent ranking points for regression detection on project {project_id}: {error}"
            ))
        })?;

        let mut points_by_issue: HashMap<String, Vec<IssueRegressionPoint>> = HashMap::new();
        for point in points {
            points_by_issue
                .entry(point.issue_key.clone())
                .or_default()
                .push(point);
        }

        let mut detected_count = 0usize;

        for fixed in fixed_issues {
            let Some(baseline_frequency) = fixed.baseline_frequency else {
                info!(
                    project_id,
                    issue_key = %fixed.issue_key,
                    "regression detection skipped: missing baseline_frequency"
                );
                continue;
            };

            if baseline_frequency <= 0.0 {
                info!(
                    project_id,
                    issue_key = %fixed.issue_key,
                    baseline_frequency,
                    "regression detection skipped: non-positive baseline"
                );
                continue;
            }

            let Some(issue_points) = points_by_issue.get(&fixed.issue_key) else {
                info!(
                    project_id,
                    issue_key = %fixed.issue_key,
                    "regression detection skipped: no recent ranking points"
                );
                continue;
            };

            if issue_points.len() < REGRESSION_STABILITY_POINTS {
                info!(
                    project_id,
                    issue_key = %fixed.issue_key,
                    points = issue_points.len(),
                    required_points = REGRESSION_STABILITY_POINTS,
                    "regression detection skipped: insufficient stability points"
                );
                continue;
            }

            let mut sorted_points = issue_points.clone();
            sorted_points.sort_by_key(|point| point.rn);

            let current_frequency = sorted_points[0].frequency_score;
            let threshold = baseline_frequency * REGRESSION_INCREASE_MULTIPLIER;
            let stable_increase = sorted_points
                .iter()
                .all(|point| point.frequency_score > threshold);
            let monotonic_non_decreasing = sorted_points.windows(2).all(|pair| {
                pair.first()
                    .map(|value| value.frequency_score)
                    .unwrap_or(0.0)
                    >= pair
                        .get(1)
                        .map(|value| value.frequency_score)
                        .unwrap_or(0.0)
            });

            if !(current_frequency > threshold
                && current_frequency > REGRESSION_MIN_FREQUENCY
                && stable_increase
                && monotonic_non_decreasing)
            {
                info!(
                    project_id,
                    issue_key = %fixed.issue_key,
                    baseline_frequency,
                    current_frequency,
                    threshold,
                    "regression detection skipped: rule not satisfied"
                );
                continue;
            }

            let recent_exists = sqlx::query_scalar::<_, bool>(
                r#"
                SELECT EXISTS (
                    SELECT 1
                    FROM issue_regressions
                    WHERE project_id = $1::uuid
                      AND issue_key = $2
                      AND detected_at >= now() - ($3::text || ' hours')::interval
                )
                "#,
            )
            .bind(project_id)
            .bind(&fixed.issue_key)
            .bind(REGRESSION_DEDUP_HOURS.to_string())
            .fetch_one(&self.pool)
            .await
            .map_err(|error| {
                AgentScopeError::Storage(format!(
                    "failed to check dedupe window for regression detection on project {project_id} issue {}: {error}",
                    fixed.issue_key
                ))
            })?;

            if recent_exists {
                info!(
                    project_id,
                    issue_key = %fixed.issue_key,
                    dedupe_hours = REGRESSION_DEDUP_HOURS,
                    "regression detection skipped: recent regression exists"
                );
                continue;
            }

            let regression_severity =
                ((current_frequency - baseline_frequency) / baseline_frequency).max(0.0);
            sqlx::query(
                r#"
                INSERT INTO issue_regressions (
                    id,
                    project_id,
                    issue_key,
                    detected_at,
                    baseline_frequency,
                    current_frequency,
                    regression_severity
                )
                VALUES (
                    gen_random_uuid(),
                    $1::uuid,
                    $2,
                    now(),
                    $3::double precision,
                    $4::double precision,
                    $5::double precision
                )
                "#,
            )
            .bind(project_id)
            .bind(&fixed.issue_key)
            .bind(baseline_frequency)
            .bind(current_frequency)
            .bind(regression_severity)
            .execute(&self.pool)
            .await
            .map_err(|error| {
                AgentScopeError::Storage(format!(
                    "failed to insert regression for project {project_id} issue {}: {error}",
                    fixed.issue_key
                ))
            })?;

            detected_count += 1;
            warn!(
                project_id,
                issue_key = %fixed.issue_key,
                baseline_frequency,
                current_frequency,
                regression_severity,
                "regression detected and recorded"
            );
        }

        info!(
            project_id,
            %latest_date,
            recent_total_runs,
            detected_count,
            "regression detection cycle complete"
        );

        Ok(detected_count)
    }

    pub async fn list_project_regressions(
        &self,
        project_id: &str,
    ) -> Result<Vec<ProjectIssueRegressionRow>, AgentScopeError> {
        sqlx::query_as::<_, ProjectIssueRegressionRow>(
            r#"
            SELECT
                r.issue_key,
                r.baseline_frequency,
                r.current_frequency,
                r.regression_severity,
                r.detected_at
            FROM issue_regressions r
            WHERE r.project_id = $1::uuid
            ORDER BY r.detected_at DESC
            LIMIT 100
            "#,
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to list regressions for project {project_id}: {error}"
            ))
        })
    }

    pub async fn list_project_issues(
        &self,
        project_id: &str,
        limit: i64,
    ) -> Result<Vec<ProjectIssueRow>, AgentScopeError> {
        let normalized_limit = limit.clamp(1, 20);

        sqlx::query_as::<_, ProjectIssueRow>(
            r#"
            WITH latest AS (
                SELECT MAX(ir.date) AS date
                FROM issue_rankings ir
                WHERE ir.project_id = $1::uuid
            ),
            last_seen_by_category AS (
                SELECT
                    fe.failure_category_id,
                    MAX(fe.created_at) AS last_seen
                FROM failure_events fe
                WHERE fe.project_id = $1::uuid
                GROUP BY fe.failure_category_id
            )
            SELECT
                ir.issue_key,
                COALESCE(fc.category, ir.category) AS category,
                COALESCE(fc.subcategory, ir.subcategory) AS subcategory,
                ir.frequency_score AS frequency,
                ir.failed_cost_usd_30d AS cost_impact,
                ir.priority_score,
                ii.summary,
                ii.root_cause,
                ii.recommended_fix,
                ii.expected_impact,
                ii.confidence_score,
                COALESCE(lsc.last_seen, ir.last_seen_at) AS last_seen
            FROM issue_rankings ir
            JOIN latest
              ON latest.date IS NOT NULL
             AND ir.date = latest.date
            LEFT JOIN failure_categories fc
              ON fc.category = ir.category
             AND fc.subcategory = ir.subcategory
            LEFT JOIN issue_insights ii
              ON ii.project_id = ir.project_id
             AND ii.version_id IS NOT DISTINCT FROM ir.version_id
             AND ii.issue_key = ir.issue_key
             AND ii.date = ir.date
            LEFT JOIN last_seen_by_category lsc
              ON lsc.failure_category_id = fc.id
            WHERE ir.project_id = $1::uuid
            ORDER BY ir.priority_score DESC, ir.affected_run_count_30d DESC, ir.issue_key ASC
            LIMIT $2
            "#,
        )
        .bind(project_id)
        .bind(normalized_limit)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| {
            AgentScopeError::Storage(format!(
                "failed to list issue intelligence for project {project_id}: {e}"
            ))
        })
    }

    pub async fn compute_issue_rankings(
        &self,
        target_date: NaiveDate,
    ) -> Result<(), AgentScopeError> {
        let mut tx = self.pool.begin().await.map_err(|e| {
            AgentScopeError::Storage(format!(
                "failed to open transaction for issue rankings on {target_date}: {e}"
            ))
        })?;

        // Query 1: total run volume for the target date (used by frequency_score).
        let total_runs = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT COUNT(*)::bigint
            FROM runs
            WHERE DATE(created_at AT TIME ZONE 'UTC') = $1
            "#,
        )
        .bind(target_date)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| {
            AgentScopeError::Storage(format!("failed to query total runs for {target_date}: {e}"))
        })?;

        if total_runs == 0 {
            tx.commit().await.map_err(|e| {
                AgentScopeError::Storage(format!(
                    "failed to commit empty issue ranking transaction for {target_date}: {e}"
                ))
            })?;
            return Ok(());
        }

        // Query 2: failure aggregates per project/version/category for the target date.
        let daily_failures = sqlx::query_as::<_, FailureDailyAggRow>(
            r#"
            SELECT
                fmd.project_id,
                fmd.version_id,
                fc.category,
                fc.subcategory,
                COALESCE(SUM(fmd.event_count), 0)::bigint AS event_count,
                COALESCE(SUM(fmd.affected_run_count), 0)::bigint AS affected_run_count,
                COALESCE(SUM(fmd.failed_run_cost_usd), 0)::double precision AS failed_run_cost_usd
            FROM failure_metrics_daily fmd
            JOIN failure_categories fc
              ON fc.id = fmd.failure_category_id
            WHERE fmd.date = $1
            GROUP BY
                fmd.project_id,
                fmd.version_id,
                fc.category,
                fc.subcategory
            "#,
        )
        .bind(target_date)
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| {
            AgentScopeError::Storage(format!(
                "failed to query failure aggregates for {target_date}: {e}"
            ))
        })?;

        if daily_failures.is_empty() {
            tx.commit().await.map_err(|e| {
                AgentScopeError::Storage(format!(
                    "failed to commit no-data issue ranking transaction for {target_date}: {e}"
                ))
            })?;
            return Ok(());
        }

        let mut score_rows = Vec::with_capacity(daily_failures.len());

        for row in daily_failures {
            // frequency_score = affected_run_count / total_runs
            let frequency_score = row.affected_run_count as f64 / total_runs as f64;

            // cost_score = ln(1 + failed_run_cost_usd)
            let cost_score = (1.0 + row.failed_run_cost_usd.max(0.0)).ln();

            // severity_score is category-mapped and then weighted in final priority.
            let severity_score = severity_score_for_category(&row.category);

            // priority_score = 0.5*frequency + 0.3*cost + 0.2*severity
            let priority_score = (FREQUENCY_WEIGHT * frequency_score)
                + (COST_WEIGHT * cost_score)
                + (SEVERITY_WEIGHT * severity_score);

            let issue_key = format!("{}:{}", row.category, row.subcategory);
            let severity = severity_label(severity_score);

            score_rows.push(IssueScoreRow {
                project_id: row.project_id,
                version_id: row.version_id.unwrap_or_else(Uuid::nil),
                issue_key,
                category: row.category,
                subcategory: row.subcategory,
                severity,
                frequency_score,
                cost_score,
                severity_score,
                priority_score,
                event_count: row.event_count,
                affected_run_count: row.affected_run_count,
                failed_run_cost_usd: row.failed_run_cost_usd,
                rank_position: 0,
            });
        }

        // Rank issues per project/version for downstream prioritization views.
        let mut grouped: HashMap<(Uuid, Uuid), Vec<usize>> = HashMap::new();
        for (idx, row) in score_rows.iter().enumerate() {
            grouped
                .entry((row.project_id, row.version_id))
                .or_default()
                .push(idx);
        }

        for indices in grouped.values_mut() {
            indices.sort_by(|a, b| {
                score_rows[*b]
                    .priority_score
                    .partial_cmp(&score_rows[*a].priority_score)
                    .unwrap_or(Ordering::Equal)
                    .then_with(|| {
                        score_rows[*b]
                            .affected_run_count
                            .cmp(&score_rows[*a].affected_run_count)
                    })
                    .then_with(|| score_rows[*a].issue_key.cmp(&score_rows[*b].issue_key))
            });

            for (rank, idx) in indices.iter().enumerate() {
                score_rows[*idx].rank_position = (rank as i32) + 1;
            }
        }

        let snapshot_at: NaiveDateTime = target_date.and_hms_opt(0, 0, 0).ok_or_else(|| {
            AgentScopeError::Validation("invalid target_date timestamp".to_string())
        })?;

        // Batched upsert to avoid row-by-row round-trips.
        for chunk in score_rows.chunks(500) {
            let mut qb: QueryBuilder<'_, Postgres> = QueryBuilder::new(
                r#"
                INSERT INTO issue_rankings (
                    project_id,
                    version_id,
                    issue_key,
                    category,
                    subcategory,
                    severity,
                    frequency_score,
                    cost_score,
                    severity_score,
                    priority_score,
                    event_count_30d,
                    affected_run_count_30d,
                    failed_cost_usd_30d,
                    rank_position,
                    first_seen_at,
                    last_seen_at,
                    date,
                    created_at,
                    updated_at
                )
                "#,
            );

            qb.push_values(chunk, |mut b, row| {
                b.push_bind(row.project_id)
                    .push_bind(row.version_id)
                    .push_bind(&row.issue_key)
                    .push_bind(&row.category)
                    .push_bind(&row.subcategory)
                    .push_bind(&row.severity)
                    .push_bind(row.frequency_score)
                    .push_bind(row.cost_score)
                    .push_bind(row.severity_score)
                    .push_bind(row.priority_score)
                    .push_bind(row.event_count)
                    .push_bind(row.affected_run_count)
                    .push_bind(row.failed_run_cost_usd)
                    .push_bind(row.rank_position)
                    .push_bind(snapshot_at)
                    .push_bind(snapshot_at)
                    .push_bind(target_date)
                    .push_bind(snapshot_at)
                    .push_bind(snapshot_at);
            });

            qb.push(
                r#"
                ON CONFLICT (project_id, version_id, issue_key, date)
                DO UPDATE SET
                    category = EXCLUDED.category,
                    subcategory = EXCLUDED.subcategory,
                    severity = EXCLUDED.severity,
                    frequency_score = EXCLUDED.frequency_score,
                    cost_score = EXCLUDED.cost_score,
                    severity_score = EXCLUDED.severity_score,
                    priority_score = EXCLUDED.priority_score,
                    event_count_30d = EXCLUDED.event_count_30d,
                    affected_run_count_30d = EXCLUDED.affected_run_count_30d,
                    failed_cost_usd_30d = EXCLUDED.failed_cost_usd_30d,
                    rank_position = EXCLUDED.rank_position,
                    last_seen_at = EXCLUDED.last_seen_at,
                    updated_at = EXCLUDED.updated_at,
                    first_seen_at = COALESCE(issue_rankings.first_seen_at, EXCLUDED.first_seen_at)
                "#,
            );

            qb.build().execute(&mut *tx).await.map_err(|e| {
                AgentScopeError::Storage(format!(
                    "failed to upsert issue rankings batch for {target_date}: {e}"
                ))
            })?;
        }

        tx.commit().await.map_err(|e| {
            AgentScopeError::Storage(format!(
                "failed to commit issue rankings for {target_date}: {e}"
            ))
        })?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{severity_score_for_category, COST_WEIGHT, FREQUENCY_WEIGHT, SEVERITY_WEIGHT};

    #[test]
    fn severity_mapping_matches_expected_categories() {
        assert_eq!(severity_score_for_category("tool_error"), 1.0);
        assert_eq!(severity_score_for_category("system_error"), 1.0);
        assert_eq!(severity_score_for_category("context_issue"), 0.8);
        assert_eq!(severity_score_for_category("hallucination"), 0.7);
        assert_eq!(severity_score_for_category("latency"), 0.5);
        assert_eq!(severity_score_for_category("unknown_anything"), 0.3);
    }

    #[test]
    fn weighted_priority_formula_is_stable() {
        let frequency_score = 0.4;
        let cost_score = 0.8;
        let severity_score = 1.0;

        let score = (FREQUENCY_WEIGHT * frequency_score)
            + (COST_WEIGHT * cost_score)
            + (SEVERITY_WEIGHT * severity_score);

        assert!((score - 0.64).abs() < 1e-9);
    }
}
