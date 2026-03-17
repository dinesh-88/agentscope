use std::{fs, path::PathBuf};

use agentscope_trace::{Artifact, Run, RunInsight, RunRootCause, Span};
use serde::Deserialize;
use uuid::Uuid;

use crate::ApiError;

#[derive(Debug, Deserialize)]
pub struct DemoTrace {
    pub run: Run,
    pub spans: Vec<Span>,
    pub artifacts: Vec<Artifact>,
    #[serde(default)]
    pub root_causes: Vec<RunRootCause>,
    #[serde(default)]
    pub insights: Vec<RunInsight>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DemoScenario {
    pub id: &'static str,
    pub name: &'static str,
}

const SCENARIOS: &[DemoScenario] = &[
    DemoScenario {
        id: "sandbox_real_agent",
        name: "Real Agent Demo",
    },
    DemoScenario {
        id: "sandbox_multi_agent",
        name: "Multi-Agent Demo",
    },
    DemoScenario {
        id: "sandbox_broken_agent",
        name: "Broken Agent Demo",
    },
];

pub fn scenarios() -> Vec<DemoScenario> {
    SCENARIOS.to_vec()
}

pub fn load_trace(scenario: &str) -> Result<DemoTrace, ApiError> {
    let path = repo_root()
        .join("examples")
        .join("demo_traces")
        .join(format!("{scenario}.json"));
    let contents = fs::read_to_string(&path)
        .map_err(|error| ApiError::Storage(format!("failed to read demo trace {:?}: {error}", path)))?;
    serde_json::from_str(&contents)
        .map_err(|error| ApiError::Storage(format!("failed to parse demo trace {scenario}: {error}")))
}

pub fn materialize_trace(mut trace: DemoTrace, project_id: &str, organization_id: &str) -> DemoTrace {
    let new_run_id = Uuid::new_v4().to_string();
    let mut span_ids = std::collections::HashMap::new();

    trace.run.id = new_run_id.clone();
    trace.run.project_id = project_id.to_string();
    trace.run.organization_id = Some(organization_id.to_string());

    for span in &mut trace.spans {
        let old_id = span.id.clone();
        span.id = Uuid::new_v4().to_string();
        span.run_id = new_run_id.clone();
        span_ids.insert(old_id, span.id.clone());
    }

    for span in &mut trace.spans {
        span.parent_span_id = span
            .parent_span_id
            .as_ref()
            .and_then(|parent_id| span_ids.get(parent_id).cloned());
    }

    for artifact in &mut trace.artifacts {
        artifact.id = Uuid::new_v4().to_string();
        artifact.run_id = new_run_id.clone();
        artifact.span_id = artifact
            .span_id
            .as_ref()
            .and_then(|span_id| span_ids.get(span_id).cloned());
    }

    for insight in &mut trace.insights {
        insight.id = Uuid::new_v4().to_string();
        insight.run_id = new_run_id.clone();
    }

    for root_cause in &mut trace.root_causes {
        root_cause.id = Uuid::new_v4().to_string();
        root_cause.run_id = new_run_id.clone();
    }

    trace
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|path| path.parent())
        .and_then(|path| path.parent())
        .expect("repo root must exist")
        .to_path_buf()
}
