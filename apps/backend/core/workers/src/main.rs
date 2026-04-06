mod alert_monitor;
mod cost_backfill;
mod finalize_run;
mod intelligence_alerts;
mod issue_fix_detector;
mod issue_regression_detector;
mod llm_client;
mod pipeline;
mod prompt_analyzer;
mod rca_analyzer;
mod scoring;
mod usage_aggregator;
mod weekly_report_generator;

use agentscope_common::config::{init_tracing, Config};
use agentscope_storage::Storage;
use chrono::Utc;
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
    let run_issue_pipeline_once =
        std::env::var("RUN_ISSUE_PIPELINE").ok().as_deref() == Some("true");
    let run_cost_backfill_once =
        std::env::var("BACKFILL_LLM_COSTS").ok().as_deref() == Some("true");
    let run_weekly_reports_once =
        std::env::var("RUN_WEEKLY_REPORTS").ok().as_deref() == Some("true");
    let detect_issue_fixes = std::env::var("DETECT_ISSUE_FIXES")
        .ok()
        .as_deref()
        .unwrap_or("true")
        == "true";
    let detect_issue_regressions = std::env::var("DETECT_ISSUE_REGRESSIONS")
        .ok()
        .as_deref()
        .unwrap_or("true")
        == "true";
    let issue_pipeline_top_n = std::env::var("ISSUE_PIPELINE_TOP_N")
        .ok()
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(15);
    let cost_backfill_limit = std::env::var("BACKFILL_LLM_COSTS_LIMIT")
        .ok()
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(5000);
    let issue_pipeline_date = std::env::var("ISSUE_PIPELINE_DATE")
        .ok()
        .and_then(|value| chrono::NaiveDate::parse_from_str(&value, "%Y-%m-%d").ok());
    let issue_pipeline_interval_seconds = std::env::var("ISSUE_PIPELINE_INTERVAL_SECONDS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0);
    let weekly_reports_interval_seconds = std::env::var("WEEKLY_REPORT_INTERVAL_SECONDS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0);
    let issue_fix_detection_interval_seconds =
        std::env::var("ISSUE_FIX_DETECTION_INTERVAL_SECONDS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|value| *value > 0)
            .unwrap_or(900);
    let issue_regression_detection_interval_seconds =
        std::env::var("ISSUE_REGRESSION_DETECTION_INTERVAL_SECONDS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|value| *value > 0)
            .unwrap_or(900);
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
        weekly_report_generator::run_for_completed_week(&storage)
            .await
            .expect("failed to generate weekly reports after usage aggregation");
        intelligence_alerts::evaluate(&storage)
            .await
            .expect("failed to evaluate intelligence alerts after usage aggregation");
    }
    if evaluate_alerts {
        alert_monitor::evaluate(&storage)
            .await
            .expect("failed to evaluate alerts");
    }
    if run_issue_pipeline_once {
        let target_date = issue_pipeline_date.unwrap_or_else(|| Utc::now().date_naive());
        pipeline::run_issue_pipeline(&storage, target_date, issue_pipeline_top_n)
            .await
            .expect("failed to run issue intelligence pipeline");
        if detect_issue_fixes {
            issue_fix_detector::detect(&storage)
                .await
                .expect("failed to run issue fix detector");
        }
        if detect_issue_regressions {
            issue_regression_detector::detect(&storage)
                .await
                .expect("failed to run issue regression detector");
        }
        weekly_report_generator::run_for_completed_week(&storage)
            .await
            .expect("failed to generate weekly reports after issue pipeline");
        intelligence_alerts::evaluate(&storage)
            .await
            .expect("failed to evaluate intelligence alerts after issue pipeline");
    }
    if run_cost_backfill_once {
        cost_backfill::backfill(&storage, cost_backfill_limit)
            .await
            .expect("failed to backfill llm costs");
        storage
            .aggregate_project_usage_daily()
            .await
            .expect("failed to aggregate usage after llm cost backfill");
    }
    if run_weekly_reports_once {
        weekly_report_generator::run_for_completed_week(&storage)
            .await
            .expect("failed to generate weekly reports");
        intelligence_alerts::evaluate(&storage)
            .await
            .expect("failed to evaluate intelligence alerts after weekly reports");
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
                    run_analysis_cycle(&storage_clone, analyze_completed_runs, analyze_root_causes)
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
                weekly_report_generator::run_for_completed_week(&storage_clone)
                    .await
                    .expect("failed to generate weekly reports after recurring usage aggregation");
                intelligence_alerts::evaluate(&storage_clone).await.expect(
                    "failed to evaluate intelligence alerts after recurring usage aggregation",
                );
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
    if let Some(interval_seconds) = issue_pipeline_interval_seconds {
        let storage_clone = storage.clone();
        tokio::spawn(async move {
            let mut ticker = time::interval(Duration::from_secs(interval_seconds));
            ticker.tick().await;
            loop {
                ticker.tick().await;
                let target_date = issue_pipeline_date.unwrap_or_else(|| Utc::now().date_naive());
                pipeline::run_issue_pipeline(&storage_clone, target_date, issue_pipeline_top_n)
                    .await
                    .expect("failed to run recurring issue pipeline");
                if detect_issue_fixes {
                    issue_fix_detector::detect(&storage_clone)
                        .await
                        .expect("failed to run issue fix detector after issue pipeline");
                }
                if detect_issue_regressions {
                    issue_regression_detector::detect(&storage_clone)
                        .await
                        .expect("failed to run issue regression detector after issue pipeline");
                }
                weekly_report_generator::run_for_completed_week(&storage_clone)
                    .await
                    .expect("failed to generate weekly reports after recurring issue pipeline");
                intelligence_alerts::evaluate(&storage_clone).await.expect(
                    "failed to evaluate intelligence alerts after recurring issue pipeline",
                );
            }
        });
    }

    if let Some(interval_seconds) = weekly_reports_interval_seconds {
        let storage_clone = storage.clone();
        tokio::spawn(async move {
            let mut ticker = time::interval(Duration::from_secs(interval_seconds));
            ticker.tick().await;
            loop {
                ticker.tick().await;
                weekly_report_generator::run_for_completed_week(&storage_clone)
                    .await
                    .expect("failed to run recurring weekly report generation");
                intelligence_alerts::evaluate(&storage_clone)
                    .await
                    .expect("failed to evaluate intelligence alerts after recurring weekly report generation");
            }
        });
    }

    if detect_issue_fixes {
        let storage_clone = storage.clone();
        tokio::spawn(async move {
            let mut ticker =
                time::interval(Duration::from_secs(issue_fix_detection_interval_seconds));
            ticker.tick().await;
            loop {
                ticker.tick().await;
                issue_fix_detector::detect(&storage_clone)
                    .await
                    .expect("failed to run recurring issue fix detector");
            }
        });
    }

    if detect_issue_regressions {
        let storage_clone = storage.clone();
        tokio::spawn(async move {
            let mut ticker = time::interval(Duration::from_secs(
                issue_regression_detection_interval_seconds,
            ));
            ticker.tick().await;
            loop {
                ticker.tick().await;
                issue_regression_detector::detect(&storage_clone)
                    .await
                    .expect("failed to run recurring issue regression detector");
                intelligence_alerts::evaluate(&storage_clone)
                    .await
                    .expect("failed to evaluate intelligence alerts after recurring issue regression detection");
            }
        });
    }

    if analysis_interval_seconds.is_some()
        || aggregate_usage
        || evaluate_alerts
        || issue_pipeline_interval_seconds.is_some()
        || weekly_reports_interval_seconds.is_some()
        || detect_issue_fixes
        || detect_issue_regressions
    {
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
