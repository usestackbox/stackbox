// src-tauri/src/mcp/handler.rs
//
// Resolves the calling agent's name from:
//   1. The active PTY session (most accurate — from AgentKind)
//   2. The Authorization Bearer token (session_id → look up in sessions map)
// Passes agent_name to tools::dispatch so memories are tagged correctly.

use axum::{extract::{Path, State}, http::HeaderMap, Json};

use super::{McpState, JsonRpcRequest, JsonRpcResponse, tools};

pub async fn mcp_handler(
    Path(runbox_id): Path<String>,
    State(state):    State<McpState>,
    headers:         HeaderMap,
    Json(req):       Json<JsonRpcRequest>,
    
) -> Json<JsonRpcResponse> {
    let session_id  = extract_session_id(&headers);
    let _agent_name = resolve_agent_name(&session_id, &state);
    let _runbox_id  = runbox_id;
    let id          = req.id.clone();

    let resp = match tools::dispatch(
        &req.method,
        &req.params.unwrap_or(serde_json::Value::Null),
        &state.app_state,
        &state.db,
    ).await {
        Ok(result) => JsonRpcResponse::ok(id, result),
        Err(msg)   => JsonRpcResponse::err(id, -32603, msg),
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

/// Look up which agent kind is running for this session_id.
/// Uses the global AppState sessions map via the McpState.
fn resolve_agent_name(session_id: &str, state: &McpState) -> String {
    // McpState holds a reference to the sessions map for agent name resolution
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
    // Fallback: try to infer from session_id prefix
    // Session IDs for auto-captured memories look like "agent-<uuid>"
    if session_id.starts_with("agent-") {
        return "Agent".to_string();
    }
    if session_id.starts_with("manual-") {
        return "human".to_string();
    }
    String::new()
}