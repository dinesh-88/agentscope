mod support;

use agentscope_api::{app, IngestPayload};
use agentscope_storage::Storage;
use agentscope_trace::{Artifact, Run, Span};
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use chrono::Utc;
use http_body_util::BodyExt;
use serde_json::json;
use sqlx::PgPool;
use support::{
    jwt_settings, login_token, seed_project, seed_project_api_key, seed_user_with_role,
    with_bearer, TEST_API_KEY,
};
use tower::ServiceExt;

#[sqlx::test(migrations = "../storage/migrations")]
async fn computes_run_analysis_and_project_insights(pool: PgPool) {
    let project_id = seed_project(&pool, "analysis-org", "analysis-project").await;
    let org_id: String =
        sqlx::query_scalar("SELECT organization_id::text FROM projects WHERE id = $1::uuid")
            .bind(&project_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    seed_user_with_role(&pool, &org_id, "analysis@example.com", "member").await;
    seed_project_api_key(&pool, &project_id, TEST_API_KEY).await;

    let storage = Storage { pool: pool.clone() };
    let router = app(storage, jwt_settings());
    let token = login_token(&router, "analysis@example.com").await;

    let run_id = uuid::Uuid::new_v4().to_string();
    let llm_span_id = uuid::Uuid::new_v4().to_string();
    let tool_span_id = uuid::Uuid::new_v4().to_string();

    let payload = IngestPayload {
        run: Run {
            id: run_id.clone(),
            project_id: project_id.clone(),
            organization_id: None,
            user_id: None,
            session_id: None,
            environment: None,
            workflow_name: "diagnostics".to_string(),
            agent_name: "ops-agent".to_string(),
            status: "completed".to_string(),
            started_at: Utc::now(),
            ended_at: Some(Utc::now()),
            total_input_tokens: 0,
            total_output_tokens: 0,
            total_tokens: 0,
            total_cost_usd: 0.0,
            success: None,
            error_count: None,
            avg_latency_ms: None,
            p95_latency_ms: None,
            success_rate: None,
            tags: None,
            experiment_id: None,
            variant: None,
            metadata: None,
        },
        spans: vec![
            Span {
                id: llm_span_id.clone(),
                run_id: run_id.clone(),
                parent_span_id: None,
                span_type: "llm".to_string(),
                name: "planner".to_string(),
                status: "error".to_string(),
                started_at: Utc::now(),
                ended_at: Some(Utc::now()),
                provider: Some("openai".to_string()),
                model: Some("gpt-4o".to_string()),
                input_tokens: Some(130_000),
                output_tokens: Some(500),
                total_tokens: Some(130_500),
                estimated_cost: Some(0.09),
                context_window: None,
                context_usage_percent: None,
                latency_ms: None,
                success: None,
                error_type: None,
                error_source: None,
                retryable: None,
                prompt_hash: None,
                prompt_template_id: None,
                temperature: None,
                top_p: None,
                max_tokens: None,
                retry_attempt: None,
                max_attempts: None,
                tool_name: None,
                tool_version: None,
                tool_latency_ms: None,
                tool_success: None,
                evaluation: None,
                metadata: None,
                error: None,
            },
            Span {
                id: tool_span_id.clone(),
                run_id: run_id.clone(),
                parent_span_id: None,
                span_type: "tool_call".to_string(),
                name: "fetch_customer".to_string(),
                status: "failed".to_string(),
                started_at: Utc::now(),
                ended_at: Some(Utc::now()),
                provider: None,
                model: None,
                input_tokens: None,
                output_tokens: None,
                total_tokens: None,
                estimated_cost: None,
                context_window: None,
                context_usage_percent: None,
                latency_ms: None,
                success: None,
                error_type: None,
                error_source: None,
                retryable: None,
                prompt_hash: None,
                prompt_template_id: None,
                temperature: None,
                top_p: None,
                max_tokens: None,
                retry_attempt: None,
                max_attempts: None,
                tool_name: None,
                tool_version: None,
                tool_latency_ms: None,
                tool_success: None,
                evaluation: None,
                metadata: Some(json!({"timed_out": false})),
                error: None,
            },
        ]
        .into_iter()
        .chain((0..9).map(|index| Span {
            id: uuid::Uuid::new_v4().to_string(),
            run_id: run_id.clone(),
            parent_span_id: None,
            span_type: "llm".to_string(),
            name: format!("extra-llm-{index}"),
            status: "ok".to_string(),
            started_at: Utc::now(),
            ended_at: Some(Utc::now()),
            provider: Some("openai".to_string()),
            model: Some("gpt-4o".to_string()),
            input_tokens: Some(500),
            output_tokens: Some(100),
            total_tokens: Some(600),
            estimated_cost: Some(0.01),
            context_window: None,
            context_usage_percent: None,
            latency_ms: None,
            success: None,
            error_type: None,
            error_source: None,
            retryable: None,
            prompt_hash: None,
            prompt_template_id: None,
            temperature: None,
            top_p: None,
            max_tokens: None,
            retry_attempt: None,
            max_attempts: None,
            tool_name: None,
            tool_version: None,
            tool_latency_ms: None,
            tool_success: None,
            evaluation: None,
            metadata: None,
            error: None,
        }))
        .collect(),
        artifacts: vec![
            Artifact {
                id: "artifact_008_llm_error".to_string(),
                run_id: run_id.clone(),
                span_id: Some(llm_span_id),
                kind: "error".to_string(),
                payload: json!({
                    "message": "maximum context length exceeded",
                    "status_code": 400
                }),
            },
            Artifact {
                id: "artifact_008_tool_error".to_string(),
                run_id: run_id.clone(),
                span_id: Some(tool_span_id),
                kind: "tool.error".to_string(),
                payload: json!({
                    "message": "tool process exited with code 1"
                }),
            },
        ],
    };

    let ingest_response = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/ingest")
                .header("content-type", "application/json")
                .header("x-agentscope-api-key", TEST_API_KEY)
                .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(ingest_response.status(), StatusCode::OK);

    let analysis_response = router
        .clone()
        .oneshot(with_bearer(
            Request::builder()
                .method("GET")
                .uri(format!("/v1/runs/{run_id}/analysis"))
                .body(Body::empty())
                .unwrap(),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(analysis_response.status(), StatusCode::OK);

    let analysis_body = analysis_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let analysis: serde_json::Value = serde_json::from_slice(&analysis_body).unwrap();
    assert_eq!(analysis["root_cause_category"], "PROMPT_TOO_LARGE");
    assert!(analysis["failure_types"]
        .as_array()
        .unwrap()
        .iter()
        .any(|value| value == "TOKEN_OVERFLOW"));

    let stored_category: String =
        sqlx::query_scalar("SELECT root_cause_category FROM run_analysis WHERE run_id = $1")
            .bind(&run_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored_category, "PROMPT_TOO_LARGE");

    let project_insights_response = router
        .oneshot(with_bearer(
            Request::builder()
                .method("GET")
                .uri(format!("/v1/projects/{project_id}/insights"))
                .body(Body::empty())
                .unwrap(),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(project_insights_response.status(), StatusCode::OK);

    let project_insights_body = project_insights_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let project_insights: serde_json::Value =
        serde_json::from_slice(&project_insights_body).unwrap();
    let insight_types = project_insights
        .as_array()
        .unwrap()
        .iter()
        .map(|value| value["insight_type"].as_str().unwrap())
        .collect::<std::collections::HashSet<_>>();

    assert!(insight_types.contains("PROMPT_TOO_LARGE"));
    assert!(insight_types.contains("EXPENSIVE_MODEL"));
    assert!(insight_types.contains("TOO_MANY_LLM_CALLS"));
    assert!(insight_types.contains("TOOL_FAILURE_RATE"));

    let persisted_insights: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM project_insights WHERE project_id = $1::uuid")
            .bind(&project_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(persisted_insights >= 4);
}

#[sqlx::test(migrations = "../storage/migrations")]
async fn generates_run_explanation_and_project_trend_report(pool: PgPool) {
    let project_id = seed_project(&pool, "trends-org", "trends-project").await;
    let org_id: String =
        sqlx::query_scalar("SELECT organization_id::text FROM projects WHERE id = $1::uuid")
            .bind(&project_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    seed_user_with_role(&pool, &org_id, "trends@example.com", "member").await;
    seed_project_api_key(&pool, &project_id, TEST_API_KEY).await;

    let storage = Storage { pool: pool.clone() };
    let router = app(storage, jwt_settings());
    let token = login_token(&router, "trends@example.com").await;

    let now = Utc::now();
    let baseline_start = now - chrono::Duration::hours(48);
    let baseline_end = now - chrono::Duration::hours(24);
    let current_start = now - chrono::Duration::hours(24);
    let current_end = now;

    let explained_run_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        r#"
        INSERT INTO runs (
            id, project_id, organization_id, workflow_name, agent_name, status,
            started_at, ended_at, total_input_tokens, total_output_tokens, total_tokens, total_cost_usd
        )
        VALUES ($1, $2::uuid, $3::uuid, 'exp_flow', 'exp_agent', 'failed', $4, $5, 100, 50, 150, 0.35)
        "#,
    )
    .bind(&explained_run_id)
    .bind(&project_id)
    .bind(&org_id)
    .bind(current_start + chrono::Duration::hours(1))
    .bind(current_start + chrono::Duration::hours(1) + chrono::Duration::seconds(20))
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"
        INSERT INTO run_insights (
            id, run_id, insight_type, severity, message, recommendation, evidence, impact_score
        )
        VALUES (
            $1::uuid, $2::uuid, 'COST_REGRESSION', 'high',
            'Run cost is above baseline.',
            'Use a cheaper model for simple prompts.',
            '{}'::jsonb,
            92.0
        )
        "#,
    )
    .bind(uuid::Uuid::new_v4())
    .bind(&explained_run_id)
    .execute(&pool)
    .await
    .unwrap();

    for index in 0..3 {
        let run_id = uuid::Uuid::new_v4().to_string();
        let started_at = baseline_start + chrono::Duration::hours(index * 2);
        let ended_at = started_at + chrono::Duration::seconds(2);
        sqlx::query(
            r#"
            INSERT INTO runs (
                id, project_id, organization_id, workflow_name, agent_name, status,
                started_at, ended_at, total_input_tokens, total_output_tokens, total_tokens, total_cost_usd, variant
            )
            VALUES ($1, $2::uuid, $3::uuid, 'flow', 'planner', 'completed', $4, $5, 100, 50, 150, 0.01, 'v1')
            "#,
        )
        .bind(&run_id)
        .bind(&project_id)
        .bind(&org_id)
        .bind(started_at)
        .bind(ended_at)
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            r#"
            INSERT INTO spans (
                id, run_id, parent_span_id, span_type, name, status, started_at, ended_at,
                provider, model, input_tokens, output_tokens, total_tokens, estimated_cost,
                prompt_hash, latency_ms, metadata
            )
            VALUES ($1, $2, null, 'llm', 'baseline-span', 'ok', $3, $4, 'openai', 'gpt-4o-mini', 100, 50, 150, 0.01, 'hash-a', 2000, '{}'::jsonb)
            "#,
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(&run_id)
        .bind(started_at)
        .bind(ended_at)
        .execute(&pool)
        .await
        .unwrap();
    }

    for index in 0..4 {
        let run_id = uuid::Uuid::new_v4().to_string();
        let started_at = current_start + chrono::Duration::hours(index * 2);
        let ended_at = started_at + chrono::Duration::seconds(10 + index as i64 * 2);
        let status = if index < 3 { "failed" } else { "completed" };
        let variant = if index < 3 { "v2" } else { "v1" };

        sqlx::query(
            r#"
            INSERT INTO runs (
                id, project_id, organization_id, workflow_name, agent_name, status,
                started_at, ended_at, total_input_tokens, total_output_tokens, total_tokens, total_cost_usd, variant
            )
            VALUES ($1, $2::uuid, $3::uuid, 'flow', 'planner', $4, $5, $6, 500, 300, 800, 0.08, $7)
            "#,
        )
        .bind(&run_id)
        .bind(&project_id)
        .bind(&org_id)
        .bind(status)
        .bind(started_at)
        .bind(ended_at)
        .bind(variant)
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            r#"
            INSERT INTO spans (
                id, run_id, parent_span_id, span_type, name, status, started_at, ended_at,
                provider, model, input_tokens, output_tokens, total_tokens, estimated_cost,
                prompt_hash, latency_ms, error_type, metadata
            )
            VALUES ($1, $2, null, 'llm', 'current-span', $3, $4, $5, 'openai', 'gpt-4o', 500, 300, 800, 0.08, 'hash-a', 12000, 'timeout', '{}'::jsonb)
            "#,
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(&run_id)
        .bind(if status == "failed" { "error" } else { "ok" })
        .bind(started_at)
        .bind(ended_at)
        .execute(&pool)
        .await
        .unwrap();
    }

    let explanation_response = router
        .clone()
        .oneshot(with_bearer(
            Request::builder()
                .method("GET")
                .uri(format!("/v1/runs/{explained_run_id}/explanation"))
                .body(Body::empty())
                .unwrap(),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(explanation_response.status(), StatusCode::OK);

    let explanation_body = explanation_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let explanation: serde_json::Value = serde_json::from_slice(&explanation_body).unwrap();
    assert_eq!(explanation["run_id"], explained_run_id);
    assert!(explanation["summary"]
        .as_str()
        .unwrap()
        .contains("top risk"));
    assert_eq!(
        explanation["next_action"],
        "Use a cheaper model for simple prompts."
    );

    let trends_uri = format!(
        "/v1/projects/{project_id}/trends?start={}&end={}&baseline_start={}&baseline_end={}",
        urlencoding::encode(&current_start.to_rfc3339()),
        urlencoding::encode(&current_end.to_rfc3339()),
        urlencoding::encode(&baseline_start.to_rfc3339()),
        urlencoding::encode(&baseline_end.to_rfc3339()),
    );
    let trends_response = router
        .oneshot(with_bearer(
            Request::builder()
                .method("GET")
                .uri(trends_uri)
                .body(Body::empty())
                .unwrap(),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(trends_response.status(), StatusCode::OK);

    let trends_body = trends_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let report: serde_json::Value = serde_json::from_slice(&trends_body).unwrap();
    let trends = report["trends"].as_array().unwrap();
    assert!(!trends.is_empty());
    assert!(trends
        .iter()
        .any(|trend| trend["trend_type"] == "failure_rate"));
    assert!(trends.iter().any(|trend| trend["trend_type"] == "latency"));
    assert!(trends.iter().any(|trend| trend["trend_type"] == "cost"));
    assert!(trends
        .iter()
        .any(|trend| trend["trend_type"] == "prompt_regression"));
    assert!(trends
        .iter()
        .any(|trend| trend["trend_type"] == "variant_regression"));
}
