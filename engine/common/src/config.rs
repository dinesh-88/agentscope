use std::env;

use crate::errors::AgentScopeError;

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub server_port: u16,
    pub log_level: String,
}

impl Config {
    pub fn from_env() -> Result<Self, AgentScopeError> {
        let database_url = env::var("DATABASE_URL")
            .map_err(|_| AgentScopeError::Config("DATABASE_URL is required".to_string()))?;

        let server_port = env::var("SERVER_PORT")
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(3000);

        let log_level = env::var("LOG_LEVEL").unwrap_or_else(|_| "info".to_string());

        Ok(Self {
            database_url,
            server_port,
            log_level,
        })
    }
}

pub fn init_tracing(level: &str) {
    let filter = tracing_subscriber::EnvFilter::try_new(level)
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));

    tracing_subscriber::fmt().with_env_filter(filter).init();
}
