use agentscope_common::errors::AgentScopeError;
use agentscope_storage::Storage;
use chrono::{NaiveDate, NaiveDateTime};
use sqlx::{FromRow, Postgres, QueryBuilder};
use tracing::{info, warn};
use uuid::Uuid;

use crate::llm_client::{IssueInsightPayload, LlmClient};
use crate::scoring::{compute_rankings_for_date, upsert_issue_rankings, RankedIssue};

#[derive(Debug, FromRow)]
struct TopIssueRow {
    project_id: Uuid,
    version_id: Option<Uuid>,
    issue_key: String,
    category: String,
    subcategory: String,
    severity: String,
    priority_score: f64,
    affected_run_count_30d: i64,
    failed_cost_usd_30d: f64,
}

async fn fetch_total_runs(
    storage: &Storage,
    target_date: NaiveDate,
) -> Result<i64, AgentScopeError> {
    sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*)::bigint
        FROM runs
        WHERE DATE(created_at AT TIME ZONE 'UTC') = $1
        "#,
    )
    .bind(target_date)
    .fetch_one(&storage.pool)
    .await
    .map_err(|e| {
        AgentScopeError::Storage(format!("failed to fetch total runs for enrichment: {e}"))
    })
}

async fn fetch_top_issues(
    storage: &Storage,
    target_date: NaiveDate,
    limit: i64,
) -> Result<Vec<TopIssueRow>, AgentScopeError> {
    // SQL query used:
    // Select top-N issue_rankings by priority_score for target_date.
    sqlx::query_as::<_, TopIssueRow>(
        r#"
        SELECT
            project_id,
            version_id,
            issue_key,
            category,
            subcategory,
            severity,
            priority_score,
            affected_run_count_30d,
            failed_cost_usd_30d
        FROM issue_rankings
        WHERE date = $1
        ORDER BY priority_score DESC, affected_run_count_30d DESC, issue_key ASC
        LIMIT $2
        "#,
    )
    .bind(target_date)
    .bind(limit)
    .fetch_all(&storage.pool)
    .await
    .map_err(|e| AgentScopeError::Storage(format!("failed to fetch top issue rankings: {e}")))
}

async fn issue_insight_exists(
    storage: &Storage,
    project_id: Uuid,
    version_id: Option<Uuid>,
    issue_key: &str,
    target_date: NaiveDate,
) -> Result<bool, AgentScopeError> {
    sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM issue_insights
            WHERE project_id = $1
              AND version_id IS NOT DISTINCT FROM $2
              AND issue_key = $3
              AND date = $4
        )
        "#,
    )
    .bind(project_id)
    .bind(version_id)
    .bind(issue_key)
    .bind(target_date)
    .fetch_one(&storage.pool)
    .await
    .map_err(|e| AgentScopeError::Storage(format!("failed to check issue_insights existence: {e}")))
}

async fn insert_issue_insights_batch(
    storage: &Storage,
    target_date: NaiveDate,
    rows: &[(TopIssueRow, IssueInsightPayload)],
) -> Result<(), AgentScopeError> {
    if rows.is_empty() {
        return Ok(());
    }

    let snapshot_at: NaiveDateTime = target_date
        .and_hms_opt(0, 0, 0)
        .ok_or_else(|| AgentScopeError::Validation("invalid target date timestamp".to_string()))?;

    let mut tx = storage
        .begin_tx()
        .await
        .map_err(|e| AgentScopeError::Storage(format!("failed to begin issue_insights tx: {e}")))?;

    for chunk in rows.chunks(200) {
        // SQL query used:
        // INSERT INTO issue_insights ... ON CONFLICT DO NOTHING
        let mut qb: QueryBuilder<'_, Postgres> = QueryBuilder::new(
            r#"
            INSERT INTO issue_insights (
                id,
                project_id,
                version_id,
                issue_key,
                date,
                summary,
                root_cause,
                recommended_fix,
                expected_impact,
                confidence_score,
                created_at
            )
            "#,
        );

        qb.push_values(chunk, |mut b, (issue, insight)| {
            b.push_bind(Uuid::new_v4())
                .push_bind(issue.project_id)
                .push_bind(issue.version_id)
                .push_bind(&issue.issue_key)
                .push_bind(target_date)
                .push_bind(&insight.summary)
                .push_bind(&insight.root_cause)
                .push_bind(&insight.recommended_fix)
                .push_bind(&insight.expected_impact)
                .push_bind(insight.confidence_score)
                .push_bind(snapshot_at);
        });

        qb.push(" ON CONFLICT DO NOTHING");

        qb.build().execute(&mut *tx).await.map_err(|e| {
            AgentScopeError::Storage(format!("failed to insert issue_insights: {e}"))
        })?;
    }

    tx.commit().await.map_err(|e| {
        AgentScopeError::Storage(format!("failed to commit issue_insights tx: {e}"))
    })?;

    Ok(())
}

fn ranking_to_top_issue(r: RankedIssue) -> TopIssueRow {
    TopIssueRow {
        project_id: r.project_id,
        version_id: r.version_id,
        issue_key: r.issue_key,
        category: r.category,
        subcategory: r.subcategory,
        severity: r.severity,
        priority_score: r.priority_score,
        affected_run_count_30d: r.affected_run_count,
        failed_cost_usd_30d: r.failed_run_cost_usd,
    }
}

pub async fn run_issue_pipeline(
    storage: &Storage,
    target_date: NaiveDate,
    top_n: i64,
) -> Result<(), AgentScopeError> {
    // Step 1 + Step 2: fetch data and compute scores in Rust.
    let rankings = compute_rankings_for_date(storage, target_date).await?;

    // Step 3: upsert ranking output.
    upsert_issue_rankings(storage, target_date, &rankings).await?;

    // Step 4: select top issues.
    let mut top_issues = fetch_top_issues(storage, target_date, top_n).await?;
    if top_issues.is_empty() {
        // Fall back to freshly computed in-memory ranking set if issue_rankings table is empty.
        top_issues = rankings
            .into_iter()
            .take(top_n as usize)
            .map(ranking_to_top_issue)
            .collect();
    }
    if top_issues.is_empty() {
        info!(%target_date, "issue pipeline complete: no issues for date");
        return Ok(());
    }

    // Step 5: LLM enrichment (with retries inside client).
    let llm_client = LlmClient::from_env()?;
    let total_runs = fetch_total_runs(storage, target_date).await?;

    let mut enriched_rows: Vec<(TopIssueRow, IssueInsightPayload)> = Vec::new();
    for issue in top_issues {
        // Idempotency: skip if already enriched for this date.
        if issue_insight_exists(
            storage,
            issue.project_id,
            issue.version_id,
            &issue.issue_key,
            target_date,
        )
        .await?
        {
            continue;
        }

        let issue_for_prompt = RankedIssue {
            project_id: issue.project_id,
            version_id: issue.version_id,
            issue_key: issue.issue_key.clone(),
            category: issue.category.clone(),
            subcategory: issue.subcategory.clone(),
            frequency_score: 0.0,
            cost_score: 0.0,
            severity_score: 0.0,
            priority_score: issue.priority_score,
            severity: issue.severity.clone(),
            event_count: 0,
            affected_run_count: issue.affected_run_count_30d,
            failed_run_cost_usd: issue.failed_cost_usd_30d,
            rank_position: 0,
        };

        match llm_client.enrich_issue(&issue_for_prompt, total_runs).await {
            Ok(Some(insight)) => enriched_rows.push((issue, insight)),
            Ok(None) => {
                warn!(
                    issue_key = %issue_for_prompt.issue_key,
                    "skipping issue insight due to invalid or empty LLM response"
                );
            }
            Err(err) => {
                warn!(
                    issue_key = %issue_for_prompt.issue_key,
                    error = %err,
                    "LLM enrichment failed, continuing pipeline"
                );
            }
        }
    }

    // Step 6: persist enrichment output.
    insert_issue_insights_batch(storage, target_date, &enriched_rows).await?;

    info!(
        %target_date,
        enriched_count = enriched_rows.len(),
        "issue pipeline complete"
    );
    Ok(())
}
