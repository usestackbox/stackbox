// src-tauri/src/server/routes/memory.rs

use std::collections::HashMap;
use std::sync::Arc;

use axum::{extract::Query, response::IntoResponse, routing, Json, Router};

use crate::{db, memory, workspace::context::MEMORY_PORT};

pub fn router(db: Arc<db::DbInner>) -> Router {
    Router::new()
        .route("/memory", routing::post({
            let db = db.clone();
            move |Json(body): Json<serde_json::Value>| {
                let db = db.clone();
                async move {
                    let runbox_id  = body["runbox_id"].as_str().unwrap_or("__global__").to_string();
                    let content    = body["content"].as_str().unwrap_or("").to_string();
                    if content.is_empty() {
                        return (axum::http::StatusCode::BAD_REQUEST, "missing content").into_response();
                    }
                    let session_id = format!("agent-{}", uuid::Uuid::new_v4());
                    match memory::memory_add(&runbox_id, &session_id, &content).await {
                        Ok(_) => {
                            let _ = db::events::event_record(
                                &db, &runbox_id, &session_id,
                                "AgentAction", "http",
                                &serde_json::json!({ "action": "memory_write", "preview": &content[..content.len().min(80)] }).to_string(),
                            );
                            crate::agent::globals::emit_memory_added(&runbox_id);
                            (axum::http::StatusCode::OK, "ok").into_response()
                        }
                        Err(e) => {
                            eprintln!("[memory_route] write failed: {e}");
                            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e).into_response()
                        }
                    }
                }
            }
        }))
        .route("/events", routing::get({
            let db = db.clone();
            move |Query(params): Query<HashMap<String, String>>| {
                let db = db.clone();
                async move {
                    let runbox_id  = params.get("runbox_id").cloned().unwrap_or_default();
                    let event_type = params.get("event_type").cloned();
                    let limit      = params.get("limit")
                        .and_then(|s| s.parse::<usize>().ok())
                        .unwrap_or(20);

                    let events = if let Some(et) = event_type {
                        db::events::events_by_type(&db, &runbox_id, &et, limit)
                    } else {
                        db::events::events_recent(&db, &runbox_id, limit)
                    };

                    Json(events.unwrap_or_default()).into_response()
                }
            }
        }))
}
