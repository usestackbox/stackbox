// src-tauri/src/server/routes/timeline.rs
//
// GET /timeline/stream — SSE stream of workspace events for EventTimelinePanel.
// Replays recent history on connect, then streams live inserts.
//
// This is the replacement for the old /bus/stream endpoint.
// Events are workspace state transitions, not agent messages.

use std::collections::HashMap;
use std::convert::Infallible;
use std::sync::Arc;

use axum::{extract::Query, response::IntoResponse, routing, Router};
use axum::response::sse::{Event, KeepAlive, Sse};
use futures::stream;
use tokio::sync::broadcast;

use crate::db::{Db, events::events_since};

// ── Live event broadcaster ─────────────────────────────────────────────────────
// A single broadcast channel per process. Events are pushed here by
// workspace::events::record_* helpers (via a global sender).
// EventTimelinePanel SSE clients subscribe to this.

static BROADCASTER: std::sync::OnceLock<broadcast::Sender<String>> = std::sync::OnceLock::new();

pub fn broadcaster() -> &'static broadcast::Sender<String> {
    BROADCASTER.get_or_init(|| {
        let (tx, _) = broadcast::channel(256);
        tx
    })
}

/// Push a workspace event to all SSE subscribers.
/// Called from workspace::events::event_record after every DB insert.
pub fn broadcast_event(event_json: &str) {
    let _ = broadcaster().send(event_json.to_string());
}

pub fn router(db: Arc<crate::db::DbInner>) -> Router {
    Router::new()
        .route("/timeline/stream", routing::get({
            let db = db.clone();
            move |Query(params): Query<HashMap<String, String>>| {
                let db = db.clone();
                async move {
                    let runbox_id = params.get("runbox_id").cloned().unwrap_or_default();
                    let since_ms  = params.get("since_ms").and_then(|s| s.parse::<i64>().ok());
                    let rx        = broadcaster().subscribe();

                    // Replay history
                    let replay: Vec<String> = if let Some(since) = since_ms {
                        events_since(&db, &runbox_id, since, 200)
                            .unwrap_or_default()
                            .into_iter()
                            .filter_map(|e| serde_json::to_string(&e).ok())
                            .collect()
                    } else {
                        // Send last 50 on fresh connect
                        crate::db::events::events_recent(&db, &runbox_id, 50)
                            .unwrap_or_default()
                            .into_iter()
                            .rev()
                            .filter_map(|e| serde_json::to_string(&e).ok())
                            .collect()
                    };

                    let rb_filter = runbox_id.clone();

                    let replay_stream = stream::iter(replay.into_iter().map(|json| {
                        Ok::<Event, Infallible>(Event::default().data(json))
                    }));

                    let live_stream = stream::unfold(rx, move |mut rx| {
                        let rb = rb_filter.clone();
                        async move {
                            loop {
                                match rx.recv().await {
                                    Ok(json) => {
                                        // Filter to this runbox
                                        if rb.is_empty() || json.contains(&rb) {
                                            return Some((
                                                Ok::<Event, Infallible>(Event::default().data(json)),
                                                rx,
                                            ));
                                        }
                                    }
                                    Err(broadcast::error::RecvError::Lagged(n)) => {
                                        eprintln!("[timeline/sse] lagged {n}");
                                        continue;
                                    }
                                    Err(broadcast::error::RecvError::Closed) => return None,
                                }
                            }
                        }
                    });

                    Sse::new(stream::StreamExt::chain(replay_stream, live_stream))
                        .keep_alive(KeepAlive::default())
                        .into_response()
                }
            }
        }))
        // GET /timeline — last N events (non-streaming, for initial load)
        .route("/timeline", routing::get({
            let db = db.clone();
            move |Query(params): Query<HashMap<String, String>>| {
                let db = db.clone();
                async move {
                    let runbox_id = params.get("runbox_id").cloned().unwrap_or_default();
                    let limit     = params.get("limit")
                        .and_then(|s| s.parse::<usize>().ok())
                        .unwrap_or(50);
                    let events = crate::db::events::events_recent(&db, &runbox_id, limit)
                        .unwrap_or_default();
                    axum::Json(events).into_response()
                }
            }
        }))
}
