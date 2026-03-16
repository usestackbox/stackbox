// src-tauri/src/mcp/tools.rs

use serde_json::{json, Value};

use crate::{db, memory, workspace::events::record_workspace_snapshot};
use super::{McpState, JsonRpcResponse};

pub fn tool_list() -> Value {
    json!({
        "tools": [
            {
                "name": "workspace_read",
                "description": "Read recent workspace events (FileChanged, CommandResult, WorkspaceSnapshot, etc.). Call this at session start to understand current state before doing any work.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "limit": { "type": "number", "description": "How many recent events to return (default 20)" },
                        "event_type": { "type": "string", "description": "Filter by event type" }
                    }
                }
            },
            {
                "name": "memory_read",
                "description": "Read shared memories for this runbox. Call this to understand what previous agents did.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "limit": { "type": "number", "description": "Max memories to return (default 30)" }
                    }
                }
            },
            {
                "name": "memory_write",
                "description": "Write a memory shared with all future agents. Call after completing significant work. 1-3 sentences: what you did, files changed, known issues.",
                "inputSchema": {
                    "type": "object",
                    "required": ["content"],
                    "properties": {
                        "content": { "type": "string" }
                    }
                }
            },
            {
                "name": "snapshot",
                "description": "Create a WorkspaceSnapshot checkpoint. Call before risky operations or after completing a major task.",
                "inputSchema": {
                    "type": "object",
                    "required": ["message"],
                    "properties": {
                        "message": { "type": "string", "description": "What this snapshot represents" }
                    }
                }
            }
        ]
    })
}

pub async fn dispatch(
    method:    &str,
    params:    Option<Value>,
    id:        Option<Value>,
    runbox_id: &str,
    session_id: &str,
    state:     &McpState,
) -> JsonRpcResponse {
    match method {
        "tools/list"  => JsonRpcResponse::ok(id, tool_list()),
        "tools/call"  => {
            let name = params.as_ref()
                .and_then(|p| p.get("name"))
                .and_then(|n| n.as_str())
                .unwrap_or("");
            let args = params.as_ref()
                .and_then(|p| p.get("arguments"))
                .cloned()
                .unwrap_or(json!({}));

            match name {
                "workspace_read" => tool_workspace_read(id, runbox_id, &args, state).await,
                "memory_read"    => tool_memory_read(id, runbox_id, &args).await,
                "memory_write"   => tool_memory_write(id, runbox_id, session_id, &args, state).await,
                "snapshot"       => tool_snapshot(id, runbox_id, session_id, &args, state).await,
                _                => JsonRpcResponse::err(id, -32601, format!("unknown tool: {name}")),
            }
        }
        "initialize" => JsonRpcResponse::ok(id, json!({
            "protocolVersion": "2024-11-05",
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "stackbox", "version": "1.0.0" }
        })),
        _ => JsonRpcResponse::err(id, -32601, format!("method not found: {method}")),
    }
}

async fn tool_workspace_read(
    id:        Option<Value>,
    runbox_id: &str,
    args:      &Value,
    state:     &McpState,
) -> JsonRpcResponse {
    let limit      = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(20) as usize;
    let event_type = args.get("event_type").and_then(|v| v.as_str());

    let events = if let Some(et) = event_type {
        db::events::events_by_type(&state.db, runbox_id, et, limit)
    } else {
        db::events::events_recent(&state.db, runbox_id, limit)
    }.unwrap_or_default();

    if events.is_empty() {
        return JsonRpcResponse::ok(id, json!({
            "content": [{ "type": "text", "text": "No workspace events yet." }]
        }));
    }

    let lines: Vec<String> = events.iter().rev().map(|e| {
        let ago = format_ago(e.timestamp);
        format!("[{ago}] {} — {}", e.event_type, e.payload_json.chars().take(100).collect::<String>())
    }).collect();

    JsonRpcResponse::ok(id, json!({
        "content": [{ "type": "text", "text": lines.join("\n") }]
    }))
}

async fn tool_memory_read(id: Option<Value>, runbox_id: &str, args: &Value) -> JsonRpcResponse {
    let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(30) as usize;
    let mems  = memory::memories_for_runbox(runbox_id).await.unwrap_or_default();

    if mems.is_empty() {
        return JsonRpcResponse::ok(id, json!({
            "content": [{ "type": "text", "text": "No memories yet." }]
        }));
    }

    let lines: Vec<String> = mems.iter().take(limit).map(|m| {
        let pin = if m.pinned { " 📌" } else { "" };
        let ago = format_ago(m.timestamp);
        format!("[{ago}]{pin} {}", m.content.trim())
    }).collect();

    JsonRpcResponse::ok(id, json!({
        "content": [{ "type": "text", "text": lines.join("\n") }]
    }))
}

async fn tool_memory_write(
    id:         Option<Value>,
    runbox_id:  &str,
    session_id: &str,
    args:       &Value,
    state:      &McpState,
) -> JsonRpcResponse {
    let content = match args.get("content").and_then(|v| v.as_str()) {
        Some(c) if !c.trim().is_empty() => c.to_string(),
        _ => return JsonRpcResponse::err(id, -32602, "content is required"),
    };

    match memory::memory_add(runbox_id, session_id, &content).await {
        Ok(mem) => {
            crate::agent::globals::emit_memory_added(runbox_id);
            JsonRpcResponse::ok(id, json!({
                "content": [{ "type": "text", "text": format!("Memory saved ({})", &mem.id[..8]) }]
            }))
        }
        Err(e) => JsonRpcResponse::err(id, -32000, e),
    }
}

async fn tool_snapshot(
    id:         Option<Value>,
    runbox_id:  &str,
    session_id: &str,
    args:       &Value,
    state:      &McpState,
) -> JsonRpcResponse {
    let message = match args.get("message").and_then(|v| v.as_str()) {
        Some(m) if !m.trim().is_empty() => m.to_string(),
        _ => return JsonRpcResponse::err(id, -32602, "message is required"),
    };

    // Get current git head if available (best effort)
    let git_head = String::new(); // workspace snapshot doesn't require git
    record_workspace_snapshot(&state.db, runbox_id, session_id, &git_head, &message);

    JsonRpcResponse::ok(id, json!({
        "content": [{ "type": "text", "text": format!("WorkspaceSnapshot recorded: {message}") }]
    }))
}

fn format_ago(ms: i64) -> String {
    let now  = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as i64;
    let diff = (now - ms).max(0) / 1000;
    if diff < 60    { return "just now".to_string(); }
    if diff < 3600  { return format!("{}m ago", diff / 60); }
    if diff < 86400 { return format!("{}h ago", diff / 3600); }
    format!("{}d ago", diff / 86400)
}
