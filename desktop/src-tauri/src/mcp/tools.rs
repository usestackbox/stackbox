// src-tauri/src/mcp/tools.rs
//
// Agent name is captured from the Authorization header session_id,
// then looked up from active PTY sessions to get the real AgentKind.
// Falls back to the agent_name field if provided explicitly in the tool call.

use serde_json::{json, Value};

use crate::{db, memory, workspace::events::record_workspace_snapshot};
use super::{McpState, JsonRpcResponse};

pub fn tool_list() -> Value {
    json!({
        "tools": [
            {
                "name": "workspace_read",
                "description": "Read recent workspace events. Call at session start to understand current state.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "limit":      { "type": "number" },
                        "event_type": { "type": "string" }
                    }
                }
            },
            {
                "name": "memory_read",
                "description": "Read shared memories for this runbox. Call to understand what previous agents did.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "limit":  { "type": "number" },
                        "branch": { "type": "string", "description": "Filter to a specific memory branch (default: all)" }
                    }
                }
            },
            {
                "name": "memory_write",
                "description": "Write a memory shared with all future agents. Call after completing significant work. 1-3 sentences: what you did, files changed, known issues. Your agent name is automatically recorded — do not include it in the content.",
                "inputSchema": {
                    "type": "object",
                    "required": ["content"],
                    "properties": {
                        "content":     { "type": "string" },
                        "branch":      { "type": "string", "description": "Memory branch (default: main)" },
                        "commit_type": { "type": "string", "enum": ["memory", "checkpoint", "milestone"], "description": "memory = regular note, checkpoint = meaningful milestone, milestone = major goal completed" },
                        "tags":        { "type": "string", "description": "Comma-separated tags e.g. 'auth,bug,css'" }
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
                        "message": { "type": "string" }
                    }
                }
            }
        ]
    })
}

pub async fn dispatch(
    method:     &str,
    params:     Option<Value>,
    id:         Option<Value>,
    runbox_id:  &str,
    session_id: &str,
    agent_name: &str,   // ← resolved from PTY session by handler
    state:      &McpState,
) -> JsonRpcResponse {
    match method {
        "tools/list" => JsonRpcResponse::ok(id, tool_list()),
        "tools/call" => {
            let name = params.as_ref()
                .and_then(|p| p.get("name")).and_then(|n| n.as_str()).unwrap_or("");
            let args = params.as_ref()
                .and_then(|p| p.get("arguments")).cloned().unwrap_or(json!({}));
            match name {
                "workspace_read" => tool_workspace_read(id, runbox_id, &args, state).await,
                "memory_read"    => tool_memory_read(id, runbox_id, &args).await,
                "memory_write"   => tool_memory_write(id, runbox_id, session_id, agent_name, &args, state).await,
                "snapshot"       => tool_snapshot(id, runbox_id, session_id, &args, state).await,
                _ => JsonRpcResponse::err(id, -32601, format!("unknown tool: {name}")),
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
    id: Option<Value>, runbox_id: &str, args: &Value, state: &McpState,
) -> JsonRpcResponse {
    let limit      = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(20) as usize;
    let event_type = args.get("event_type").and_then(|v| v.as_str());

    let events = if let Some(et) = event_type {
        db::events::events_by_type(&state.db, runbox_id, et, limit)
    } else {
        db::events::events_recent(&state.db, runbox_id, limit)
    }.unwrap_or_default();

    if events.is_empty() {
        return JsonRpcResponse::ok(id, json!({ "content": [{ "type": "text", "text": "No workspace events yet." }] }));
    }

    let lines: Vec<String> = events.iter().rev().map(|e| {
        format!("[{}] {} — {}", format_ago(e.timestamp), e.event_type, e.payload_json.chars().take(100).collect::<String>())
    }).collect();

    JsonRpcResponse::ok(id, json!({ "content": [{ "type": "text", "text": lines.join("\n") }] }))
}

async fn tool_memory_read(id: Option<Value>, runbox_id: &str, args: &Value) -> JsonRpcResponse {
    let limit  = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(30) as usize;
    let branch = args.get("branch").and_then(|v| v.as_str());

    let mems = if let Some(b) = branch {
        memory::memories_for_branch(runbox_id, b).await.unwrap_or_default()
    } else {
        memory::memories_for_runbox(runbox_id).await.unwrap_or_default()
    };

    if mems.is_empty() {
        return JsonRpcResponse::ok(id, json!({ "content": [{ "type": "text", "text": "No memories yet." }] }));
    }

    let lines: Vec<String> = mems.iter().take(limit).map(|m| {
        let pin    = if m.pinned { " 📌" } else { "" };
        let ago    = format_ago(m.timestamp);
        let agent  = if !m.agent_name.is_empty() { format!(" [{}]", m.agent_name) } else { String::new() };
        let branch = if m.branch != "main" { format!(" ⎇{}", m.branch) } else { String::new() };
        let ct     = match m.commit_type.as_str() { "milestone" => " ◆", "checkpoint" => " ●", _ => "" };
        format!("[{ago}]{pin}{agent}{branch}{ct} {}", m.content.trim())
    }).collect();

    JsonRpcResponse::ok(id, json!({ "content": [{ "type": "text", "text": lines.join("\n") }] }))
}

async fn tool_memory_write(
    id:         Option<Value>,
    runbox_id:  &str,
    session_id: &str,
    agent_name: &str,
    args:       &Value,
    state:      &McpState,
) -> JsonRpcResponse {
    let content = match args.get("content").and_then(|v| v.as_str()) {
        Some(c) if !c.trim().is_empty() => c.to_string(),
        _ => return JsonRpcResponse::err(id, -32602, "content is required"),
    };
    let branch      = args.get("branch").and_then(|v| v.as_str()).unwrap_or("main");
    let commit_type = args.get("commit_type").and_then(|v| v.as_str()).unwrap_or("memory");
    let tags        = args.get("tags").and_then(|v| v.as_str()).unwrap_or("");

    match memory::memory_add_full(runbox_id, session_id, &content, branch, commit_type, tags, "", agent_name).await {
        Ok(mem) => {
            crate::agent::globals::emit_memory_added(runbox_id);
            JsonRpcResponse::ok(id, json!({
                "content": [{ "type": "text", "text": format!(
                    "Memory saved ({}){} on branch '{}'",
                    &mem.id[..8],
                    if !agent_name.is_empty() { format!(" by {agent_name}") } else { String::new() },
                    branch
                )}]
            }))
        }
        Err(e) => JsonRpcResponse::err(id, -32000, e),
    }
}

async fn tool_snapshot(
    id: Option<Value>, runbox_id: &str, session_id: &str,
    args: &Value, state: &McpState,
) -> JsonRpcResponse {
    let message = match args.get("message").and_then(|v| v.as_str()) {
        Some(m) if !m.trim().is_empty() => m.to_string(),
        _ => return JsonRpcResponse::err(id, -32602, "message is required"),
    };
    record_workspace_snapshot(&state.db, runbox_id, session_id, "", &message);
    JsonRpcResponse::ok(id, json!({ "content": [{ "type": "text", "text": format!("WorkspaceSnapshot recorded: {message}") }] }))
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