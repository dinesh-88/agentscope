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
async fn compare_endpoint_returns_prompt_response_and_metric_diffs(pool: PgPool) {
    let project_id = seed_project(&pool, "compare-org", "compare-project").await;
    let org_id: String =
        sqlx::query_scalar("SELECT organization_id::text FROM projects WHERE id = $1::uuid")
            .bind(&project_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    seed_user_with_role(&pool, &org_id, "compare@example.com", "developer").await;
    seed_project_api_key(&pool, &project_id, TEST_API_KEY).await;

    let storage = Storage { pool: pool.clone() };
    let router = app(storage, jwt_settings());
    let token = login_token(&router, "compare@example.com").await;

    for (prompt, response, input_tokens, output_tokens) in [
        ("Summarize the outage", "Run A response", 120_i64, 40_i64),
        (
            "Summarize the outage in bullets",
            "Run B response",
            220_i64,
            55_i64,
        ),
    ] {
        let run_id = uuid::Uuid::new_v4().to_string();
        let span_id = uuid::Uuid::new_v4().to_string();
        let payload = IngestPayload {
            run: Run {
                id: run_id.clone(),
                project_id: project_id.clone(),
                organization_id: None,
                user_id: None,
                session_id: None,
                environment: None,
                workflow_name: "compare-workflow".to_string(),
                agent_name: "compare-agent".to_string(),
                status: "success".to_string(),
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
            spans: vec![Span {
                id: span_id.clone(),
                run_id: run_id.clone(),
                parent_span_id: None,
                span_type: "llm".to_string(),
                name: "respond".to_string(),
                status: "success".to_string(),
                started_at: Utc::now(),
                ended_at: Some(Utc::now()),
                provider: Some("openai".to_string()),
                model: Some("gpt-4o-mini".to_string()),
                input_tokens: Some(input_tokens),
                output_tokens: Some(output_tokens),
                total_tokens: Some(input_tokens + output_tokens),
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
                metadata: None,
                error: None,
            }],
            artifacts: vec![
                Artifact {
                    id: uuid::Uuid::new_v4().to_string(),
                    run_id: run_id.clone(),
                    span_id: Some(span_id.clone()),
                    kind: "llm.prompt".to_string(),
                    payload: json!({ "messages": [{ "role": "user", "content": prompt }] }),
                },
                Artifact {
                    id: uuid::Uuid::new_v4().to_string(),
                    run_id: run_id.clone(),
                    span_id: Some(span_id),
                    kind: "llm.response".to_string(),
                    payload: json!({ "content": response }),
                },
            ],
        };

        let response = router
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
        assert_eq!(response.status(), StatusCode::OK);

        sqlx::query("INSERT INTO artifacts (id, run_id, span_id, kind, payload) VALUES ($1::uuid, $2::uuid, NULL, 'marker', '{}'::jsonb)")
            .bind(uuid::Uuid::new_v4())
            .bind(&run_id)
            .execute(&pool)
            .await
            .unwrap();
    }

    let run_ids: Vec<String> = sqlx::query_scalar(
        "SELECT id::text FROM runs WHERE workflow_name = 'compare-workflow' ORDER BY started_at ASC",
    )
    .fetch_all(&pool)
    .await
    .unwrap();

    let response = router
        .oneshot(with_bearer(
            Request::builder()
                .method("GET")
                .uri(format!("/v1/runs/{}/compare/{}", run_ids[0], run_ids[1]))
                .body(Body::empty())
                .unwrap(),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let compare: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(compare["summary"]["status_changed"], false);
    assert!(compare["summary"]["token_delta"].as_i64().unwrap() > 0);
    assert_eq!(
        compare["diffs"]["prompts"][0]["run_a"][0],
        "{\"role\":\"user\",\"content\":\"Summarize the outage\"}"
    );
    assert_eq!(
        compare["diffs"]["responses"][0]["run_b"][0],
        "{\n  \"content\": \"Run B response\"\n}"
    );
}

#[sqlx::test(migrations = "../storage/migrations")]
async fn ingest_requires_api_key(pool: PgPool) {
    let storage = Storage { pool };
    let router = app(storage, jwt_settings());

    let response = router
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/ingest")
                .header("content-type", "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}
