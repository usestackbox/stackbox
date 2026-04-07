// src-tauri/src/server/routes/memory.rs

use std::collections::HashMap;
use std::sync::Arc;

use axum::{body::Bytes, extract::Query, http::HeaderMap, response::IntoResponse, routing, Router};

use crate::{db, memory, state::SessionMap};

pub fn router(db: Arc<db::DbInner>, sessions: SessionMap) -> Router {
    Router::new()
        .route(
            "/memory",
            routing::post({
                let db = db.clone();
                let sessions = sessions.clone();
                move |headers: HeaderMap, body: Bytes| {
                    let db = db.clone();
                    let sessions = sessions.clone();
                    async move {
                        // Strip BOM + trim
                        let raw = {
                            let bytes = body.as_ref();
                            let stripped = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
                                &bytes[3..]
                            } else {
                                bytes
                            };
                            String::from_utf8_lossy(stripped).trim().to_string()
                        };

                        // ── 4-strategy body parser ────────────────────────────────
                        let (runbox_id, content, branch, commit_type, tags, agent_name_body): (
                            String,
                            String,
                            String,
                            String,
                            String,
                            String,
                        ) = if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                            (
                                v["runbox_id"].as_str().unwrap_or("__global__").to_string(),
                                v["content"].as_str().unwrap_or("").to_string(),
                                v["branch"].as_str().unwrap_or("main").to_string(),
                                v["commit_type"].as_str().unwrap_or("memory").to_string(),
                                v["tags"].as_str().unwrap_or("").to_string(),
                                v["agent_name"].as_str().unwrap_or("").to_string(),
                            )
                        } else {
                            let map: HashMap<String, String> =
                                url::form_urlencoded::parse(raw.as_bytes())
                                    .into_owned()
                                    .collect();
                            if map.contains_key("content") {
                                (
                                    map.get("runbox_id")
                                        .cloned()
                                        .unwrap_or_else(|| "__global__".into()),
                                    map.get("content").cloned().unwrap_or_default(),
                                    map.get("branch").cloned().unwrap_or_else(|| "main".into()),
                                    map.get("commit_type")
                                        .cloned()
                                        .unwrap_or_else(|| "memory".into()),
                                    map.get("tags").cloned().unwrap_or_default(),
                                    map.get("agent_name").cloned().unwrap_or_default(),
                                )
                            } else if raw.starts_with("content=") {
                                (
                                    "__global__".into(),
                                    raw["content=".len()..].to_string(),
                                    "main".into(),
                                    "memory".into(),
                                    "".into(),
                                    "".into(),
                                )
                            } else {
                                (
                                    "__global__".into(),
                                    raw.clone(),
                                    "main".into(),
                                    "memory".into(),
                                    "".into(),
                                    "".into(),
                                )
                            }
                        };

                        let content: String = content.trim().to_string();
                        if content.is_empty() {
                            return (axum::http::StatusCode::BAD_REQUEST,
                            r#"missing content - send JSON: {"runbox_id":"...","content":"..."}"#
                        ).into_response();
                        }

                        // ── Resolve agent name ────────────────────────────────────
                        // Priority: body field > Authorization header > PTY session lookup
                        let session_id = format!("agent-{}", uuid::Uuid::new_v4());

                        let agent_name = if !agent_name_body.is_empty() {
                            agent_name_body.clone()
                        } else {
                            // Try to look up from active PTY sessions via the session_id
                            // in the Authorization header
                            let auth_sid = headers
                                .get("authorization")
                                .and_then(|v| v.to_str().ok())
                                .and_then(|v| v.strip_prefix("Bearer "))
                                .unwrap_or("")
                                .to_string();

                            if !auth_sid.is_empty() {
                                if let Ok(map) = sessions.lock() {
                                    map.get(&auth_sid)
                                        .map(|s| {
                                            let name = s.agent_kind.display_name();
                                            if name == "Shell" {
                                                "".to_string()
                                            } else {
                                                name.to_string()
                                            }
                                        })
                                        .unwrap_or_default()
                                } else {
                                    String::new()
                                }
                            } else {
                                String::new()
                            }
                        };

                        match memory::memory_add_full(
                            &runbox_id,
                            &session_id,
                            &content,
                            &branch,
                            &commit_type,
                            &tags,
                            "",
                            &agent_name,
                        )
                        .await
                        {
                            Ok(_) => {
                                let _ = db::events::event_record(
                                    &db,
                                    &runbox_id,
                                    &session_id,
                                    "AgentAction",
                                    "http",
                                    &serde_json::json!({
                                        "action":     "memory_write",
                                        "preview":    &content[..content.len().min(80)],
                                        "agent_name": &agent_name,
                                    })
                                    .to_string(),
                                );
                                crate::agent::globals::emit_memory_added(&runbox_id);
                                (axum::http::StatusCode::OK, "ok").into_response()
                            }
                            Err(e) => {
                                eprintln!("[memory_route] write failed: {e}");
                                (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
                                    .into_response()
                            }
                        }
                    }
                }
            }),
        )
        .route(
            "/events",
            routing::get({
                let db = db.clone();
                move |Query(params): Query<HashMap<String, String>>| {
                    let db = db.clone();
                    async move {
                        let runbox_id = params.get("runbox_id").cloned().unwrap_or_default();
                        let event_type = params.get("event_type").cloned();
                        let limit = params
                            .get("limit")
                            .and_then(|s| s.parse::<usize>().ok())
                            .unwrap_or(20);
                        let events = if let Some(et) = event_type {
                            db::events::events_by_type(&db, &runbox_id, &et, limit)
                        } else {
                            db::events::events_recent(&db, &runbox_id, limit)
                        };
                        axum::Json(events.unwrap_or_default()).into_response()
                    }
                }
            }),
        )
}
