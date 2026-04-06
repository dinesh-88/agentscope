use std::collections::{HashMap, VecDeque};

use agentscope_trace::{Artifact, Span};

use crate::analysis::{
    detectors::Detection,
    step_transition::{build_step_transitions_with_causes, is_meaningful_transition},
};

const NORMAL_EDGE_WEIGHT: f64 = 0.3;
const SIGNIFICANT_EDGE_WEIGHT: f64 = 0.6;
const TRANSITION_CAUSE_EDGE_WEIGHT: f64 = 0.9;
const MIN_EDGE_WEIGHT: f64 = 0.3;

#[derive(Debug, Clone)]
pub struct CausalNode {
    pub span_id: String,
    pub span_type: String,
    pub status: String,
    pub detections: Vec<Detection>,
}

#[derive(Debug, Clone)]
pub struct CausalEdge {
    pub from: String,
    pub to: String,
    pub weight: f64,
    pub reason: String,
}

#[derive(Debug, Clone)]
pub struct CausalGraph {
    pub nodes: HashMap<String, CausalNode>,
    pub edges: Vec<CausalEdge>,
}

#[derive(Debug, Clone)]
pub struct RootCauseResult {
    pub root_cause_span: String,
    pub root_cause_type: String,
    pub causal_chain: Vec<String>,
    pub contributing_nodes: Vec<(String, f64)>,
    pub confidence_score: f64,
    pub failure_span: String,
    pub downstream_failure_type: String,
}

pub fn build_causal_graph(
    spans: &[Span],
    artifacts: &[Artifact],
    detections: &[Detection],
) -> Option<CausalGraph> {
    if spans.len() < 2 {
        return None;
    }

    let mut ordered = spans.iter().collect::<Vec<_>>();
    ordered.sort_by_key(|span| span.started_at);

    let detections_by_span = detections_by_span(detections);
    let transitions = build_step_transitions_with_causes(spans, artifacts, detections);

    let mut nodes = HashMap::<String, CausalNode>::new();
    for span in &ordered {
        let span_detections = detections_by_span
            .get(span.id.as_str())
            .cloned()
            .unwrap_or_default();
        nodes.insert(
            span.id.clone(),
            CausalNode {
                span_id: span.id.clone(),
                span_type: span.span_type.clone(),
                status: span.status.clone(),
                detections: span_detections,
            },
        );
    }

    let mut edges = Vec::<CausalEdge>::new();
    for index in 0..ordered.len().saturating_sub(1) {
        let from = ordered[index];
        let to = ordered[index + 1];
        let mut weight = NORMAL_EDGE_WEIGHT;
        let mut reason = "sequential transition".to_string();

        if let Some(transition) = transitions.get(&to.id) {
            if transition.likely_cause {
                weight = TRANSITION_CAUSE_EDGE_WEIGHT;
                reason = transition
                    .cause_reason
                    .clone()
                    .unwrap_or_else(|| "transition cause detected".to_string());
            } else if is_meaningful_transition(transition) {
                weight = SIGNIFICANT_EDGE_WEIGHT;
                reason = "significant context transition".to_string();
            }
        }

        edges.push(CausalEdge {
            from: from.id.clone(),
            to: to.id.clone(),
            weight,
            reason,
        });
    }

    Some(CausalGraph { nodes, edges })
}

pub fn find_root_causes(
    graph: &CausalGraph,
    span_order: &HashMap<String, usize>,
) -> Option<RootCauseResult> {
    let failed_nodes = graph
        .nodes
        .values()
        .filter(|node| is_failure_node(node))
        .map(|node| node.span_id.clone())
        .collect::<Vec<_>>();
    if failed_nodes.is_empty() {
        return None;
    }

    let mut incoming = HashMap::<&str, Vec<&CausalEdge>>::new();
    for edge in &graph.edges {
        incoming.entry(edge.to.as_str()).or_default().push(edge);
    }

    let mut node_scores = HashMap::<String, f64>::new();
    let mut source_to_failure_scores = HashMap::<(String, String), f64>::new();
    let mut best_influence = HashMap::<(String, String), f64>::new();
    let mut next_hop = HashMap::<(String, String), String>::new();
    let mut queue = VecDeque::<(String, String, f64)>::new();

    for failure_span in &failed_nodes {
        queue.push_back((failure_span.clone(), failure_span.clone(), 1.0));
        best_influence.insert((failure_span.clone(), failure_span.clone()), 1.0);
    }

    while let Some((current, failure_span, influence)) = queue.pop_front() {
        let Some(edges) = incoming.get(current.as_str()) else {
            continue;
        };

        for edge in edges {
            if edge.weight < MIN_EDGE_WEIGHT {
                continue;
            }

            let Some(parent_node) = graph.nodes.get(&edge.from) else {
                continue;
            };
            let parent_signal = detection_confidence(parent_node);
            if parent_signal <= 0.0 {
                continue;
            }

            let contribution = influence * edge.weight * parent_signal;
            *node_scores
                .entry(parent_node.span_id.clone())
                .or_insert(0.0) += contribution;
            *source_to_failure_scores
                .entry((parent_node.span_id.clone(), failure_span.clone()))
                .or_insert(0.0) += contribution;

            let next_influence = influence * edge.weight;
            let key = (parent_node.span_id.clone(), failure_span.clone());
            let previous_best = best_influence.get(&key).copied().unwrap_or(0.0);
            if next_influence > previous_best {
                best_influence.insert(key.clone(), next_influence);
                next_hop.insert(key, current.clone());
                queue.push_back((
                    parent_node.span_id.clone(),
                    failure_span.clone(),
                    next_influence,
                ));
            }
        }
    }

    if node_scores.is_empty() {
        return None;
    }

    let mut ranked = node_scores.into_iter().collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        right
            .1
            .total_cmp(&left.1)
            .then_with(|| {
                let l = span_order.get(&left.0).copied().unwrap_or(usize::MAX);
                let r = span_order.get(&right.0).copied().unwrap_or(usize::MAX);
                l.cmp(&r)
            })
            .then_with(|| left.0.cmp(&right.0))
    });

    let (root_cause_span, top_score) = ranked[0].clone();
    let root_node = graph.nodes.get(&root_cause_span)?;

    let mut best_failure = failed_nodes[0].clone();
    let mut best_failure_score = 0.0;
    for failure_span in &failed_nodes {
        let score = source_to_failure_scores
            .get(&(root_cause_span.clone(), failure_span.clone()))
            .copied()
            .unwrap_or(0.0);
        if score > best_failure_score {
            best_failure_score = score;
            best_failure = failure_span.clone();
        }
    }

    let mut chain = vec![root_cause_span.clone()];
    let mut cursor = root_cause_span.clone();
    loop {
        if cursor == best_failure {
            break;
        }
        let key = (cursor.clone(), best_failure.clone());
        let Some(next) = next_hop.get(&key) else {
            break;
        };
        if chain.last().map(|last| last == next).unwrap_or(false) {
            break;
        }
        chain.push(next.clone());
        cursor = next.clone();
    }
    if chain
        .last()
        .map(|node| node != &best_failure)
        .unwrap_or(true)
    {
        chain.push(best_failure.clone());
    }

    let root_cause_type = root_node
        .detections
        .iter()
        .max_by(|left, right| left.confidence.total_cmp(&right.confidence))
        .map(|detection| detection.failure_type.to_string())
        .unwrap_or_else(|| infer_type_from_status(root_node));

    let downstream_failure_type = graph
        .nodes
        .get(&best_failure)
        .and_then(|node| {
            node.detections
                .iter()
                .max_by(|left, right| left.confidence.total_cmp(&right.confidence))
                .map(|detection| detection.failure_type.to_string())
        })
        .unwrap_or_else(|| "FAILED_STEP".to_string());

    let top_contributors = ranked
        .iter()
        .take(5)
        .map(|(span_id, score)| (span_id.clone(), *score))
        .collect::<Vec<_>>();

    let confidence_score = top_score.clamp(0.0, 1.0);

    Some(RootCauseResult {
        root_cause_span,
        root_cause_type,
        causal_chain: chain,
        contributing_nodes: top_contributors,
        confidence_score,
        failure_span: best_failure,
        downstream_failure_type,
    })
}

fn detections_by_span(detections: &[Detection]) -> HashMap<&str, Vec<Detection>> {
    let mut by_span = HashMap::<&str, Vec<Detection>>::new();

    for detection in detections {
        for span_id in detection_target_span_ids(detection) {
            by_span.entry(span_id).or_default().push(detection.clone());
        }
    }

    by_span
}

fn detection_target_span_ids(detection: &Detection) -> Vec<&str> {
    let mut ids = detection
        .affected_spans
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();
    if let Some(span_id) = detection
        .evidence
        .as_object()
        .and_then(|obj| obj.get("span_id"))
        .and_then(|value| value.as_str())
    {
        ids.push(span_id);
    }
    ids.sort_unstable();
    ids.dedup();
    ids
}

fn is_failure_node(node: &CausalNode) -> bool {
    matches!(node.status.as_str(), "failed" | "error") || !node.detections.is_empty()
}

fn detection_confidence(node: &CausalNode) -> f64 {
    if node.detections.is_empty() {
        if matches!(node.status.as_str(), "failed" | "error") {
            0.25
        } else {
            0.0
        }
    } else {
        node.detections
            .iter()
            .map(|detection| detection.confidence)
            .fold(0.0, f64::max)
            .max(0.25)
    }
}

fn infer_type_from_status(node: &CausalNode) -> String {
    if matches!(node.status.as_str(), "failed" | "error") {
        "FAILED_SPAN".to_string()
    } else {
        "UNKNOWN".to_string()
    }
}
