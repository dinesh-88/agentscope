use thiserror::Error;

#[derive(Debug, Error)]
pub enum AgentScopeError {
    #[error("configuration error: {0}")]
    Config(String),

    #[error("storage error: {0}")]
    Storage(String),

    #[error("validation error: {0}")]
    Validation(String),
}
