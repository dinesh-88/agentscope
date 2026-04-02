use std::cmp::Ordering;
use std::collections::HashMap;

use agentscope_common::errors::AgentScopeError;
use agentscope_storage::Storage;
use chrono::{NaiveDate, NaiveDateTime};
use sqlx::{FromRow, Postgres, QueryBuilder};
use uuid::Uuid;

const FREQUENCY_WEIGHT: f64 = 0.5;
const COST_WEIGHT: f64 = 0.3;
const SEVERITY_WEIGHT: f64 = 0.2;

#[derive(Debug, Clone)]
pub struct RankedIssue {
    pub project_id: Uuid,
    pub version_id: Option<Uuid>,
    pub issue_key: String,
    pub category: String,
    pub subcategory: String,
    pub frequency_score: f64,
    pub cost_score: f64,
    pub severity_score: f64,
    pub priority_score: f64,
    pub severity: String,
    pub event_count: i64,
    pub affected_run_count: i64,
    pub failed_run_cost_usd: f64,
    pub rank_position: i32,
}

#[derive(Debug, FromRow)]
struct FailureAggRow {
    project_id: Uuid,
    version_id: Option<Uuid>,
    category: String,
    subcategory: String,
    event_count: i64,
    affected_run_count: i64,
    failed_run_cost_usd: f64,
}

fn map_severity_score(category: &str) -> f64 {
    match category.trim().to_ascii_lowercase().as_str() {
        "tool_error" => 1.0,
        "system_error" => 1.0,
        "context_issue" => 0.8,
        "hallucination" => 0.7,
        "latency" => 0.5,
        _ => 0.3,
    }
}

fn map_severity_label(score: f64) -> String {
    if score >= 0.9 {
        "high".to_string()
    } else if score >= 0.7 {
        "medium".to_string()
    } else {
        "low".to_string()
    }
}

// Fetches daily aggregates, computes ranking scores, and returns ranked rows.
pub async fn compute_rankings_for_date(
    storage: &Storage,
    target_date: NaiveDate,
) -> Result<Vec<RankedIssue>, AgentScopeError> {
    // SQL query used:
    // SELECT COUNT(*) FROM runs WHERE DATE(created_at AT TIME ZONE 'UTC') = $1
    let total_runs = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*)::bigint
        FROM runs
        WHERE DATE(created_at AT TIME ZONE 'UTC') = $1
        "#,
    )
    .bind(target_date)
    .fetch_one(&storage.pool)
    .await
    .map_err(|e| AgentScopeError::Storage(format!("failed to fetch total runs: {e}")))?;

    if total_runs == 0 {
        return Ok(Vec::new());
    }

    // SQL query used:
    // SELECT aggregates from failure_metrics_daily joined to failure_categories.
    let rows = sqlx::query_as::<_, FailureAggRow>(
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
    .fetch_all(&storage.pool)
    .await
    .map_err(|e| AgentScopeError::Storage(format!("failed to fetch failure metrics: {e}")))?;

    let mut ranked: Vec<RankedIssue> = Vec::with_capacity(rows.len());
    for row in rows {
        // frequency_score = affected_run_count / total_runs
        let frequency_score = row.affected_run_count as f64 / total_runs as f64;

        // cost_score = ln(1 + failed_run_cost_usd)
        let cost_score = (1.0 + row.failed_run_cost_usd.max(0.0)).ln();

        // severity_score category mapping
        let severity_score = map_severity_score(&row.category);

        // priority_score weighted blend
        let priority_score = (FREQUENCY_WEIGHT * frequency_score)
            + (COST_WEIGHT * cost_score)
            + (SEVERITY_WEIGHT * severity_score);

        ranked.push(RankedIssue {
            project_id: row.project_id,
            version_id: row.version_id,
            issue_key: format!("{}:{}", row.category, row.subcategory),
            category: row.category,
            subcategory: row.subcategory,
            frequency_score,
            cost_score,
            severity_score,
            priority_score,
            severity: map_severity_label(severity_score),
            event_count: row.event_count,
            affected_run_count: row.affected_run_count,
            failed_run_cost_usd: row.failed_run_cost_usd,
            rank_position: 0,
        });
    }

    let mut grouped: HashMap<(Uuid, Option<Uuid>), Vec<usize>> = HashMap::new();
    for (idx, issue) in ranked.iter().enumerate() {
        grouped
            .entry((issue.project_id, issue.version_id))
            .or_default()
            .push(idx);
    }

    for indices in grouped.values_mut() {
        indices.sort_by(|a, b| {
            ranked[*b]
                .priority_score
                .partial_cmp(&ranked[*a].priority_score)
                .unwrap_or(Ordering::Equal)
                .then_with(|| {
                    ranked[*b]
                        .affected_run_count
                        .cmp(&ranked[*a].affected_run_count)
                })
                .then_with(|| ranked[*a].issue_key.cmp(&ranked[*b].issue_key))
        });

        for (rank, idx) in indices.iter().enumerate() {
            ranked[*idx].rank_position = rank as i32 + 1;
        }
    }

    Ok(ranked)
}

// Batched upsert into issue_rankings.
pub async fn upsert_issue_rankings(
    storage: &Storage,
    target_date: NaiveDate,
    rankings: &[RankedIssue],
) -> Result<(), AgentScopeError> {
    if rankings.is_empty() {
        return Ok(());
    }

    let snapshot_at: NaiveDateTime = target_date
        .and_hms_opt(0, 0, 0)
        .ok_or_else(|| AgentScopeError::Validation("invalid target date".to_string()))?;

    let mut tx =
        storage.pool.begin().await.map_err(|e| {
            AgentScopeError::Storage(format!("failed to begin ranking upsert tx: {e}"))
        })?;

    for chunk in rankings.chunks(500) {
        // SQL query used:
        // INSERT ... ON CONFLICT (project_id, version_id, issue_key, date) DO UPDATE ...
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

        qb.build()
            .execute(&mut *tx)
            .await
            .map_err(|e| AgentScopeError::Storage(format!("failed to upsert rankings: {e}")))?;
    }

    tx.commit()
        .await
        .map_err(|e| AgentScopeError::Storage(format!("failed to commit ranking tx: {e}")))?;

    Ok(())
}
