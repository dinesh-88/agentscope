use std::{convert::Infallible, sync::Arc, time::Duration};

use agentscope_trace::Span;
use axum::{
    extract::State,
    response::sse::{Event, KeepAlive, Sse},
};
use futures_util::stream;
use serde::Serialize;
use tokio::sync::broadcast;
use tracing::warn;

use crate::AppState;

const SPAN_EVENT_BUFFER_SIZE: usize = 1024;

#[derive(Debug, Clone, Serialize)]
pub struct SpanEvent {
    #[serde(rename = "type")]
    event_type: &'static str,
    span: Span,
}

impl SpanEvent {
    fn span_created(span: Span) -> Self {
        Self {
            event_type: "span_created",
            span,
        }
    }
}

pub fn span_event_channel() -> broadcast::Sender<SpanEvent> {
    broadcast::channel(SPAN_EVENT_BUFFER_SIZE).0
}

pub fn publish_span_created(sender: &broadcast::Sender<SpanEvent>, span: &Span) {
    let _ = sender.send(SpanEvent::span_created(span.clone()));
}

pub async fn stream(
    State(state): State<Arc<AppState>>,
) -> Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>> {
    let receiver = state.span_events.subscribe();
    let stream = stream::unfold(receiver, |mut receiver| async move {
        loop {
            match receiver.recv().await {
                Ok(message) => match Event::default().event("span_created").json_data(message) {
                    Ok(event) => return Some((Ok(event), receiver)),
                    Err(error) => {
                        warn!(error = %error, "failed to serialize span event");
                    }
                },
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    warn!(skipped, "span event subscriber lagged behind");
                }
                Err(broadcast::error::RecvError::Closed) => return None,
            }
        }
    });

    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    )
}
