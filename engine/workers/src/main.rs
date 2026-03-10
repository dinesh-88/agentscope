mod finalize_run;
mod prompt_analyzer;
mod rca_analyzer;

use agentscope_common::config::{init_tracing, Config};
use agentscope_storage::Storage;

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

    if std::env::var("ANALYZE_COMPLETED_RUNS").ok().as_deref() == Some("true") {
        prompt_analyzer::analyze_completed_runs(&storage)
            .await
            .expect("failed to analyze completed runs");
    }

    if std::env::var("ANALYZE_ROOT_CAUSES").ok().as_deref() == Some("true") {
        rca_analyzer::analyze_completed_runs(&storage)
            .await
            .expect("failed to analyze root causes");
    }
}
