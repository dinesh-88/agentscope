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
async fn ingest_and_query_runs(pool: PgPool) {
    let project_id = seed_project(&pool, "test-org", "test-project").await;
    let org_id: String =
        sqlx::query_scalar("SELECT organization_id::text FROM projects WHERE id = $1::uuid")
            .bind(&project_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    seed_user_with_role(&pool, &org_id, "viewer@example.com", "member").await;
    seed_project_api_key(&pool, &project_id, TEST_API_KEY).await;

    let storage = Storage { pool: pool.clone() };
    let router = app(storage, jwt_settings());
    let token = login_token(&router, "viewer@example.com").await;

    let run_id = uuid::Uuid::new_v4().to_string();
    let span_id = uuid::Uuid::new_v4().to_string();

    let payload = IngestPayload {
        run: Run {
            id: run_id.clone(),
            project_id,
            organization_id: None,
            user_id: None,
            session_id: None,
            environment: None,
            workflow_name: "customer_support".to_string(),
            agent_name: "assistant_agent".to_string(),
            status: "running".to_string(),
            started_at: Utc::now(),
            ended_at: None,
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
            metadata: Some(json!({"file_path": "/tmp/demo.txt"})),
            error: None,
        }],
        artifacts: vec![Artifact {
            id: "artifact_008_prompt".to_string(),
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
        .header("x-agentscope-api-key", TEST_API_KEY)
        .body(Body::from(serde_json::to_vec(&payload).unwrap()))
        .unwrap();

    let ingest_response = router.clone().oneshot(ingest_request).await.unwrap();
    assert_eq!(ingest_response.status(), StatusCode::OK);

    let runs_response = router
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

    assert_eq!(runs_response.status(), StatusCode::OK);
    let body = runs_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let runs: Vec<Run> = serde_json::from_slice(&body).unwrap();
    assert!(runs.iter().any(|run| run.id == run_id));

    let stored_run = sqlx::query_scalar::<_, String>("SELECT id::text FROM runs WHERE id = $1")
        .bind(&run_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(stored_run, run_id);

    let span_count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM spans WHERE run_id = $1")
        .bind(&run_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(span_count, 1);

    let stored_metadata: serde_json::Value =
        sqlx::query_scalar("SELECT metadata FROM spans WHERE run_id = $1 LIMIT 1")
            .bind(&run_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored_metadata["file_path"], "/tmp/demo.txt");

    sqlx::query(
        r#"
        INSERT INTO run_insights (id, run_id, insight_type, severity, message, recommendation)
        VALUES ($1::uuid, $2, 'prompt_too_large', 'high', 'Prompt is large.', 'Summarize it.')
        "#,
    )
    .bind(uuid::Uuid::new_v4())
    .bind(&run_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"
        INSERT INTO run_root_causes (id, run_id, root_cause_type, confidence, message, evidence, suggested_fix)
        VALUES ($1::uuid, $2, 'TOOL_FAILURE', 0.95, 'Tool failed.', '{"span_id":"demo"}'::jsonb, 'Retry the tool.')
        "#,
    )
    .bind(uuid::Uuid::new_v4())
    .bind(&run_id)
    .execute(&pool)
    .await
    .unwrap();

    let metrics_response = router
        .clone()
        .oneshot(with_bearer(
            Request::builder()
                .method("GET")
                .uri(format!("/v1/runs/{run_id}/metrics"))
                .body(Body::empty())
                .unwrap(),
            &token,
        ))
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
        .oneshot(with_bearer(
            Request::builder()
                .method("GET")
                .uri(format!("/v1/runs/{run_id}/insights"))
                .body(Body::empty())
                .unwrap(),
            &token,
        ))
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
        .oneshot(with_bearer(
            Request::builder()
                .method("GET")
                .uri(format!("/v1/runs/{run_id}/root-cause"))
                .body(Body::empty())
                .unwrap(),
            &token,
        ))
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

#[sqlx::test(migrations = "../storage/migrations")]
async fn search_runs_supports_status_model_agent_tokens_duration_and_time(pool: PgPool) {
    let project_id = seed_project(&pool, "search-org", "search-project").await;
    let org_id: String =
        sqlx::query_scalar("SELECT organization_id::text FROM projects WHERE id = $1::uuid")
            .bind(&project_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    seed_user_with_role(&pool, &org_id, "searcher@example.com", "viewer").await;
    let router = app(Storage { pool: pool.clone() }, jwt_settings());
    let token = login_token(&router, "searcher@example.com").await;

    let run_id = uuid::Uuid::new_v4().to_string();
    let started_at = Utc::now() - chrono::Duration::minutes(5);
    let ended_at = started_at + chrono::Duration::seconds(12);

    sqlx::query(
        r#"
        INSERT INTO runs (
            id, project_id, organization_id, workflow_name, agent_name, status,
            started_at, ended_at, total_input_tokens, total_output_tokens, total_tokens, total_cost_usd
        )
        VALUES ($1, $2::uuid, $3::uuid, 'search_flow', 'planner_agent', 'completed', $4, $5, 400, 200, 600, 0.0)
        "#,
    )
    .bind(&run_id)
    .bind(&project_id)
    .bind(&org_id)
    .bind(started_at)
    .bind(ended_at)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"
        INSERT INTO spans (
            id, run_id, parent_span_id, span_type, name, status, started_at, ended_at,
            provider, model, input_tokens, output_tokens, total_tokens, estimated_cost, context_window,
            context_usage_percent, metadata
        )
        VALUES ($1, $2, null, 'llm', 'search-span', 'ok', $3, $4, 'openai', 'gpt-4o-mini', 400, 200, 600, 0, null, null, '{}'::jsonb)
        "#,
    )
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(&run_id)
    .bind(started_at)
    .bind(ended_at)
    .execute(&pool)
    .await
    .unwrap();

    let uri = format!(
        "/v1/runs/search?status=completed&model=gpt-4o-mini&agent=planner&tokens_min=500&tokens_max=700&duration_min_ms=10000&duration_max_ms=15000&time_from={}&time_to={}",
        urlencoding::encode(&(started_at - chrono::Duration::seconds(1)).to_rfc3339()),
        urlencoding::encode(&(started_at + chrono::Duration::seconds(1)).to_rfc3339()),
    );

    let response = router
        .oneshot(with_bearer(
            Request::builder()
                .method("GET")
                .uri(uri)
                .body(Body::empty())
                .unwrap(),
            &token,
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let runs: Vec<Run> = serde_json::from_slice(&body).unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].id, run_id);
}

#[sqlx::test(migrations = "../storage/migrations")]
async fn ingest_normalizes_error_taxonomy_and_limits_tags(pool: PgPool) {
    let project_id = seed_project(&pool, "normalize-org", "normalize-project").await;
    let org_id: String =
        sqlx::query_scalar("SELECT organization_id::text FROM projects WHERE id = $1::uuid")
            .bind(&project_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    seed_user_with_role(&pool, &org_id, "normalize@example.com", "member").await;
    seed_project_api_key(&pool, &project_id, TEST_API_KEY).await;

    let storage = Storage { pool: pool.clone() };
    let router = app(storage, jwt_settings());

    let run_id = uuid::Uuid::new_v4().to_string();
    let span_id = uuid::Uuid::new_v4().to_string();

    let payload = serde_json::json!({
        "run": {
            "id": run_id,
            "project_id": project_id,
            "workflow_name": "normalize",
            "agent_name": "normalize-agent",
            "status": "failed",
            "started_at": Utc::now(),
            "ended_at": Utc::now(),
            "environment": "production",
            "tags": (0..30).map(|i| format!("tag-{i}-abcdefghijklmnopqrstuvwxyz")).collect::<Vec<_>>()
        },
        "spans": [{
            "id": span_id,
            "run_id": run_id,
            "parent_span_id": null,
            "span_type": "llm",
            "name": "bad-json",
            "status": "failed",
            "started_at": Utc::now(),
            "ended_at": Utc::now(),
            "error": {
                "error_type": "timeout",
                "error_source": "provider",
                "retryable": true,
                "metadata": { "http_status": 504 }
            },
            "evaluation": {
                "success": false,
                "score": 5.0,
                "reason": "x".repeat(3000),
                "evaluator": "rule"
            }
        }],
        "artifacts": []
    });

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

    let (environment, tags): (Option<String>, Option<Vec<String>>) =
        sqlx::query_as("SELECT environment, tags FROM runs WHERE id = $1")
            .bind(&run_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(environment.as_deref(), Some("prod"));
    assert!(tags.as_ref().is_some_and(|values| values.len() == 20));

    let (error_type, error_source, retryable, metadata): (
        Option<String>,
        Option<String>,
        Option<bool>,
        Option<serde_json::Value>,
    ) = sqlx::query_as(
        "SELECT error_type, error_source, retryable, metadata FROM spans WHERE id = $1",
    )
    .bind(&span_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(error_type.as_deref(), Some("timeout"));
    assert_eq!(error_source.as_deref(), Some("provider"));
    assert_eq!(retryable, Some(true));
    assert_eq!(metadata.unwrap()["error_metadata"]["http_status"], 504);

    let evaluation: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT evaluation FROM spans WHERE id = $1")
            .bind(&span_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(evaluation.unwrap()["score"], 1.0);
}

#[sqlx::test(migrations = "../storage/migrations")]
async fn artifact_search_supports_fts_filters_and_validation(pool: PgPool) {
    let project_id = seed_project(&pool, "search-v1-org", "search-v1-project").await;
    let org_id: String =
        sqlx::query_scalar("SELECT organization_id::text FROM projects WHERE id = $1::uuid")
            .bind(&project_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    seed_user_with_role(&pool, &org_id, "artifact-search@example.com", "viewer").await;
    let router = app(Storage { pool: pool.clone() }, jwt_settings());
    let token = login_token(&router, "artifact-search@example.com").await;

    let run_id = uuid::Uuid::new_v4().to_string();
    let span_id = uuid::Uuid::new_v4().to_string();
    let artifact_id = uuid::Uuid::new_v4().to_string();
    let started_at = Utc::now() - chrono::Duration::minutes(1);

    sqlx::query(
        r#"
        INSERT INTO runs (
            id, project_id, organization_id, workflow_name, agent_name, status,
            started_at, ended_at, tags, total_input_tokens, total_output_tokens, total_tokens, total_cost_usd
        )
        VALUES ($1::uuid, $2::uuid, $3::uuid, 'search_workflow', 'search_agent', 'failed', $4, $5, $6, 0, 0, 0, 0.0)
        "#,
    )
    .bind(&run_id)
    .bind(&project_id)
    .bind(&org_id)
    .bind(started_at)
    .bind(Utc::now())
    .bind(vec!["urgent".to_string(), "prod".to_string()])
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"
        INSERT INTO spans (
            id, run_id, parent_span_id, span_type, name, status, started_at, ended_at,
            model, error_type, provider, input_tokens, output_tokens, total_tokens, estimated_cost
        )
        VALUES ($1::uuid, $2::uuid, NULL, 'llm_call', 'response-parse', 'failed', $3, $4, 'gpt-4o', 'invalid_json', 'openai', 0, 0, 0, 0.0)
        "#,
    )
    .bind(&span_id)
    .bind(&run_id)
    .bind(started_at)
    .bind(Utc::now())
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"
        INSERT INTO artifacts (id, run_id, span_id, kind, payload)
        VALUES (
            $1::uuid,
            $2::uuid,
            $3::uuid,
            'llm.response',
            '{"content":"invalid JSON near line 1 column 42"}'::jsonb
        )
        "#,
    )
    .bind(&artifact_id)
    .bind(&run_id)
    .bind(&span_id)
    .execute(&pool)
    .await
    .unwrap();

    let response = router
        .clone()
        .oneshot(with_bearer(
            Request::builder()
                .method("GET")
                .uri("/v1/search?query=invalid%20JSON&error_type=invalid_json&model=gpt-4o&span_type=llm_call&tags=urgent&limit=10&offset=0")
                .body(Body::empty())
                .unwrap(),
            &token,
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let payload: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(payload["total"], 1);
    assert_eq!(payload["results"].as_array().unwrap().len(), 1);
    assert_eq!(payload["results"][0]["run_id"], run_id);
    assert_eq!(payload["results"][0]["span_id"], span_id);
    assert_eq!(payload["results"][0]["artifact_id"], artifact_id);
    assert_eq!(payload["results"][0]["span_type"], "llm_call");
    assert_eq!(payload["results"][0]["error_type"], "invalid_json");
    assert_eq!(payload["results"][0]["model"], "gpt-4o");
    assert!(payload["results"][0]["snippet"]
        .as_str()
        .unwrap()
        .to_lowercase()
        .contains("invalid"));

    let invalid_limit_response = router
        .oneshot(with_bearer(
            Request::builder()
                .method("GET")
                .uri("/v1/search?query=invalid&limit=101")
                .body(Body::empty())
                .unwrap(),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(invalid_limit_response.status(), StatusCode::BAD_REQUEST);
}

#[sqlx::test(migrations = "../storage/migrations")]
async fn project_storage_retention_soft_delete_hides_old_runs(pool: PgPool) {
    let project_id = seed_project(&pool, "retention-org", "retention-project").await;
    let org_id: String =
        sqlx::query_scalar("SELECT organization_id::text FROM projects WHERE id = $1::uuid")
            .bind(&project_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    seed_user_with_role(&pool, &org_id, "retention-admin@example.com", "admin").await;

    let router = app(Storage { pool: pool.clone() }, jwt_settings());
    let token = login_token(&router, "retention-admin@example.com").await;

    let old_run_id = uuid::Uuid::new_v4().to_string();
    let new_run_id = uuid::Uuid::new_v4().to_string();
    let old_started = Utc::now() - chrono::Duration::days(60);
    let new_started = Utc::now() - chrono::Duration::days(2);

    for (run_id, started_at) in [(&old_run_id, old_started), (&new_run_id, new_started)] {
        sqlx::query(
            r#"
            INSERT INTO runs (
                id, project_id, organization_id, workflow_name, agent_name, status,
                started_at, ended_at, total_input_tokens, total_output_tokens, total_tokens, total_cost_usd
            )
            VALUES ($1::uuid, $2::uuid, $3::uuid, 'retention-flow', 'retention-agent', 'completed', $4, $5, 0, 0, 0, 0.0)
            "#,
        )
        .bind(run_id)
        .bind(&project_id)
        .bind(&org_id)
        .bind(started_at)
        .bind(started_at + chrono::Duration::minutes(1))
        .execute(&pool)
        .await
        .unwrap();
    }

    let update_response = router
        .clone()
        .oneshot(with_bearer(
            Request::builder()
                .method("PUT")
                .uri(format!("/v1/projects/{project_id}/storage-settings"))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&serde_json::json!({
                        "retention_days": 30,
                        "store_prompts_responses": true,
                        "compress_old_runs": false,
                        "cleanup_mode": "soft_delete"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(update_response.status(), StatusCode::OK);

    let apply_response = router
        .clone()
        .oneshot(with_bearer(
            Request::builder()
                .method("POST")
                .uri(format!("/v1/projects/{project_id}/storage-settings/apply"))
                .body(Body::empty())
                .unwrap(),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(apply_response.status(), StatusCode::OK);
    let apply_body = apply_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let apply_payload: serde_json::Value = serde_json::from_slice(&apply_body).unwrap();
    assert_eq!(apply_payload["mode"], "soft_delete");
    assert_eq!(apply_payload["affected_runs"], 1);

    let runs_response = router
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
    assert_eq!(runs_response.status(), StatusCode::OK);

    let runs_body = runs_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let runs: Vec<Run> = serde_json::from_slice(&runs_body).unwrap();
    assert!(runs.iter().any(|run| run.id == new_run_id));
    assert!(!runs.iter().any(|run| run.id == old_run_id));
}
