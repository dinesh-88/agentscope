mod support;

use agentscope_api::app;
use agentscope_storage::Storage;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use chrono::Utc;
use serde_json::json;
use sqlx::PgPool;
use support::{
    jwt_settings, login_token, seed_project, seed_project_api_key, seed_user_with_role,
    with_bearer, TEST_API_KEY,
};
use tower::ServiceExt;

#[sqlx::test(migrations = "../storage/migrations")]
async fn sdk_requests_require_api_key(pool: PgPool) {
    let project_id = seed_project(&pool, "sdk-org", "sdk-project").await;
    seed_project_api_key(&pool, &project_id, TEST_API_KEY).await;

    let router = app(Storage { pool }, jwt_settings());
    let payload = ingest_payload(&project_id);

    let missing_key = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/ingest")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(missing_key.status(), StatusCode::FORBIDDEN);

    let wrong_key = router
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/ingest")
                .header("content-type", "application/json")
                .header("x-agentscope-api-key", "wrong-key")
                .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(wrong_key.status(), StatusCode::FORBIDDEN);
}

#[sqlx::test(migrations = "../storage/migrations")]
async fn ui_requests_require_jwt(pool: PgPool) {
    let project_id = seed_project(&pool, "ui-org", "ui-project").await;
    let org_id: String =
        sqlx::query_scalar("SELECT organization_id::text FROM projects WHERE id = $1::uuid")
            .bind(&project_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    seed_user_with_role(&pool, &org_id, "ui-user@example.com", "member").await;

    let router = app(Storage { pool }, jwt_settings());

    let response = router
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
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    let token = login_token(&router, "ui-user@example.com").await;
    let ok_response = router
        .oneshot(with_bearer(
            Request::builder()
                .method("GET")
                .uri("/v1/runs")
                .body(Body::empty())
                .unwrap(),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(ok_response.status(), StatusCode::OK);
}

#[sqlx::test(migrations = "../storage/migrations")]
async fn sandbox_run_requires_admin_permission(pool: PgPool) {
    let project_id = seed_project(&pool, "sandbox-org", "sandbox-project").await;
    let org_id: String =
        sqlx::query_scalar("SELECT organization_id::text FROM projects WHERE id = $1::uuid")
            .bind(&project_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    seed_user_with_role(&pool, &org_id, "member@example.com", "member").await;

    let router = app(Storage { pool }, jwt_settings());
    let token = login_token(&router, "member@example.com").await;

    let response = router
        .oneshot(with_bearer(
            Request::builder()
                .method("POST")
                .uri("/v1/sandbox/python/run")
                .body(Body::empty())
                .unwrap(),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[sqlx::test(migrations = "../storage/migrations")]
async fn api_key_cannot_ingest_into_another_project(pool: PgPool) {
    let allowed_project = seed_project(&pool, "allowed-org", "allowed-project").await;
    let denied_project = seed_project(&pool, "denied-org", "denied-project").await;
    seed_project_api_key(&pool, &allowed_project, TEST_API_KEY).await;

    let router = app(Storage { pool }, jwt_settings());
    let payload = ingest_payload(&denied_project);

    let response = router
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
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

fn ingest_payload(project_id: &str) -> serde_json::Value {
    let run_id = uuid::Uuid::new_v4().to_string();
    json!({
        "run": {
            "id": run_id,
            "project_id": project_id,
            "workflow_name": "auth_test",
            "agent_name": "tester",
            "status": "running",
            "started_at": Utc::now(),
            "ended_at": null
        },
        "spans": [],
        "artifacts": []
    })
}
