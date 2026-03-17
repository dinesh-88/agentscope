use agentscope_api::auth::JwtSettings;
use axum::http::Request;
use sqlx::PgPool;

pub const TEST_JWT_SECRET: &str = "test-jwt-secret";
pub const TEST_API_KEY: &str = "test-project-api-key";

pub fn jwt_settings() -> JwtSettings {
    JwtSettings {
        secret: TEST_JWT_SECRET.to_string(),
        expiry_seconds: 3_600,
        cookie_name: "agentscope_session".to_string(),
        secure_cookies: false,
    }
}

pub async fn seed_project(pool: &PgPool, org_name: &str, project_name: &str) -> String {
    let org_id: String =
        sqlx::query_scalar("INSERT INTO organizations (name) VALUES ($1) RETURNING id::text")
            .bind(org_name)
            .fetch_one(pool)
            .await
            .unwrap();

    sqlx::query_scalar(
        "INSERT INTO projects (organization_id, name) VALUES ($1::uuid, $2) RETURNING id::text",
    )
    .bind(org_id)
    .bind(project_name)
    .fetch_one(pool)
    .await
    .unwrap()
}

pub async fn seed_user_with_role(
    pool: &PgPool,
    organization_id: &str,
    email: &str,
    role: &str,
) -> String {
    let user_id: String = sqlx::query_scalar(
        r#"
        INSERT INTO users (email, password_hash, display_name)
        VALUES ($1, crypt('password123', gen_salt('bf')), 'Test User')
        RETURNING id::text
        "#,
    )
    .bind(email)
    .fetch_one(pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO memberships (user_id, organization_id, role) VALUES ($1::uuid, $2::uuid, $3)",
    )
    .bind(&user_id)
    .bind(organization_id)
    .bind(role)
    .execute(pool)
    .await
    .unwrap();

    user_id
}

pub async fn seed_project_api_key(pool: &PgPool, project_id: &str, raw_key: &str) {
    sqlx::query(
        r#"
        INSERT INTO project_api_keys (project_id, label, key_hash)
        VALUES ($1::uuid, 'test-key', encode(digest($2, 'sha256'), 'hex'))
        "#,
    )
    .bind(project_id)
    .bind(raw_key)
    .execute(pool)
    .await
    .unwrap();

    sqlx::query(
        "UPDATE projects SET api_key_hash = encode(digest($2, 'sha256'), 'hex') WHERE id = $1::uuid",
    )
    .bind(project_id)
    .bind(raw_key)
    .execute(pool)
    .await
    .unwrap();
}

pub async fn login_token(router: &axum::Router, email: &str) -> String {
    use axum::{body::Body, http::StatusCode};
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&serde_json::json!({
                        "email": email,
                        "password": "password123"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice::<serde_json::Value>(&body).unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string()
}

pub fn with_bearer(request: Request<axum::body::Body>, token: &str) -> Request<axum::body::Body> {
    let (mut parts, body) = request.into_parts();
    parts.headers.insert(
        axum::http::header::AUTHORIZATION,
        format!("Bearer {token}").parse().unwrap(),
    );
    Request::from_parts(parts, body)
}
