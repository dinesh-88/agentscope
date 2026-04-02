use std::cmp::Ordering;
use std::collections::HashMap;

use agentscope_common::errors::AgentScopeError;
use chrono::{DateTime, Utc};
use chrono::{NaiveDate, NaiveDateTime};
use sqlx::{FromRow, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::Storage;

const FREQUENCY_WEIGHT: f64 = 0.5;
const COST_WEIGHT: f64 = 0.3;
const SEVERITY_WEIGHT: f64 = 0.2;

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
