use std::sync::Arc;

use crate::{ApiError, AppState};

pub async fn check_rate_limit(state: &Arc<AppState>, project_id: &str) -> Result<(), ApiError> {
    let Some(limits) = state.storage.get_project_limits(project_id).await? else {
        return Ok(());
    };

    if let Some(max_runs_per_minute) = limits.max_runs_per_minute {
        let recent_runs = state.storage.count_runs_in_last_minute(project_id).await?;
        if recent_runs >= i64::from(max_runs_per_minute) {
            return Err(ApiError::TooManyRequests(format!(
                "project exceeded max_runs_per_minute ({max_runs_per_minute})"
            )));
        }
    }

    if let Some(max_concurrent_runs) = limits.max_concurrent_runs {
        let current_runs = state.storage.count_concurrent_runs(project_id).await?;
        state
            .storage
            .set_realtime_current_runs(project_id, current_runs)
            .await?;

        if current_runs >= i64::from(max_concurrent_runs) {
            return Err(ApiError::TooManyRequests(format!(
                "project exceeded max_concurrent_runs ({max_concurrent_runs})"
            )));
        }
    }

    Ok(())
}

pub async fn check_token_quota(
    state: &Arc<AppState>,
    project_id: &str,
    incoming_tokens: i64,
) -> Result<(), ApiError> {
    let Some(limits) = state.storage.get_project_limits(project_id).await? else {
        return Ok(());
    };

    let Some(max_tokens_per_day) = limits.max_tokens_per_day else {
        return Ok(());
    };

    let usage = state.storage.get_or_init_realtime_usage(project_id).await?;
    if usage.tokens_today + incoming_tokens > i64::from(max_tokens_per_day) {
        return Err(ApiError::TooManyRequests(format!(
            "project exceeded max_tokens_per_day ({max_tokens_per_day})"
        )));
    }

    Ok(())
}

pub async fn increment_usage(
    state: &Arc<AppState>,
    project_id: &str,
    token_delta: i64,
) -> Result<(), ApiError> {
    let current_runs = state.storage.count_concurrent_runs(project_id).await?;
    state
        .storage
        .increment_realtime_usage(project_id, 0, token_delta, current_runs)
        .await?;

    Ok(())
}
