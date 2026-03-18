mod alert_monitor;
mod finalize_run;
mod prompt_analyzer;
mod rca_analyzer;
mod usage_aggregator;

use agentscope_common::config::{init_tracing, Config};
use agentscope_storage::Storage;
use tokio::time::{self, Duration};
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

    if let Ok(run_id) = std::env::var("FINALIZE_RUN_ID") {
        finalize_run::finalize_run(&storage, &run_id, "completed")
            .await
            .expect("failed to finalize run");
    }

    let analyze_completed_runs =
        std::env::var("ANALYZE_COMPLETED_RUNS").ok().as_deref() == Some("true");
    let analyze_root_causes = std::env::var("ANALYZE_ROOT_CAUSES").ok().as_deref() == Some("true");
    let aggregate_usage = std::env::var("AGGREGATE_USAGE").ok().as_deref() == Some("true");
    let evaluate_alerts = std::env::var("EVALUATE_ALERTS").ok().as_deref() == Some("true");
    let analysis_interval_seconds = std::env::var("ANALYSIS_POLL_INTERVAL_SECONDS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0);
    let usage_interval_seconds = std::env::var("USAGE_INTERVAL_SECONDS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(3600);
    let alerts_interval_seconds = std::env::var("ALERTS_INTERVAL_SECONDS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(60);

    if analyze_completed_runs || analyze_root_causes {
        run_analysis_cycle(&storage, analyze_completed_runs, analyze_root_causes)
            .await
            .expect("failed to run analysis cycle");
    }
    if aggregate_usage {
        usage_aggregator::aggregate(&storage)
            .await
            .expect("failed to aggregate usage");
    }
    if evaluate_alerts {
        alert_monitor::evaluate(&storage)
            .await
            .expect("failed to evaluate alerts");
    }

    if let Some(interval_seconds) = analysis_interval_seconds {
        if !(analyze_completed_runs || analyze_root_causes) {
        } else {
            info!(
                interval_seconds,
                analyze_completed_runs, analyze_root_causes, "starting recurring analysis worker"
            );

            let storage_clone = storage.clone();
            tokio::spawn(async move {
                let mut ticker = time::interval(Duration::from_secs(interval_seconds));
                ticker.tick().await;
                loop {
                    ticker.tick().await;
                    run_analysis_cycle(
                        &storage_clone,
                        analyze_completed_runs,
                        analyze_root_causes,
                    )
                    .await
                    .expect("failed to run recurring analysis cycle");
                }
            });
        }
    }

    if aggregate_usage {
        let storage_clone = storage.clone();
        tokio::spawn(async move {
            let mut ticker = time::interval(Duration::from_secs(usage_interval_seconds));
            ticker.tick().await;
            loop {
                ticker.tick().await;
                usage_aggregator::aggregate(&storage_clone)
                    .await
                    .expect("failed to run recurring usage aggregation");
            }
        });
    }

    if evaluate_alerts {
        let storage_clone = storage.clone();
        tokio::spawn(async move {
            let mut ticker = time::interval(Duration::from_secs(alerts_interval_seconds));
            ticker.tick().await;
            loop {
                ticker.tick().await;
                alert_monitor::evaluate(&storage_clone)
                    .await
                    .expect("failed to run recurring alert evaluation");
            }
        });
    }

    if analysis_interval_seconds.is_some() || aggregate_usage || evaluate_alerts {
        loop {
            time::sleep(Duration::from_secs(3600)).await;
        }
    }
}

async fn run_analysis_cycle(
    storage: &Storage,
    analyze_completed_runs: bool,
    analyze_root_causes: bool,
) -> Result<(), agentscope_common::errors::AgentScopeError> {
    if analyze_completed_runs {
        prompt_analyzer::analyze_completed_runs(storage).await?;
    }

    if analyze_root_causes {
        rca_analyzer::analyze_completed_runs(storage).await?;
    }

    Ok(())
}
