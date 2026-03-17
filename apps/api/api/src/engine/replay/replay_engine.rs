use agentscope_common::errors::AgentScopeError;
use agentscope_storage::Storage;
use agentscope_trace::{Artifact, Run, RunReplay, Span};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::engine::replay::step_controller::{ReplayStep, StepController};
use crate::events;

#[derive(Debug, Clone, Deserialize)]
pub struct StartReplayRequest {
    pub original_run_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ModifyReplayRequest {
    pub artifact_id: Option<String>,
    pub span_id: Option<String>,
    pub kind: Option<String>,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReplayArtifactDiff {
    pub artifact_id: String,
    pub original_artifact_id: Option<String>,
    pub span_id: Option<String>,
    pub kind: String,
    pub original_payload: Value,
    pub replay_payload: Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReplayDiff {
    pub original_run_id: String,
    pub replay_run_id: Option<String>,
    pub modified_artifacts: Vec<ReplayArtifactDiff>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReplayResponse {
    pub replay: RunReplay,
    pub active_run_id: String,
    pub total_steps: i32,
    pub next_step: Option<ReplayStep>,
    pub forked_run: Option<Run>,
    pub diff: ReplayDiff,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ReplayState {
    active_run_id: String,
    derived_run_id: Option<String>,
    mode: String,
    status: String,
    total_steps: i32,
    span_id_map: HashMap<String, String>,
    artifact_id_map: HashMap<String, String>,
    modifications: Vec<StoredModification>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredModification {
    artifact_id: String,
    original_artifact_id: Option<String>,
    span_id: Option<String>,
    kind: String,
    original_payload: Value,
    replay_payload: Value,
}

struct ForkedRun {
    run_id: String,
    span_id_map: HashMap<String, String>,
    artifact_id_map: HashMap<String, String>,
}

pub struct ReplayEngine<'a> {
    storage: &'a Storage,
    span_events: Option<broadcast::Sender<events::SpanEvent>>,
}

impl<'a> ReplayEngine<'a> {
    pub fn new_with_events(
        storage: &'a Storage,
        span_events: broadcast::Sender<events::SpanEvent>,
    ) -> Self {
        Self {
            storage,
            span_events: Some(span_events),
        }
    }

    pub async fn start(
        &self,
        request: StartReplayRequest,
    ) -> Result<ReplayResponse, AgentScopeError> {
        let run = self
            .storage
            .get_run(&request.original_run_id)
            .await?
            .ok_or_else(|| {
                AgentScopeError::Validation(format!("run {} not found", request.original_run_id))
            })?;
        let spans = self.storage.get_spans(&run.id).await?;

        let replay = RunReplay {
            id: Uuid::new_v4().to_string(),
            original_run_id: run.id.clone(),
            current_step: 0,
            state: serde_json::to_value(ReplayState {
                active_run_id: run.id.clone(),
                derived_run_id: None,
                mode: "passive".to_string(),
                status: "active".to_string(),
                total_steps: StepController::total_steps(&spans),
                span_id_map: HashMap::new(),
                artifact_id_map: HashMap::new(),
                modifications: Vec::new(),
            })
            .map_err(|e| {
                AgentScopeError::Storage(format!("failed to serialize replay state: {e}"))
            })?,
            created_at: Utc::now(),
        };

        self.storage.insert_run_replay(&replay).await?;
        self.build_response(replay).await
    }

    pub async fn step(&self, replay_id: &str) -> Result<ReplayResponse, AgentScopeError> {
        let mut replay = self.load_replay(replay_id).await?;
        let state = self.parse_state(&replay)?;

        if replay.current_step < state.total_steps {
            replay.current_step += 1;
        }

        let mut next_state = state;
        next_state.mode = "step_execution".to_string();
        if replay.current_step >= next_state.total_steps {
            next_state.status = "completed".to_string();
        }

        replay.state = serde_json::to_value(&next_state).map_err(|e| {
            AgentScopeError::Storage(format!("failed to serialize replay state: {e}"))
        })?;
        self.storage
            .update_run_replay(&replay.id, replay.current_step, &replay.state)
            .await?;

        self.build_response(replay).await
    }

    pub async fn modify(
        &self,
        replay_id: &str,
        request: ModifyReplayRequest,
    ) -> Result<ReplayResponse, AgentScopeError> {
        let mut replay = self.load_replay(replay_id).await?;
        let mut state = self.parse_state(&replay)?;
        let original_run_id = replay.original_run_id.clone();

        let derived_run_id = match &state.derived_run_id {
            Some(run_id) => run_id.clone(),
            None => {
                let forked = self.fork_run(&original_run_id, &request).await?;
                state.derived_run_id = Some(forked.run_id.clone());
                state.active_run_id = forked.run_id.clone();
                state.span_id_map = forked.span_id_map;
                state.artifact_id_map = forked.artifact_id_map;
                forked.run_id
            }
        };

        let translated_request = self.translate_modify_request(&state, &request);
        let modified = self
            .apply_modification(&derived_run_id, &translated_request)
            .await?;

        if let Some(existing) = state
            .modifications
            .iter_mut()
            .find(|entry| entry.artifact_id == modified.artifact_id)
        {
            *existing = modified;
        } else {
            state.modifications.push(modified);
        }

        state.mode = "forked_replay".to_string();
        state.status = "forked".to_string();
        replay.state = serde_json::to_value(&state).map_err(|e| {
            AgentScopeError::Storage(format!("failed to serialize replay state: {e}"))
        })?;

        self.storage
            .update_run_replay(&replay.id, replay.current_step, &replay.state)
            .await?;

        self.build_response(replay).await
    }

    pub async fn resume(&self, replay_id: &str) -> Result<ReplayResponse, AgentScopeError> {
        let mut replay = self.load_replay(replay_id).await?;
        let mut state = self.parse_state(&replay)?;
        replay.current_step = state.total_steps;
        state.status = "completed".to_string();
        if state.derived_run_id.is_some() {
            state.mode = "forked_replay".to_string();
        }

        replay.state = serde_json::to_value(&state).map_err(|e| {
            AgentScopeError::Storage(format!("failed to serialize replay state: {e}"))
        })?;
        self.storage
            .update_run_replay(&replay.id, replay.current_step, &replay.state)
            .await?;

        if let Some(mut forked_run) = self.storage.get_run(&state.active_run_id).await? {
            if forked_run.id != replay.original_run_id {
                forked_run.status = "replay_completed".to_string();
                forked_run.ended_at = Some(Utc::now());
                self.storage.insert_run(&forked_run).await?;
            }
        }

        self.build_response(replay).await
    }

    async fn build_response(&self, replay: RunReplay) -> Result<ReplayResponse, AgentScopeError> {
        let state = self.parse_state(&replay)?;
        let spans = self.storage.get_spans(&state.active_run_id).await?;
        let artifacts = self.storage.get_artifacts(&state.active_run_id).await?;
        let next_step = if replay.current_step < state.total_steps {
            StepController::step(&spans, &artifacts, replay.current_step)
        } else {
            None
        };
        let forked_run = match state.derived_run_id.as_deref() {
            Some(run_id) => self.storage.get_run(run_id).await?,
            None => None,
        };

        Ok(ReplayResponse {
            replay: RunReplay {
                id: replay.id.clone(),
                original_run_id: replay.original_run_id.clone(),
                current_step: replay.current_step,
                state: replay.state.clone(),
                created_at: replay.created_at,
            },
            active_run_id: state.active_run_id.clone(),
            total_steps: state.total_steps,
            next_step,
            forked_run,
            diff: ReplayDiff {
                original_run_id: replay.original_run_id.clone(),
                replay_run_id: state.derived_run_id.clone(),
                modified_artifacts: state
                    .modifications
                    .into_iter()
                    .map(|entry| ReplayArtifactDiff {
                        artifact_id: entry.artifact_id,
                        original_artifact_id: entry.original_artifact_id,
                        span_id: entry.span_id,
                        kind: entry.kind,
                        original_payload: entry.original_payload,
                        replay_payload: entry.replay_payload,
                    })
                    .collect(),
            },
        })
    }

    async fn load_replay(&self, replay_id: &str) -> Result<RunReplay, AgentScopeError> {
        self.storage
            .get_run_replay(replay_id)
            .await?
            .ok_or_else(|| AgentScopeError::Validation(format!("replay {replay_id} not found")))
    }

    fn parse_state(&self, replay: &RunReplay) -> Result<ReplayState, AgentScopeError> {
        serde_json::from_value(replay.state.clone())
            .map_err(|e| AgentScopeError::Storage(format!("failed to parse replay state: {e}")))
    }

    async fn fork_run(
        &self,
        original_run_id: &str,
        request: &ModifyReplayRequest,
    ) -> Result<ForkedRun, AgentScopeError> {
        let original_run = self
            .storage
            .get_run(original_run_id)
            .await?
            .ok_or_else(|| {
                AgentScopeError::Validation(format!("run {original_run_id} not found"))
            })?;
        let original_spans = self.storage.get_spans(original_run_id).await?;
        let original_artifacts = self.storage.get_artifacts(original_run_id).await?;

        self.find_target_artifact(&original_artifacts, request)?;

        let derived_run_id = Uuid::new_v4().to_string();
        let derived_run = Run {
            id: derived_run_id.clone(),
            project_id: original_run.project_id,
            organization_id: original_run.organization_id,
            workflow_name: format!("{} [replay]", original_run.workflow_name),
            agent_name: original_run.agent_name,
            status: "replay_forked".to_string(),
            started_at: Utc::now(),
            ended_at: None,
            total_input_tokens: 0,
            total_output_tokens: 0,
            total_tokens: 0,
            total_cost_usd: 0.0,
        };
        self.storage.insert_run(&derived_run).await?;

        let mut span_map = HashMap::new();
        for span in original_spans {
            let new_id = Uuid::new_v4().to_string();
            span_map.insert(span.id.clone(), new_id);
        }

        let spans = self.storage.get_spans(original_run_id).await?;
        for span in spans {
            let cloned_span = Span {
                id: span_map.get(&span.id).cloned().ok_or_else(|| {
                    AgentScopeError::Storage("missing cloned span id".to_string())
                })?,
                run_id: derived_run_id.clone(),
                parent_span_id: span
                    .parent_span_id
                    .as_ref()
                    .and_then(|parent_id| span_map.get(parent_id))
                    .cloned(),
                span_type: span.span_type,
                name: span.name,
                status: span.status,
                started_at: span.started_at,
                ended_at: span.ended_at,
                provider: span.provider,
                model: span.model,
                input_tokens: span.input_tokens,
                output_tokens: span.output_tokens,
                total_tokens: span.total_tokens,
                estimated_cost: span.estimated_cost,
                context_window: span.context_window,
                context_usage_percent: span.context_usage_percent,
                metadata: span.metadata,
            };
            self.storage.insert_span(&cloned_span).await?;
            if let Some(sender) = &self.span_events {
                events::publish_span_created(sender, &cloned_span);
            }
        }

        let mut artifact_map = HashMap::new();
        for artifact in original_artifacts {
            let new_id = Uuid::new_v4().to_string();
            artifact_map.insert(artifact.id.clone(), new_id.clone());
            let cloned_artifact = Artifact {
                id: new_id,
                run_id: derived_run_id.clone(),
                span_id: artifact
                    .span_id
                    .as_ref()
                    .and_then(|span_id| span_map.get(span_id))
                    .cloned(),
                kind: artifact.kind,
                payload: artifact.payload,
            };
            self.storage.insert_artifact(&cloned_artifact).await?;
        }

        self.storage
            .insert_artifact(&Artifact {
                id: Uuid::new_v4().to_string(),
                run_id: derived_run_id.clone(),
                span_id: None,
                kind: "replay.origin".to_string(),
                payload: json!({
                    "original_run_id": original_run_id,
                    "derived_from_replay": true
                }),
            })
            .await?;

        Ok(ForkedRun {
            run_id: derived_run_id,
            span_id_map: span_map,
            artifact_id_map: artifact_map,
        })
    }

    async fn apply_modification(
        &self,
        run_id: &str,
        request: &ModifyReplayRequest,
    ) -> Result<StoredModification, AgentScopeError> {
        let artifacts = self.storage.get_artifacts(run_id).await?;
        let target = self.find_target_artifact(&artifacts, request)?.clone();

        let updated_artifact = Artifact {
            id: target.id.clone(),
            run_id: target.run_id.clone(),
            span_id: target.span_id.clone(),
            kind: target.kind.clone(),
            payload: request.payload.clone(),
        };
        self.storage.insert_artifact(&updated_artifact).await?;

        let original_artifact_id = artifacts
            .iter()
            .find(|artifact| artifact.id == target.id)
            .and_then(|artifact| {
                artifact
                    .payload
                    .get("replay_origin_artifact_id")
                    .and_then(Value::as_str)
                    .map(ToString::to_string)
            });

        Ok(StoredModification {
            artifact_id: updated_artifact.id,
            original_artifact_id,
            span_id: updated_artifact.span_id,
            kind: updated_artifact.kind,
            original_payload: target.payload,
            replay_payload: request.payload.clone(),
        })
    }

    fn find_target_artifact<'b>(
        &self,
        artifacts: &'b [Artifact],
        request: &ModifyReplayRequest,
    ) -> Result<&'b Artifact, AgentScopeError> {
        artifacts
            .iter()
            .find(|artifact| {
                request
                    .artifact_id
                    .as_deref()
                    .is_some_and(|artifact_id| artifact.id == artifact_id)
                    || request.span_id.as_deref().is_some_and(|span_id| {
                        artifact.span_id.as_deref() == Some(span_id)
                            && match request.kind.as_deref() {
                                Some(kind) => artifact.kind == kind,
                                None => true,
                            }
                    })
                    || (request.artifact_id.is_none()
                        && request.span_id.is_none()
                        && request
                            .kind
                            .as_deref()
                            .is_some_and(|kind| artifact.kind == kind))
            })
            .ok_or_else(|| AgentScopeError::Validation("target artifact not found".to_string()))
    }

    fn translate_modify_request(
        &self,
        state: &ReplayState,
        request: &ModifyReplayRequest,
    ) -> ModifyReplayRequest {
        ModifyReplayRequest {
            artifact_id: request.artifact_id.as_ref().map(|artifact_id| {
                state
                    .artifact_id_map
                    .get(artifact_id)
                    .cloned()
                    .unwrap_or_else(|| artifact_id.clone())
            }),
            span_id: request.span_id.as_ref().map(|span_id| {
                state
                    .span_id_map
                    .get(span_id)
                    .cloned()
                    .unwrap_or_else(|| span_id.clone())
            }),
            kind: request.kind.clone(),
            payload: request.payload.clone(),
        }
    }
}
