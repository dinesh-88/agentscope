use std::{
    collections::HashMap,
    env,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, Mutex},
};

use axum::{extract::State, Json};
use chrono::Utc;
use serde::Serialize;
use tokio::process::Command;
use tracing::{error, info};

use crate::{ApiError, AppState};

#[derive(Clone)]
pub struct SandboxManager {
    state: Arc<Mutex<HashMap<&'static str, SandboxTargetStatus>>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SandboxStartResponse {
    status: &'static str,
    target: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct SandboxStatusResponse {
    pub python: SandboxTargetStatus,
    pub real: SandboxTargetStatus,
    pub ts: SandboxTargetStatus,
}

#[derive(Debug, Clone, Serialize)]
pub struct SandboxTargetStatus {
    pub target: String,
    pub status: String,
    pub pid: Option<u32>,
    pub last_started_at: Option<String>,
    pub last_finished_at: Option<String>,
    pub last_exit_code: Option<i32>,
    pub last_error: Option<String>,
}

impl SandboxManager {
    pub fn new() -> Self {
        let mut state = HashMap::new();
        state.insert("python", SandboxTargetStatus::idle("python"));
        state.insert("real", SandboxTargetStatus::idle("real"));
        state.insert("ts", SandboxTargetStatus::idle("ts"));
        Self {
            state: Arc::new(Mutex::new(state)),
        }
    }

    pub fn snapshot(&self) -> SandboxStatusResponse {
        let state = self.state.lock().expect("sandbox state lock poisoned");
        SandboxStatusResponse {
            python: state
                .get("python")
                .cloned()
                .unwrap_or_else(|| SandboxTargetStatus::idle("python")),
            real: state
                .get("real")
                .cloned()
                .unwrap_or_else(|| SandboxTargetStatus::idle("real")),
            ts: state
                .get("ts")
                .cloned()
                .unwrap_or_else(|| SandboxTargetStatus::idle("ts")),
        }
    }

    pub async fn start_python(&self) -> Result<SandboxStartResponse, ApiError> {
        let repo_root = sandbox_repo_root();
        self.start_target("python", repo_root.clone(), |command| {
            command.env("PYTHONPATH", pythonpath_for_repo_root(&repo_root));
            command
                .arg("examples/sandbox/python-agent/main.py")
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
        })
        .await
    }

    pub async fn start_real(&self) -> Result<SandboxStartResponse, ApiError> {
        let repo_root = sandbox_repo_root();
        self.start_target("real", repo_root.clone(), |command| {
            command.env("PYTHONPATH", pythonpath_for_repo_root(&repo_root));
            command
                .arg("examples/sandbox/python-agent/real_agent.py")
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
        })
        .await
    }

    pub async fn start_ts(&self) -> Result<SandboxStartResponse, ApiError> {
        self.start_target("ts", sandbox_repo_root(), |command| {
            command
                .arg("examples/sandbox/ts-agent/dist/main.js")
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
        })
        .await
    }

    async fn start_target<F>(
        &self,
        target: &'static str,
        repo_root: PathBuf,
        configure: F,
    ) -> Result<SandboxStartResponse, ApiError>
    where
        F: FnOnce(&mut Command),
    {
        let mut command = match target {
            "python" | "real" => Command::new(resolve_python_command()),
            "ts" => Command::new(resolve_node_command()),
            _ => {
                return Err(ApiError::Validation(format!(
                    "unknown sandbox target {target}"
                )))
            }
        };
        command.current_dir(&repo_root);
        configure(&mut command);

        let child = command.spawn().map_err(|error| {
            ApiError::Storage(format!("failed to start {target} sandbox: {error}"))
        })?;

        self.update_started(target, child.id());

        let state = self.state.clone();
        tokio::spawn(async move {
            let result = child.wait_with_output().await;
            let mut guard = match state.lock() {
                Ok(guard) => guard,
                Err(error) => {
                    error!(target, "sandbox state lock poisoned: {error}");
                    return;
                }
            };

            let status = guard
                .entry(target)
                .or_insert_with(|| SandboxTargetStatus::idle(target));
            status.pid = None;
            status.last_finished_at = Some(Utc::now().to_rfc3339());

            match result {
                Ok(output) => {
                    status.last_exit_code = output.status.code();
                    status.last_error = if output.status.success() {
                        None
                    } else {
                        summarize_process_failure(
                            target,
                            &output.stdout,
                            &output.stderr,
                            output.status.code(),
                        )
                    };
                    status.status = if output.status.success() {
                        "success".to_string()
                    } else {
                        "failed".to_string()
                    };
                    info!(target, code = ?output.status.code(), "sandbox process finished");
                }
                Err(error) => {
                    status.status = "failed".to_string();
                    status.last_exit_code = None;
                    status.last_error = Some(error.to_string());
                    error!(target, "sandbox process wait failed: {error}");
                }
            }
        });

        Ok(SandboxStartResponse {
            status: "started",
            target,
        })
    }

    fn update_started(&self, target: &'static str, pid: Option<u32>) {
        let mut state = self.state.lock().expect("sandbox state lock poisoned");
        let status = state
            .entry(target)
            .or_insert_with(|| SandboxTargetStatus::idle(target));
        status.status = "running".to_string();
        status.pid = pid;
        status.last_started_at = Some(Utc::now().to_rfc3339());
        status.last_finished_at = None;
        status.last_exit_code = None;
        status.last_error = None;
    }
}

fn summarize_process_failure(
    target: &str,
    stdout: &[u8],
    stderr: &[u8],
    exit_code: Option<i32>,
) -> Option<String> {
    let stderr_text = String::from_utf8_lossy(stderr).trim().to_string();
    let stdout_text = String::from_utf8_lossy(stdout).trim().to_string();

    let detail = if !stderr_text.is_empty() {
        stderr_text
    } else if !stdout_text.is_empty() {
        stdout_text
    } else {
        format!(
            "sandbox process exited with code {}",
            exit_code.map_or_else(|| "unknown".to_string(), |code| code.to_string())
        )
    };

    let normalized = detail.replace('\n', " | ");
    Some(format!("{target}: {}", tail_chars(&normalized, 2000)))
}

fn tail_chars(value: &str, max_chars: usize) -> String {
    let char_count = value.chars().count();
    if char_count <= max_chars {
        return value.to_string();
    }

    let tail: String = value
        .chars()
        .skip(char_count.saturating_sub(max_chars))
        .collect();
    format!("...{tail}")
}

impl SandboxTargetStatus {
    fn idle(target: &str) -> Self {
        Self {
            target: target.to_string(),
            status: "idle".to_string(),
            pid: None,
            last_started_at: None,
            last_finished_at: None,
            last_exit_code: None,
            last_error: None,
        }
    }
}

pub async fn run_python(
    State(state): State<Arc<AppState>>,
) -> Result<Json<SandboxStartResponse>, ApiError> {
    Ok(Json(state.sandbox.start_python().await?))
}

pub async fn run_ts(
    State(state): State<Arc<AppState>>,
) -> Result<Json<SandboxStartResponse>, ApiError> {
    Ok(Json(state.sandbox.start_ts().await?))
}

pub async fn run_real(
    State(state): State<Arc<AppState>>,
) -> Result<Json<SandboxStartResponse>, ApiError> {
    Ok(Json(state.sandbox.start_real().await?))
}

pub async fn status(
    State(state): State<Arc<AppState>>,
) -> Result<Json<SandboxStatusResponse>, ApiError> {
    Ok(Json(state.sandbox.snapshot()))
}

fn sandbox_repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .expect("repo root should exist")
        .to_path_buf()
}

fn pythonpath_for_repo_root(repo_root: &Path) -> String {
    let sdk_path = repo_root.join("packages/python-sdk");
    match env::var("PYTHONPATH") {
        Ok(existing) if !existing.is_empty() => format!("{}:{}", sdk_path.display(), existing),
        _ => sdk_path.display().to_string(),
    }
}

fn resolve_python_command() -> String {
    env::var("AGENTSCOPE_SANDBOX_PYTHON")
        .or_else(|_| env::var("PYTHON"))
        .unwrap_or_else(|_| "python3".to_string())
}

fn resolve_node_command() -> String {
    env::var("AGENTSCOPE_SANDBOX_NODE").unwrap_or_else(|_| "node".to_string())
}
