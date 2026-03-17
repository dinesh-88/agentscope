use std::sync::Arc;

use agentscope_trace::Run;
use tokio::time::{sleep, Duration};

use crate::{events, AppState, IngestPayload};

use super::loader::DemoTrace;

pub async fn replay_demo_trace(
    state: &Arc<AppState>,
    trace: DemoTrace,
    simulate_live: bool,
) -> Result<Run, crate::ApiError> {
    let payload = IngestPayload {
        run: trace.run.clone(),
        spans: trace.spans.clone(),
        artifacts: trace.artifacts.clone(),
    };

    state.storage.insert_run(&payload.run).await?;

    for span in &payload.spans {
        state.storage.insert_span(span).await?;
        events::publish_span_created(&state.span_events, span);
        if simulate_live {
            sleep(Duration::from_millis(150)).await;
        }
    }

    for artifact in &payload.artifacts {
        state.storage.insert_artifact(artifact).await?;
    }

    if !trace.insights.is_empty() {
        state
            .storage
            .replace_run_insights(&payload.run.id, &trace.insights)
            .await?;
    }

    if !trace.root_causes.is_empty() {
        state
            .storage
            .replace_run_root_causes(&payload.run.id, &trace.root_causes)
            .await?;
    }

    state.storage.update_run_metrics(&payload.run.id).await?;
    Ok(payload.run)
}
