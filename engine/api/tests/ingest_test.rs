use std::net::SocketAddr;

use agentscope_api::app;
use agentscope_storage::Storage;
use chrono::Utc;
use reqwest::StatusCode;
use serde_json::{json, Value};
use sqlx::PgPool;

#[sqlx::test(migrations = "../storage/migrations")]
async fn ingest_over_http_and_query_runs(pool: PgPool) {
    let storage = Storage { pool };
    let router = app(storage);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr: SocketAddr = listener.local_addr().unwrap();

    let server = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });

    let client = reqwest::Client::new();
    let run_id = "33333333-3333-4333-8333-333333333333";

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
          "ended_at": Utc::now()
        }
      ],
      "artifacts": []
    });

    let ingest_response = client
        .post(format!("http://{addr}/v1/ingest"))
        .json(&payload)
        .send()
        .await
        .unwrap();

    assert_eq!(ingest_response.status(), StatusCode::OK);

    let runs_response = client
        .get(format!("http://{addr}/v1/runs"))
        .send()
        .await
        .unwrap();
    assert_eq!(runs_response.status(), StatusCode::OK);

    let runs: Vec<Value> = runs_response.json().await.unwrap();
    assert!(runs.iter().any(|run| run["id"] == run_id));

    server.abort();
}
