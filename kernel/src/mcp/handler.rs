// src-tauri/src/mcp/handler.rs
//
// FIX (mcp-agent): agent_name is now passed to tools::dispatch() instead of
//   being computed and immediately discarded (prefixed with _). Memories and
//   status writes triggered via MCP will be tagged with the correct agent name.

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};

use super::{tools, JsonRpcRequest, JsonRpcResponse, McpState};

pub async fn mcp_handler(
    Path(_runbox_id): Path<String>,
    State(state): State<McpState>,
    headers: HeaderMap,
    Json(req): Json<JsonRpcRequest>,
) -> Json<JsonRpcResponse> {
    let session_id = extract_session_id(&headers);
    let agent_name = resolve_agent_name(&session_id, &state);
    let id = req.id.clone();

    let resp = match tools::dispatch(
        &req.method,
        &req.params.unwrap_or(serde_json::Value::Null),
        &state.app_state,
        &state.db,
        &agent_name,
    )
    .await
    {
        Ok(result) => JsonRpcResponse::ok(id, result),
        Err(msg) => JsonRpcResponse::err(id, -32603, msg),
    };

    Json(resp)
}

fn extract_session_id(headers: &HeaderMap) -> String {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("mcp-client")
        .to_string()
}

fn resolve_agent_name(session_id: &str, state: &McpState) -> String {
    if let Some(ref sessions) = state.sessions {
        if let Ok(map) = sessions.lock() {
            if let Some(sess) = map.get(session_id) {
                let name = sess.agent_kind.display_name();
                if name != "Shell" {
                    return name.to_string();
                }
            }
        }
    }
    if session_id.starts_with("agent-") {
        return "Agent".to_string();
    }
    if session_id.starts_with("manual-") {
        return "human".to_string();
    }
    String::new()
}
