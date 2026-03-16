// src-tauri/src/mcp/handler.rs

use axum::{extract::{Path, State}, http::HeaderMap, Json};

use super::{McpState, JsonRpcRequest, JsonRpcResponse, tools};

pub async fn mcp_handler(
    Path(runbox_id): Path<String>,
    State(state):    State<McpState>,
    headers:         HeaderMap,
    Json(req):       Json<JsonRpcRequest>,
) -> Json<JsonRpcResponse> {
    let session_id = extract_session_id(&headers);
    let id         = req.id.clone();

    let resp = tools::dispatch(
        &req.method,
        req.params,
        id,
        &runbox_id,
        &session_id,
        &state,
    ).await;

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
