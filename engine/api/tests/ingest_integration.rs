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
            provider: Some("openai".to_string()),
            model: Some("gpt-4o-mini".to_string()),
            input_tokens: Some(100),
            output_tokens: Some(50),
            total_tokens: Some(150),
            estimated_cost: None,
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
        .clone()
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

    sqlx::query(
        r#"
        INSERT INTO run_insights (id, run_id, insight_type, severity, message, recommendation)
        VALUES ($1::uuid, $2::uuid, 'prompt_too_large', 'high', 'Prompt is large.', 'Summarize it.')
        "#,
    )
    .bind(uuid::Uuid::new_v4())
    .bind(uuid::Uuid::parse_str(&run_id).unwrap())
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"
        INSERT INTO run_root_causes (id, run_id, root_cause_type, confidence, message, evidence, suggested_fix)
        VALUES ($1::uuid, $2::uuid, 'TOOL_FAILURE', 0.95, 'Tool failed.', '{"span_id":"demo"}'::jsonb, 'Retry the tool.')
        "#,
    )
    .bind(uuid::Uuid::new_v4())
    .bind(uuid::Uuid::parse_str(&run_id).unwrap())
    .execute(&pool)
    .await
    .unwrap();

    let metrics_response = router
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/v1/runs/{run_id}/metrics"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(metrics_response.status(), StatusCode::OK);

    let metrics_body = metrics_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let metrics: serde_json::Value = serde_json::from_slice(&metrics_body).unwrap();

    assert_eq!(metrics["input_tokens"], 100);
    assert_eq!(metrics["output_tokens"], 50);
    assert_eq!(metrics["total_tokens"], 150);
    let estimated_cost = metrics["estimated_cost"].as_f64().unwrap();
    assert!((estimated_cost - 0.000045).abs() < 1e-12);

    let insights_response = router
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/v1/runs/{run_id}/insights"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(insights_response.status(), StatusCode::OK);

    let insights_body = insights_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let insights: serde_json::Value = serde_json::from_slice(&insights_body).unwrap();
    assert_eq!(insights.as_array().unwrap().len(), 1);
    assert_eq!(insights[0]["insight_type"], "prompt_too_large");

    let root_cause_response = router
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/v1/runs/{run_id}/root-cause"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(root_cause_response.status(), StatusCode::OK);

    let root_cause_body = root_cause_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let root_cause: serde_json::Value = serde_json::from_slice(&root_cause_body).unwrap();
    assert_eq!(root_cause["root_cause_type"], "TOOL_FAILURE");
    assert_eq!(root_cause["evidence"]["span_id"], "demo");
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
