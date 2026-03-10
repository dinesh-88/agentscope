mod support;

use agentscope_api::app;
use agentscope_storage::Storage;
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
async fn register_creates_owner_account_with_project_and_api_key(pool: PgPool) {
    let router = app(Storage { pool: pool.clone() }, jwt_settings());

    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/auth/register")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "email": "new-user@example.com",
                        "password": "password123",
                        "display_name": "New User",
                        "organization_name": "New Org",
                        "project_name": "New Project"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let token = body["token"].as_str().unwrap();
    let project_id = body["project"]["id"].as_str().unwrap();
    let api_key = body["api_key"].as_str().unwrap();

    assert!(!token.is_empty());
    assert!(api_key.starts_with("ags_"));

    let role: String = sqlx::query_scalar(
        r#"
        SELECT memberships.role
        FROM memberships
        INNER JOIN users ON users.id = memberships.user_id
        WHERE users.email = 'new-user@example.com'
        "#,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(role, "owner");

    let stored_project_id: String =
        sqlx::query_scalar("SELECT project_id::text FROM project_api_keys WHERE key_hash = encode(digest($1, 'sha256'), 'hex')")
            .bind(api_key)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored_project_id, project_id);

    let runs_response = router
        .oneshot(with_bearer(
            Request::builder()
                .method("GET")
                .uri("/v1/runs")
                .body(Body::empty())
                .unwrap(),
            token,
        ))
        .await
        .unwrap();
    assert_eq!(runs_response.status(), StatusCode::OK);
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
        .clone()
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

    let invalid_token_response = router
        .oneshot(with_bearer(
            Request::builder()
                .method("GET")
                .uri("/v1/runs")
                .body(Body::empty())
                .unwrap(),
            "not-a-valid-jwt",
        ))
        .await
        .unwrap();
    assert_eq!(invalid_token_response.status(), StatusCode::FORBIDDEN);
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
async fn sandbox_run_allows_owner_permission(pool: PgPool) {
    let project_id = seed_project(&pool, "sandbox-owner-org", "sandbox-owner-project").await;
    let org_id: String =
        sqlx::query_scalar("SELECT organization_id::text FROM projects WHERE id = $1::uuid")
            .bind(&project_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    seed_user_with_role(&pool, &org_id, "owner@example.com", "owner").await;

    let router = app(Storage { pool }, jwt_settings());
    let token = login_token(&router, "owner@example.com").await;

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
    assert_ne!(response.status(), StatusCode::FORBIDDEN);
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
