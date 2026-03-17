use std::net::SocketAddr;

use agentscope_api::{app, auth::JwtSettings};
use agentscope_common::config::{init_tracing, Config};
use agentscope_storage::Storage;
use tracing::info;

#[tokio::main]
async fn main() {
    let config = Config::from_env().expect("failed to read configuration");
    init_tracing(&config.log_level);

    let storage = Storage::connect(&config.database_url)
        .await
        .expect("failed to connect storage");
    storage
        .run_migrations()
        .await
        .expect("failed to run migrations");

    let addr = SocketAddr::from(([0, 0, 0, 0], config.server_port));
    info!(%addr, "api server starting");

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("failed to bind server port");

    axum::serve(
        listener,
        app(
            storage,
            JwtSettings {
                secret: config.jwt_secret.clone(),
                expiry_seconds: config.jwt_expiry_seconds,
                cookie_name: "agentscope_session".to_string(),
                secure_cookies: false,
            },
        ),
    )
    .await
    .expect("api server crashed");
}
