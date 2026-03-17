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
use serde_json::{json, Value};
use sqlx::PgPool;
use support::{
    jwt_settings, login_token, seed_project, seed_project_api_key, seed_user_with_role,
    with_bearer, TEST_API_KEY,
};
use tower::ServiceExt;

#[sqlx::test(migrations = "../storage/migrations")]
async fn replay_supports_step_modify_resume_and_diff(pool: PgPool) {
    let project_id = seed_project(&pool, "replay-org", "replay-project").await;
    let org_id: String =
        sqlx::query_scalar("SELECT organization_id::text FROM projects WHERE id = $1::uuid")
            .bind(&project_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    seed_user_with_role(&pool, &org_id, "replay@example.com", "member").await;
    seed_project_api_key(&pool, &project_id, TEST_API_KEY).await;
    let storage = Storage { pool: pool.clone() };
    let router = app(storage, jwt_settings());
    let token = login_token(&router, "replay@example.com").await;

    let run_id = uuid::Uuid::new_v4().to_string();
    let llm_span_id = uuid::Uuid::new_v4().to_string();
    let tool_span_id = uuid::Uuid::new_v4().to_string();
    let prompt_artifact_id = uuid::Uuid::new_v4().to_string();

    let payload = IngestPayload {
        run: Run {
            id: run_id.clone(),
            project_id,
            organization_id: None,
            workflow_name: "time_travel_agent".to_string(),
            agent_name: "debugger".to_string(),
            status: "completed".to_string(),
            started_at: Utc::now(),
            ended_at: Some(Utc::now()),
            total_input_tokens: 0,
            total_output_tokens: 0,
            total_tokens: 0,
            total_cost_usd: 0.0,
        },
        spans: vec![
            Span {
                id: llm_span_id.clone(),
                run_id: run_id.clone(),
                parent_span_id: None,
                span_type: "llm_call".to_string(),
                name: "draft_answer".to_string(),
                status: "success".to_string(),
                started_at: Utc::now(),
                ended_at: Some(Utc::now()),
                provider: Some("openai".to_string()),
                model: Some("gpt-4o-mini".to_string()),
                input_tokens: Some(25),
                output_tokens: Some(10),
                total_tokens: Some(35),
                estimated_cost: None,
                context_window: None,
                context_usage_percent: None,
                metadata: None,
            },
            Span {
                id: tool_span_id.clone(),
                run_id: run_id.clone(),
                parent_span_id: None,
                span_type: "tool_call".to_string(),
                name: "save_answer".to_string(),
                status: "success".to_string(),
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
                metadata: None,
            },
        ],
        artifacts: vec![
            Artifact {
                id: prompt_artifact_id,
                run_id: run_id.clone(),
                span_id: Some(llm_span_id.clone()),
                kind: "llm.prompt".to_string(),
                payload: json!({
                    "messages": [
                        {"role": "system", "content": "Answer carefully."},
                        {"role": "user", "content": "Summarize the incident."}
                    ]
                }),
            },
            Artifact {
                id: uuid::Uuid::new_v4().to_string(),
                run_id: run_id.clone(),
                span_id: Some(tool_span_id),
                kind: "tool.result".to_string(),
                payload: json!({"ok": true}),
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

    let start_response = router
        .clone()
        .oneshot(with_bearer(
            Request::builder()
                .method("POST")
                .uri("/v1/replay/start")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({ "original_run_id": run_id })).unwrap(),
                ))
                .unwrap(),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(start_response.status(), StatusCode::OK);
    let start_body = response_json(start_response).await;
    let replay_id = start_body["replay"]["id"].as_str().unwrap().to_string();
    assert_eq!(start_body["total_steps"], 2);
    assert_eq!(start_body["next_step"]["span"]["name"], "draft_answer");
    assert_eq!(start_body["diff"]["modified_artifacts"], json!([]));

    let step_response = router
        .clone()
        .oneshot(with_bearer(
            Request::builder()
                .method("POST")
                .uri(format!("/v1/replay/{replay_id}/step"))
                .body(Body::empty())
                .unwrap(),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(step_response.status(), StatusCode::OK);
    let step_body = response_json(step_response).await;
    assert_eq!(step_body["replay"]["current_step"], 1);
    assert_eq!(step_body["next_step"]["span"]["name"], "save_answer");

    let modified_prompt = json!({
        "messages": [
            {"role": "system", "content": "Answer carefully and include the root cause."},
            {"role": "user", "content": "Summarize the incident in 3 bullets."}
        ]
    });

    let modify_response = router
        .clone()
        .oneshot(with_bearer(
            Request::builder()
                .method("POST")
                .uri(format!("/v1/replay/{replay_id}/modify"))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "span_id": llm_span_id,
                        "kind": "llm.prompt",
                        "payload": modified_prompt
                    }))
                    .unwrap(),
                ))
                .unwrap(),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(modify_response.status(), StatusCode::OK);
    let modify_body = response_json(modify_response).await;
    let forked_run_id = modify_body["forked_run"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    assert_ne!(forked_run_id, run_id);
    assert_eq!(modify_body["active_run_id"], forked_run_id);
    assert_eq!(modify_body["diff"]["replay_run_id"], forked_run_id);
    assert_eq!(
        modify_body["diff"]["modified_artifacts"][0]["replay_payload"],
        modified_prompt
    );

    let replay_rows: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM run_replays WHERE id = $1::uuid")
            .bind(&replay_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(replay_rows, 1);

    let forked_prompt: Value = sqlx::query_scalar(
        "SELECT payload FROM artifacts WHERE run_id = $1 AND kind = 'llm.prompt' LIMIT 1",
    )
    .bind(&forked_run_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(forked_prompt, modified_prompt);

    let resume_response = router
        .oneshot(with_bearer(
            Request::builder()
                .method("POST")
                .uri(format!("/v1/replay/{replay_id}/resume"))
                .body(Body::empty())
                .unwrap(),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(resume_response.status(), StatusCode::OK);
    let resume_body = response_json(resume_response).await;
    assert_eq!(resume_body["replay"]["current_step"], 2);
    assert_eq!(resume_body["next_step"], Value::Null);

    let forked_status: String = sqlx::query_scalar("SELECT status FROM runs WHERE id = $1")
        .bind(&forked_run_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(forked_status, "replay_completed");
}

async fn response_json(response: axum::response::Response) -> Value {
    let body = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&body).unwrap()
}
