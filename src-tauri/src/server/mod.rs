// src-tauri/src/server/mod.rs
//
// Axum HTTP server — runs on localhost:7547.
// Provides endpoints for agents and the EventTimelinePanel.
//
// Routes:
//   POST /memory                    ← agent writes a memory
//   GET  /events                    ← agent reads workspace events
//   GET  /timeline                  ← EventTimelinePanel initial load
//   GET  /timeline/stream           ← EventTimelinePanel SSE
//   GET  /url-changed               ← browser pane URL change notification
//   POST /open-url                  ← browser pane open request
//   POST /mcp/:runbox_id            ← MCP JSON-RPC endpoint

pub mod routes;

use std::sync::Arc;

use tauri::{AppHandle, Emitter};
use tower_http::cors::CorsLayer;

use crate::{
    db::Db,
    mcp,
    workspace::context::MEMORY_PORT,
};

pub async fn start(app_handle: Arc<AppHandle>, db: Db, _unused: ()) {
    let db_arc = db.clone();

    // ── Routes ───────────────────────────────────────────────────────────
    let memory_routes   = routes::memory::router(db_arc.clone());
    let timeline_routes = routes::timeline::router(db_arc.clone());

    let mcp_state = mcp::McpState { db: db.clone() };

    // Browser helper routes
    let app_url     = app_handle.clone();
    let app_changed = app_handle.clone();

    let router = axum::Router::new()
        .merge(memory_routes)
        .merge(timeline_routes)
        .nest("/mcp", mcp::router(mcp_state))
        .route("/open-url", axum::routing::post({
            let h = app_url.clone();
            move |body: String| {
                let h = h.clone();
                async move { let _ = h.emit("browser-open-url", body); "ok" }
            }
        }))
        .route("/url-changed", axum::routing::get({
            let h = app_changed.clone();
            move |axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>| {
                let h = h.clone();
                async move {
                    if let (Some(id), Some(url)) = (params.get("id"), params.get("url")) {
                        let _ = h.emit("browser-url-changed", serde_json::json!({
                            "id": id, "url": url
                        }));
                    }
                    "ok"
                }
            }
        }));

    let cors = CorsLayer::new()
        .allow_origin(tower_http::cors::Any)
        .allow_methods(tower_http::cors::Any)
        .allow_headers(tower_http::cors::Any);

    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{}", MEMORY_PORT))
        .await
        .expect("failed to bind server port");

    eprintln!("[server] listening on 127.0.0.1:{}", MEMORY_PORT);
    axum::serve(listener, router.layer(cors)).await.unwrap();
}
