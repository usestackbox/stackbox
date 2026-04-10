// src-tauri/src/mcp/handler.rs
//
// MCP handler — routes requests by Bearer session_id from Authorization header.
// runbox_id is no longer in the URL; the static /mcp endpoint is used for all agents.

use axum::{
    extract::State,
    http::HeaderMap,
    Json,
};

use super::{tools, JsonRpcRequest, JsonRpcResponse, McpState};

pub async fn mcp_handler(
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