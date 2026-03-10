mod support;

use std::time::Duration;

use agentscope_api::{app, IngestPayload};
use agentscope_storage::Storage;
use agentscope_trace::{Run, Span};
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use chrono::Utc;
use futures_util::StreamExt;
use serde_json::{json, Value};
use sqlx::PgPool;
use support::{
    jwt_settings, login_token, seed_project, seed_project_api_key, seed_user_with_role,
    TEST_API_KEY,
};
use tower::ServiceExt;

#[sqlx::test(migrations = "../storage/migrations")]
async fn streams_span_created_events_to_multiple_subscribers(pool: PgPool) {
    let project_id = seed_project(&pool, "events-org", "events-project").await;
    let org_id: String =
        sqlx::query_scalar("SELECT organization_id::text FROM projects WHERE id = $1::uuid")
            .bind(&project_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    seed_user_with_role(&pool, &org_id, "events@example.com", "member").await;
    seed_project_api_key(&pool, &project_id, TEST_API_KEY).await;

    let storage = Storage { pool: pool.clone() };
    let router = app(storage, jwt_settings());
    let token = login_token(&router, "events@example.com").await;

    let stream_response_one = router
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/v1/events/stream?access_token={token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(stream_response_one.status(), StatusCode::OK);

    let stream_response_two = router
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/v1/events/stream?access_token={token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(stream_response_two.status(), StatusCode::OK);

    let run_id = uuid::Uuid::new_v4().to_string();
    let span_id = uuid::Uuid::new_v4().to_string();
    let payload = IngestPayload {
        run: Run {
            id: run_id.clone(),
            project_id,
            workflow_name: "live_events".to_string(),
            agent_name: "assistant_agent".to_string(),
            status: "running".to_string(),
            started_at: Utc::now(),
            ended_at: None,
        },
        spans: vec![Span {
            id: span_id.clone(),
            run_id: run_id.clone(),
            parent_span_id: None,
            span_type: "llm".to_string(),
            name: "draft_response".to_string(),
            status: "ok".to_string(),
            started_at: Utc::now(),
            ended_at: None,
            provider: Some("openai".to_string()),
            model: Some("gpt-4o-mini".to_string()),
            input_tokens: Some(10),
            output_tokens: Some(5),
            total_tokens: Some(15),
            estimated_cost: None,
            metadata: Some(json!({"streamed": true})),
        }],
        artifacts: vec![],
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

    let mut stream_one = stream_response_one.into_body().into_data_stream();
    let mut stream_two = stream_response_two.into_body().into_data_stream();

    let chunk_one = tokio::time::timeout(Duration::from_secs(1), stream_one.next())
        .await
        .expect("first subscriber should receive an event immediately")
        .expect("first subscriber stream should yield a chunk")
        .expect("first subscriber chunk should be valid");
    let chunk_two = tokio::time::timeout(Duration::from_secs(1), stream_two.next())
        .await
        .expect("second subscriber should receive an event immediately")
        .expect("second subscriber stream should yield a chunk")
        .expect("second subscriber chunk should be valid");

    let event_one = parse_sse_payload(&chunk_one);
    let event_two = parse_sse_payload(&chunk_two);

    assert_eq!(event_one["type"], "span_created");
    assert_eq!(event_one["span"]["id"], span_id);
    assert_eq!(event_one["span"]["run_id"], run_id);
    assert_eq!(event_one["span"]["metadata"]["streamed"], true);

    assert_eq!(event_two, event_one);
}

fn parse_sse_payload(chunk: &[u8]) -> Value {
    let text = std::str::from_utf8(chunk).unwrap();
    let payload = text
        .lines()
        .find_map(|line| line.strip_prefix("data: "))
        .expect("expected SSE data line");

    serde_json::from_str(payload).unwrap()
}
