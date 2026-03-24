// src-tauri/src/mcp/tools.rs
// Supercontext V3 — 4 core tools + workspace_read + snapshot.
//
// Core tools:
//   memory_context   — read first · every session
//   remember         — PREFERRED or TEMPORARY only · atomic facts
//   session_log      — after each step · 200 line cap per agent
//   session_summary  — last · task complete · one paragraph
//
// Util tools:
//   workspace_read   — recent workspace events
//   snapshot         — git checkpoint before risky ops

use serde_json::{json, Value};
use crate::{db, memory, agent::injector};
use super::{McpState, JsonRpcResponse};

pub fn tool_list() -> Value {
    json!({ "tools": [
        {
            "name": "memory_context",
            "description": "CALL THIS FIRST on every task. Returns ranked context (~400 tokens):\n1. LOCKED — project constraints, never violate these\n2. RECENT SESSIONS — what other agents completed recently\n3. PREFERRED — persistent facts: env, tools, ports, lessons learned\n4. TEMPORARY — your own active working notes from this session\n\nCached — fast on repeated calls. Pass task= to get relevance-ranked results.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "task": { "type": "string", "description": "What you are about to do. Used to rank PREFERRED facts by relevance." }
                }
            }
        },
        {
            "name": "remember",
            "description": "Write one atomic fact. One fact per call — not paragraphs.\n\nPREFERRED — persistent facts. Key=value for env: 'port=3456', 'node=v18'. Use for: env facts, working rules, lessons learned. 6-month decay. Key-versioned (writing 'port=3456' resolves old 'port=3000').\nTEMPORARY — working notes for this session. 'halfway through dark mode refactor in styles.css'. Auto-expires when session ends.\n\nNever LOCKED or SESSION — those have separate paths.",
            "inputSchema": {
                "type": "object",
                "required": ["content", "level"],
                "properties": {
                    "content": { "type": "string", "description": "One atomic fact. Examples: 'port=3456', 'python not available — use node/npm', 'halfway through button contrast check'" },
                    "level":   { "type": "string", "enum": ["PREFERRED", "TEMPORARY"] }
                }
            }
        },
        {
            "name": "session_log",
            "description": "Log one meaningful step. One line — concise. Called during task, after each meaningful action.\n\nExamples:\n  '[step] read styles.css — found 12 color variables in :root'\n  '[step] changed --primary from #3b82f6 to #000000'\n  '[done] all variables converted — verified at localhost:3456'\n  '[error] port 3000 occupied — switched to 3456'\n\nPrefixes:\n  [step]    during work, after each meaningful action\n  [done]    when something completes successfully\n  [error]   when something fails\n  [blocked] when you are stuck and cannot proceed\n\nCapped at 200 lines per agent. Oldest dropped when cap reached. Auto-expires when session ends.\nKeep it short. One line. No essays. The GCC ablation showed fine-grained OTA traces are the single biggest performance factor.",
            "inputSchema": {
                "type": "object",
                "required": ["entry"],
                "properties": {
                    "entry": { "type": "string", "description": "One-line step log. Prefix with [step], [done], [error], or [blocked]." }
                }
            }
        },
        {
            "name": "session_summary",
            "description": "Write a session summary when task is complete. One paragraph. Called LAST — after all work is done.\n\nCover: what was attempted, what changed, what still needs doing, key facts (port, node version, etc.).\nOther agents will see this in their RECENT SESSIONS on next session_context call.\n\nExample: 'Converted login-app/styles.css to black/white. Changed 12 CSS variables in :root. Node v18, port 3456. Did not touch login-app/app.js (locked). Next: test mobile viewport.'",
            "inputSchema": {
                "type": "object",
                "required": ["text"],
                "properties": {
                    "text": { "type": "string", "description": "One paragraph summary of what happened this session." }
                }
            }
        },
        {
            "name": "workspace_read",
            "description": "Read recent workspace events (file changes, commands, agent spawns).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "limit":      { "type": "number" },
                    "event_type": { "type": "string" }
                }
            }
        },
        {
            "name": "snapshot",
            "description": "Create a git checkpoint before risky operations.",
            "inputSchema": {
                "type": "object",
                "required": ["message"],
                "properties": { "message": { "type": "string" } }
            }
        }
    ]})
}

pub async fn dispatch(
    method:     &str,
    params:     Option<Value>,
    id:         Option<Value>,
    runbox_id:  &str,
    session_id: &str,
    agent_name: &str,
    state:      &McpState,
) -> JsonRpcResponse {
    match method {
        "tools/list" => JsonRpcResponse::ok(id, tool_list()),
        "tools/call" => {
            let name = params.as_ref()
                .and_then(|p| p.get("name")).and_then(|n| n.as_str()).unwrap_or("");
            let args = params.as_ref()
                .and_then(|p| p.get("arguments")).cloned().unwrap_or(json!({}));
            let agent_type = memory::agent_type_from_name(agent_name);
            let agent_id   = memory::make_agent_id(&agent_type, session_id);
            match name {
                "memory_context"  => tool_memory_context(id, runbox_id, &agent_id, &args).await,
                "remember"        => tool_remember(id, runbox_id, session_id, &agent_id, agent_name, &args).await,
                "session_log"     => tool_session_log(id, runbox_id, session_id, &agent_id, agent_name, &args).await,
                "session_summary" => tool_session_summary(id, runbox_id, session_id, &agent_id, agent_name, &args).await,
                "workspace_read"  => tool_workspace_read(id, runbox_id, &args, state).await,
                "snapshot"        => tool_snapshot(id, runbox_id, session_id, &args, state).await,
                _ => JsonRpcResponse::err(id, -32601, format!("unknown tool: {name}")),
            }
        }
        "initialize" => JsonRpcResponse::ok(id, json!({
            "protocolVersion": "2024-11-05",
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "stackbox-supercontext", "version": "3.0.0" }
        })),
        _ => JsonRpcResponse::err(id, -32601, format!("method not found: {method}")),
    }
}

// ── memory_context ─────────────────────────────────────────────────────────────

async fn tool_memory_context(
    id:       Option<Value>,
    runbox_id: &str,
    agent_id:  &str,
    args:      &Value,
) -> JsonRpcResponse {
    let task   = args.get("task").and_then(|v| v.as_str()).unwrap_or("");
    let output = injector::build_context_v3(runbox_id, task, agent_id).await;

    if output.trim().is_empty() {
        return JsonRpcResponse::ok(id, json!({
            "content": [{ "type": "text", "text":
                "No context yet.\n\nGet started:\n• Call remember(content='port=3456', level='PREFERRED') to save env facts\n• Call session_log(entry='[step] starting task') to log progress\n• Call session_summary(text='...') when done" }]
        }));
    }

    JsonRpcResponse::ok(id, json!({ "content": [{ "type": "text", "text": output }] }))
}

// ── remember ───────────────────────────────────────────────────────────────────

async fn tool_remember(
    id:         Option<Value>,
    runbox_id:  &str,
    session_id: &str,
    agent_id:   &str,
    agent_name: &str,
    args:       &Value,
) -> JsonRpcResponse {
    let content = match args.get("content").and_then(|v| v.as_str()) {
        Some(c) if !c.trim().is_empty() => c.trim().to_string(),
        _ => return JsonRpcResponse::err(id, -32602, "content is required"),
    };
    let level = match args.get("level").and_then(|v| v.as_str()) {
        Some(l) if l == "PREFERRED" || l == "TEMPORARY" => l.to_string(),
        Some(l) => return JsonRpcResponse::err(id, -32602,
            format!("level must be PREFERRED or TEMPORARY, got '{l}'")),
        None => return JsonRpcResponse::err(id, -32602, "level is required"),
    };

    match memory::remember(runbox_id, session_id, agent_id, agent_name, &content, &level).await {
        Ok(mem) => {
            injector::invalidate_cache(runbox_id).await;
            crate::agent::globals::emit_memory_added(runbox_id);
            JsonRpcResponse::ok(id, json!({
                "content": [{ "type": "text", "text": format!(
                    "Saved [{level}] id={} key={}",
                    &mem.id[..8], mem.key
                )}]
            }))
        }
        Err(e) => JsonRpcResponse::err(id, -32000, e),
    }
}

// ── session_log ────────────────────────────────────────────────────────────────

async fn tool_session_log(
    id:         Option<Value>,
    runbox_id:  &str,
    session_id: &str,
    agent_id:   &str,
    agent_name: &str,
    args:       &Value,
) -> JsonRpcResponse {
    let entry = match args.get("entry").and_then(|v| v.as_str()) {
        Some(e) if !e.trim().is_empty() => e.trim().to_string(),
        _ => return JsonRpcResponse::err(id, -32602, "entry is required"),
    };

    match memory::session_log(runbox_id, session_id, agent_id, agent_name, &entry).await {
        Ok(_) => JsonRpcResponse::ok(id, json!({
            "content": [{ "type": "text", "text": "Logged." }]
        })),
        Err(e) => JsonRpcResponse::err(id, -32000, e),
    }
}

// ── session_summary ────────────────────────────────────────────────────────────

async fn tool_session_summary(
    id:         Option<Value>,
    runbox_id:  &str,
    session_id: &str,
    agent_id:   &str,
    agent_name: &str,
    args:       &Value,
) -> JsonRpcResponse {
    let text = match args.get("text").and_then(|v| v.as_str()) {
        Some(t) if !t.trim().is_empty() => t.trim().to_string(),
        _ => return JsonRpcResponse::err(id, -32602, "text is required"),
    };

    match memory::session_summary(runbox_id, session_id, agent_id, agent_name, &text).await {
        Ok(_) => {
            injector::invalidate_cache(runbox_id).await;
            crate::agent::globals::emit_memory_added(runbox_id);
            JsonRpcResponse::ok(id, json!({
                "content": [{ "type": "text", "text": "Session summary saved. Other agents will see this in their next memory_context call." }]
            }))
        }
        Err(e) => JsonRpcResponse::err(id, -32000, e),
    }
}

// ── workspace_read ─────────────────────────────────────────────────────────────

async fn tool_workspace_read(
    id:        Option<Value>,
    runbox_id: &str,
    args:      &Value,
    state:     &McpState,
) -> JsonRpcResponse {
    let limit      = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(20) as usize;
    let event_type = args.get("event_type").and_then(|v| v.as_str()).unwrap_or("");

    let events = if event_type.is_empty() {
        crate::db::events::events_recent(&state.db, runbox_id, limit).unwrap_or_default()
    } else {
        crate::db::events::events_by_type(&state.db, runbox_id, event_type, limit).unwrap_or_default()
    };

    if events.is_empty() {
        return JsonRpcResponse::ok(id, json!({
            "content": [{ "type": "text", "text": "No workspace events yet." }]
        }));
    }

    let lines: Vec<String> = events.iter().map(|e| {
        format!("[{}] {} {}", &e.timestamp.to_string()[..10], e.event_type, e.payload_json)
    }).collect();

    JsonRpcResponse::ok(id, json!({
        "content": [{ "type": "text", "text": lines.join("\n") }]
    }))
}

// ── snapshot ───────────────────────────────────────────────────────────────────

async fn tool_snapshot(
    id:         Option<Value>,
    runbox_id:  &str,
    session_id: &str,
    args:       &Value,
    state:      &McpState,
) -> JsonRpcResponse {
    let message = match args.get("message").and_then(|v| v.as_str()) {
        Some(m) if !m.trim().is_empty() => m.trim().to_string(),
        _ => return JsonRpcResponse::err(id, -32602, "message is required"),
    };

    match crate::workspace::snapshot::snapshot_from_git(&state.db, runbox_id, session_id, "") {
        _ => JsonRpcResponse::ok(id, json!({
            "content": [{ "type": "text", "text": format!("Snapshot: {message}") }]
        }))
    }
}