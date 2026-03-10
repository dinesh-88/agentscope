mod models;
mod proxy;
mod telemetry;

use std::{env, net::SocketAddr};

use reqwest::Client;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::{
    proxy::{app, AppState},
    telemetry::TelemetryClient,
};

#[tokio::main]
async fn main() {
    init_tracing();

    let openai_api_key =
        env::var("OPENAI_API_KEY").expect("OPENAI_API_KEY must be set before starting the proxy");
    let agentscope_api =
        env::var("AGENTSCOPE_API").unwrap_or_else(|_| "http://localhost:8080".to_string());

    let http_client = Client::builder()
        .build()
        .expect("failed to build reqwest client");

    let app = app(AppState {
        openai_client: http_client.clone(),
        telemetry_client: TelemetryClient::new(http_client, agentscope_api),
        openai_api_key,
    });

    let addr = SocketAddr::from(([127, 0, 0, 1], 4318));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("failed to bind llm proxy");

    info!(%addr, "llm proxy starting");

    axum::serve(listener, app).await.expect("llm proxy crashed");
}

fn init_tracing() {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "agentscope_llm_proxy=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();
}
