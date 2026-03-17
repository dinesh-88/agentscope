use std::sync::Arc;

use axum::{
    extract::{Extension, State},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{auth::AuthenticatedUser, demo, ApiError, AppState};

#[derive(Debug, Deserialize)]
pub struct DemoRunRequest {
    pub scenario: String,
    #[serde(default = "default_simulate_live")]
    pub simulate_live: bool,
}

#[derive(Debug, Serialize)]
pub struct DemoRunResponse {
    pub status: &'static str,
    pub run_id: String,
}

fn default_simulate_live() -> bool {
    true
}

pub async fn list_scenarios() -> Json<Vec<demo::loader::DemoScenario>> {
    Json(demo::loader::scenarios())
}

pub async fn run_demo(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(payload): Json<DemoRunRequest>,
) -> Result<Json<DemoRunResponse>, ApiError> {
    let (organization_id, _, project_id, _) = state
        .storage
        .get_default_project_for_user(&user.id)
        .await?
        .ok_or_else(|| ApiError::Validation("user has no default project".to_string()))?;

    let trace = demo::loader::load_trace(&payload.scenario)?;
    let trace = demo::loader::materialize_trace(trace, &project_id, &organization_id);
    let run = demo::replay::replay_demo_trace(&state, trace, payload.simulate_live).await?;

    Ok(Json(DemoRunResponse {
        status: "started",
        run_id: run.id,
    }))
}
