// src-tauri/src/server/mod.rs

pub mod routes;

use std::sync::Arc;

use tauri::{AppHandle, Emitter};
use tower_http::cors::CorsLayer;

use crate::{
    db::Db,
    mcp,
    state::{AppState, SessionMap},
    workspace::context::MEMORY_PORT,
};

pub async fn start(
    app_handle: Arc<AppHandle>,
    db: Db,
    sessions: SessionMap,
    app_state: Arc<AppState>,
) {
    let memory_routes = routes::memory::router(db.clone(), sessions.clone());

    let mcp_state = mcp::McpState {
        db:        db.clone(),
        sessions:  Some(sessions.clone()),
        app_state: app_state.clone(),
    };

    let app_url     = app_handle.clone();
    let app_changed = app_handle.clone();

    let router = axum::Router::new()
        .merge(memory_routes)
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
        .await.expect("failed to bind server port");

    eprintln!("[server] listening on 127.0.0.1:{}", MEMORY_PORT);
    axum::serve(listener, router.layer(cors)).await.unwrap();
}