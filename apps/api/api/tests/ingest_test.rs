mod support;

use std::net::SocketAddr;

use agentscope_api::app;
use agentscope_storage::Storage;
use chrono::Utc;
use reqwest::StatusCode;
use serde_json::{json, Value};
use sqlx::PgPool;
use support::{jwt_settings, seed_project_api_key, seed_user_with_role, TEST_API_KEY};

#[sqlx::test(migrations = "../storage/migrations")]
async fn ingest_over_http_and_query_runs(pool: PgPool) {
    let org_id = "00000000-0000-4000-8000-000000000000";
    seed_user_with_role(&pool, org_id, "http-user@example.com", "member").await;
    seed_project_api_key(&pool, "00000000-0000-4000-8000-000000000001", TEST_API_KEY).await;

    let storage = Storage { pool: pool.clone() };
    let router = app(storage, jwt_settings());

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr: SocketAddr = listener.local_addr().unwrap();

    let server = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });

    let client = reqwest::Client::new();
    let run_id = "33333333-3333-4333-8333-333333333333";
    let login_response = client
        .post(format!("http://{addr}/v1/auth/login"))
        .json(&json!({
            "email": "http-user@example.com",
            "password": "password123"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(login_response.status(), StatusCode::OK);
    let token = login_response.json::<Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();

    let payload = json!({
      "run": {
        "id": run_id,
        "project_id": "00000000-0000-4000-8000-000000000001",
        "workflow_name": "support_agent",
        "agent_name": "support_bot",
        "status": "running",
        "started_at": Utc::now(),
        "ended_at": null
      },
      "spans": [
        {
          "id": "44444444-4444-4444-8444-444444444444",
          "run_id": run_id,
          "parent_span_id": null,
          "span_type": "llm_call",
          "name": "generate_answer",
          "status": "success",
          "started_at": Utc::now(),
          "ended_at": Utc::now(),
          "provider": "openai",
          "model": "gpt-4o-mini",
          "input_tokens": 200,
          "output_tokens": 100,
          "total_tokens": 300
        }
      ],
      "artifacts": []
    });

    let ingest_response = client
        .post(format!("http://{addr}/v1/ingest"))
        .header("x-agentscope-api-key", TEST_API_KEY)
        .json(&payload)
        .send()
        .await
        .unwrap();

    assert_eq!(ingest_response.status(), StatusCode::OK);

    let runs_response = client
        .get(format!("http://{addr}/v1/runs"))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    assert_eq!(runs_response.status(), StatusCode::OK);

    let runs: Vec<Value> = runs_response.json().await.unwrap();
    assert!(runs.iter().any(|run| run["id"] == run_id));

    let metrics_response = client
        .get(format!("http://{addr}/v1/runs/{run_id}/metrics"))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    assert_eq!(metrics_response.status(), StatusCode::OK);

    let metrics: Value = metrics_response.json().await.unwrap();
    assert_eq!(metrics["input_tokens"], 200);
    assert_eq!(metrics["output_tokens"], 100);
    assert_eq!(metrics["total_tokens"], 300);
    let estimated_cost = metrics["estimated_cost"].as_f64().unwrap();
    assert!((estimated_cost - 0.00009).abs() < 1e-12);

    sqlx::query(
        r#"
        INSERT INTO run_insights (id, run_id, insight_type, severity, message, recommendation)
        VALUES ($1::uuid, $2::uuid, 'duplicate_prompt_lines', 'medium', 'Duplicate lines found.', 'Remove them.')
        "#,
    )
    .bind(uuid::Uuid::new_v4())
    .bind(uuid::Uuid::parse_str(run_id).unwrap())
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"
        INSERT INTO run_root_causes (id, run_id, root_cause_type, confidence, message, evidence, suggested_fix)
        VALUES ($1::uuid, $2::uuid, 'PROVIDER_API_ERROR', 0.91, 'Provider failed.', '{"http_status":503}'::jsonb, 'Retry with backoff.')
        "#,
    )
    .bind(uuid::Uuid::new_v4())
    .bind(uuid::Uuid::parse_str(run_id).unwrap())
    .execute(&pool)
    .await
    .unwrap();

    let insights_response = client
        .get(format!("http://{addr}/v1/runs/{run_id}/insights"))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    assert_eq!(insights_response.status(), StatusCode::OK);

    let insights: Value = insights_response.json().await.unwrap();
    assert_eq!(insights.as_array().unwrap().len(), 1);
    assert_eq!(insights[0]["insight_type"], "duplicate_prompt_lines");

    let root_cause_response = client
        .get(format!("http://{addr}/v1/runs/{run_id}/root-cause"))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    assert_eq!(root_cause_response.status(), StatusCode::OK);

    let root_cause: Value = root_cause_response.json().await.unwrap();
    assert_eq!(root_cause["root_cause_type"], "PROVIDER_API_ERROR");
    assert_eq!(root_cause["evidence"]["http_status"], 503);

    server.abort();
}
