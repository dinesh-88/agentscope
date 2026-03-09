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
use tower::ServiceExt;

#[sqlx::test(migrations = "../storage/migrations")]
async fn ingest_and_query_runs(pool: PgPool) {
    let project_id = seed_project(&pool).await;

    let storage = Storage { pool: pool.clone() };
    let router = app(storage);

    let run_id = uuid::Uuid::new_v4().to_string();
    let span_id = uuid::Uuid::new_v4().to_string();

    let payload = IngestPayload {
        run: Run {
            id: run_id.clone(),
            project_id,
            workflow_name: "customer_support".to_string(),
            agent_name: "assistant_agent".to_string(),
            status: "running".to_string(),
            started_at: Utc::now(),
            ended_at: None,
        },
        spans: vec![Span {
            id: span_id,
            run_id: run_id.clone(),
            parent_span_id: None,
            span_type: "llm".to_string(),
            name: "plan".to_string(),
            status: "ok".to_string(),
            started_at: Utc::now(),
            ended_at: None,
        }],
        artifacts: vec![Artifact {
            id: uuid::Uuid::new_v4().to_string(),
            run_id: run_id.clone(),
            span_id: None,
            kind: "prompt".to_string(),
            payload: json!({"text": "hello"}),
        }],
    };

    let ingest_request = Request::builder()
        .method("POST")
        .uri("/v1/ingest")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&payload).unwrap()))
        .unwrap();

    let ingest_response = router.clone().oneshot(ingest_request).await.unwrap();
    assert_eq!(ingest_response.status(), StatusCode::OK);

    let runs_response = router
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/runs")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(runs_response.status(), StatusCode::OK);
    let body = runs_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let runs: Vec<Run> = serde_json::from_slice(&body).unwrap();
    assert!(runs.iter().any(|run| run.id == run_id));

    let stored_run =
        sqlx::query_scalar::<_, String>("SELECT id::text FROM runs WHERE id = $1::uuid")
            .bind(&run_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored_run, run_id);

    let span_count =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM spans WHERE run_id = $1::uuid")
            .bind(&run_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(span_count, 1);
}

async fn seed_project(pool: &PgPool) -> String {
    let org_id: String = sqlx::query_scalar(
        "INSERT INTO organizations (name) VALUES ('test-org') RETURNING id::text",
    )
    .fetch_one(pool)
    .await
    .unwrap();

    sqlx::query_scalar(
        "INSERT INTO projects (organization_id, name) VALUES ($1::uuid, 'test-project') RETURNING id::text",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .unwrap()
}
