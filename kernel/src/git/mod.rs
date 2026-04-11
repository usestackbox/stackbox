// kernel/src/git/mod.rs
//
// GitHub module: webhook HTTP handler + API client.
//
// Tauri doesn't have a built-in HTTP server so we spin up a tiny axum server
// on a fixed port (default 7891) that GitHub webhooks POST to.
//
// Setup in GitHub:
//   Payload URL: http://your-machine:7891/webhook
//   Content type: application/json
//   Events: Pull request reviews, Issue comments, Check runs, Workflow runs, Pull requests

pub mod api;
pub mod cleanup;
pub mod commands;
pub mod diff;
pub mod inject;
pub mod log;
pub mod repo;
pub mod watcher;
pub mod webhook;

use crate::state::AppState;
use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::post,
    Router,
};
use std::sync::Arc;

pub async fn start_webhook_server(state: Arc<AppState>) {
    let port = std::env::var("STACKBOX_WEBHOOK_PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(7891);

    let app = Router::new()
        .route("/webhook", post(handle_webhook_request))
        .with_state(state);

    let addr = format!("0.0.0.0:{port}");
    eprintln!("[webhook] listening on {addr}");

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn handle_webhook_request(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> StatusCode {
    // Verify signature if GITHUB_WEBHOOK_SECRET is set
    if let Ok(secret) = std::env::var("GITHUB_WEBHOOK_SECRET") {
        if !verify_signature(&secret, &headers, &body) {
            eprintln!("[webhook] signature verification failed");
            return StatusCode::UNAUTHORIZED;
        }
    }

    let event_type = headers
        .get("X-GitHub-Event")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .to_string();

    eprintln!("[webhook] received: {event_type}");

    let payload: webhook::WebhookPayload = match serde_json::from_slice(&body) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[webhook] parse error: {e}");
            return StatusCode::BAD_REQUEST;
        }
    };

    webhook::handle_webhook(&event_type, payload, &state).await;

    StatusCode::OK
}

/// HMAC-SHA256 signature verification for GitHub webhooks.
///
/// FIX (Bug #7): Replaced plain string == comparison with constant-time byte
/// comparison. The old `computed == sig_header` short-circuits on the first
/// differing byte, leaking timing information that could be used to brute-force
/// the webhook secret. We now use hmac's built-in verify() which is
/// guaranteed constant-time.
fn verify_signature(secret: &str, headers: &HeaderMap, body: &Bytes) -> bool {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    let sig_header = headers
        .get("X-Hub-Signature-256")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("sha256="))
        .unwrap_or("");

    // Decode the hex signature from the header into raw bytes.
    // If decoding fails, reject immediately.
    let sig_bytes = match hex::decode(sig_header) {
        Ok(b) => b,
        Err(_) => return false,
    };

    let mut mac =
        Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("HMAC can take key of any size");
    mac.update(body);

    // verify_slice() does a constant-time comparison internally.
    mac.verify_slice(&sig_bytes).is_ok()
}
