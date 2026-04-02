use agentscope_trace::{Artifact, Span};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ReplayStep {
    pub index: i32,
    pub span: Span,
    pub artifacts: Vec<Artifact>,
}

pub struct StepController;

impl StepController {
    pub fn total_steps(spans: &[Span]) -> i32 {
        spans.len() as i32
    }

    pub fn step(spans: &[Span], artifacts: &[Artifact], step_index: i32) -> Option<ReplayStep> {
        let index = usize::try_from(step_index).ok()?;
        let span = spans.get(index)?.clone();
        let step_artifacts = artifacts
            .iter()
            .filter(|artifact| artifact.span_id.as_deref() == Some(span.id.as_str()))
            .cloned()
            .collect();

        Some(ReplayStep {
            index: step_index + 1,
            span,
            artifacts: step_artifacts,
        })
    }
}
