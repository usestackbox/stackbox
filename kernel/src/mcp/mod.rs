// src-tauri/src/mcp/mod.rs

pub mod config;
pub mod handler;
pub mod tools;

use axum::{routing::post, Router};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;

use crate::{db::Db, state::SessionMap};

#[derive(Clone)]
pub struct McpState {
    pub db: Db,
    /// Optional sessions map — used to resolve agent_name from session_id.
    pub sessions: Option<SessionMap>,
    pub app_state: Arc<crate::state::AppState>,
}

#[derive(Debug, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub method: String,
    pub params: Option<Value>,
    pub id: Option<Value>,
}

#[derive(Debug, Serialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<Value>,
}

impl JsonRpcResponse {
    pub fn ok(id: Option<Value>, result: Value) -> Self {
        Self {
            jsonrpc: "2.0".into(),
            id,
            result: Some(result),
            error: None,
        }
    }
    pub fn err(id: Option<Value>, code: i32, message: impl Into<String>) -> Self {
        Self {
            jsonrpc: "2.0".into(),
            id,
            result: None,
            error: Some(serde_json::json!({ "code": code, "message": message.into() })),
        }
    }
}

pub fn router(state: McpState) -> Router {
    Router::new()
        // Static route — runbox_id removed from URL.
        // Session routing is done by the Bearer token in the Authorization header.
        .route("/", post(handler::mcp_handler))
        .with_state(state)
}