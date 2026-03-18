use std::env;

use crate::errors::AgentScopeError;

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub server_port: u16,
    pub log_level: String,
    pub jwt_secret: String,
    pub jwt_expiry_seconds: i64,
    pub secure_cookies: bool,
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
        let jwt_secret = env::var("JWT_SECRET")
            .map_err(|_| AgentScopeError::Config("JWT_SECRET is required".to_string()))?;
        let jwt_expiry_seconds = env::var("JWT_EXPIRY_SECONDS")
            .ok()
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(28_800);
        let secure_cookies = env::var("SECURE_COOKIES")
            .ok()
            .map(|value| matches!(value.to_lowercase().as_str(), "1" | "true" | "yes" | "on"))
            .unwrap_or(false);

        Ok(Self {
            database_url,
            server_port,
            log_level,
            jwt_secret,
            jwt_expiry_seconds,
            secure_cookies,
        })
    }
}

pub fn init_tracing(level: &str) {
    let filter = tracing_subscriber::EnvFilter::try_new(level)
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));

    tracing_subscriber::fmt().with_env_filter(filter).init();
}
