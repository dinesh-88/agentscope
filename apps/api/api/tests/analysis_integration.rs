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
