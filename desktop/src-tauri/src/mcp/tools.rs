// src-tauri/src/mcp/tools.rs
// Supercontext V2 — 5 MCP tools + workspace_read + snapshot.

use serde_json::{json, Value};
use crate::{db, memory, agent::injector};
use super::{McpState, JsonRpcResponse};

pub fn tool_list() -> Value {
    json!({ "tools": [
        {
            "name": "memory_context",
            "description": "CALL THIS FIRST on every task. Returns complete ranked workspace context (~800 tokens): goal → session summaries → active blockers (DO NOT retry dead ends) → relevant failures (DO NOT re-break) → environment facts → codebase map. Results are relevance-scored to your task. Cached — fast on repeated calls.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "task": { "type": "string", "description": "What you are about to do. Example: 'add JWT auth to login route'. Used to score which failures and codebase entries are most relevant." }
                }
            }
        },
        {
            "name": "memory_write",
            "description": "Write a typed memory. memory_type is required — it sets importance, decay, and injection priority.\n\nTypes:\n• goal — what we are building + acceptance criteria. imp=100, never decays.\n• environment — machine facts, key=value ONLY. 'node=working', 'py=broken', 'port=3836'. No prose. imp=90, 6mo decay.\n• codebase — file/function map. 'src/auth/jwt.ts: JWT validation · src/routes/login.tsx: login form'. imp=85.\n• blocker — unsolved error. 'Error: X. Tried: Y, Z. Do not retry Y or Z.' imp=95, stays until resolved.\n• failure — resolved error. 'Error: X. Cause: Y. Fix: Z.' imp=100, never decays.\n• session — end-of-session summary. What attempted, what changed, what's still open. 5 lines max. imp=80.",
            "inputSchema": {
                "type": "object",
                "required": ["content", "memory_type"],
                "properties": {
                    "content":     { "type": "string" },
                    "memory_type": { "type": "string", "enum": ["goal","environment","codebase","blocker","failure","session"] },
                    "scope":       { "type": "string", "enum": ["local","machine","global"], "description": "local=this runbox (default). machine=all runboxes on this OS. global=all projects." },
                    "tags":        { "type": "string" }
                }
            }
        },
        {
            "name": "memory_resolve",
            "description": "Call when you fix a blocker. Marks blocker resolved (so future agents skip the dead end) and writes a permanent failure memory with the fix. Call BEFORE ending any session where you fixed something.",
            "inputSchema": {
                "type": "object",
                "required": ["blocker_description", "fix"],
                "properties": {
                    "blocker_description": { "type": "string", "description": "The blocker content or enough to identify it." },
                    "fix":                 { "type": "string", "description": "Root cause + exact fix applied." }
                }
            }
        },
        {
            "name": "memory_goal",
            "description": "Set or update the current project goal. Injected first in every memory_context call across all sessions. Call when the user defines what to build.",
            "inputSchema": {
                "type": "object",
                "required": ["goal"],
                "properties": {
                    "goal": { "type": "string", "description": "What we are building + acceptance criteria." }
                }
            }
        },
        {
            "name": "memory_search",
            "description": "Explicit memory query for when memory_context didn't surface what you need. 'what do we know about port 3836', 'have we seen this ENOENT error', 'which file handles JWT validation'. Week 1: keyword. Week 3: semantic ANN.",
            "inputSchema": {
                "type": "object",
                "required": ["query"],
                "properties": {
                    "query":       { "type": "string" },
                    "memory_type": { "type": "string", "enum": ["goal","environment","codebase","blocker","failure","session"], "description": "Optional type filter." },
                    "limit":       { "type": "number", "description": "Max results. Default 10." }
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
            match name {
                "memory_context"  => tool_memory_context(id, runbox_id, &args).await,
                "memory_write"    => tool_memory_write(id, runbox_id, session_id, agent_name, &args).await,
                "memory_resolve"  => tool_memory_resolve(id, runbox_id, session_id, agent_name, &args).await,
                "memory_goal"     => tool_memory_goal(id, runbox_id, session_id, agent_name, &args).await,
                "memory_search"   => tool_memory_search(id, runbox_id, &args).await,
                "workspace_read"  => tool_workspace_read(id, runbox_id, &args, state).await,
                "snapshot"        => tool_snapshot(id, runbox_id, session_id, &args, state).await,
                _ => JsonRpcResponse::err(id, -32601, format!("unknown tool: {name}")),
            }
        }
        "initialize" => JsonRpcResponse::ok(id, json!({
            "protocolVersion": "2024-11-05",
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "stackbox-supercontext", "version": "2.0.0" }
        })),
        _ => JsonRpcResponse::err(id, -32601, format!("method not found: {method}")),
    }
}

// ── memory_context ────────────────────────────────────────────────────────────

async fn tool_memory_context(id: Option<Value>, runbox_id: &str, args: &Value) -> JsonRpcResponse {
    let task = args.get("task").and_then(|v| v.as_str()).unwrap_or("");
    let output = injector::build_context(runbox_id, task).await;

    if output.trim().is_empty() {
        return JsonRpcResponse::ok(id, json!({
            "content": [{ "type": "text", "text": "No context yet.\n\nCall memory_goal to set what you're building.\nCall memory_write with type='environment' to record env facts (key=value format).\nThese will be injected in future memory_context calls." }]
        }));
    }

    JsonRpcResponse::ok(id, json!({ "content": [{ "type": "text", "text": output }] }))
}

// ── memory_write ──────────────────────────────────────────────────────────────

async fn tool_memory_write(
    id:         Option<Value>,
    runbox_id:  &str,
    session_id: &str,
    agent_name: &str,
    args:       &Value,
) -> JsonRpcResponse {
    let content = match args.get("content").and_then(|v| v.as_str()) {
        Some(c) if !c.trim().is_empty() => c.trim().to_string(),
        _ => return JsonRpcResponse::err(id, -32602, "content is required"),
    };
    let memory_type = args.get("memory_type").and_then(|v| v.as_str()).unwrap_or("general");
    let scope = args.get("scope").and_then(|v| v.as_str()).unwrap_or("local");
    let extra_tags = args.get("tags").and_then(|v| v.as_str()).unwrap_or("");

    // Build tags: type + scope (if non-local) + extras
    let mut tag_parts = vec![memory_type.to_string()];
    if scope != "local" { tag_parts.push(format!("scope:{scope}")); }
    if !extra_tags.is_empty() { tag_parts.push(extra_tags.to_string()); }
    let tags = tag_parts.join(",");

    let importance = memory::importance_for_type(memory_type);
    let decay_at   = memory::decay_for_type(memory_type);
    let agent_type = memory::agent_type_from_name(agent_name);

    // For machine-scope, write to __global__ runbox so all runboxes see it
    let target_runbox = if scope == "machine" || scope == "global" {
        "__global__"
    } else {
        runbox_id
    };

    match memory::memory_add_typed(
        target_runbox, session_id, &content,
        "main", "memory", &tags, "", agent_name,
        memory_type, importance, false, decay_at, scope, &agent_type,
    ).await {
        Ok(mem) => {
            injector::invalidate_cache(runbox_id).await;
            crate::agent::globals::emit_memory_added(runbox_id);
            JsonRpcResponse::ok(id, json!({
                "content": [{ "type": "text", "text": format!(
                    "Memory saved [{memory_type}] id={} scope={scope}",
                    &mem.id[..8]
                )}]
            }))
        }
        Err(e) => JsonRpcResponse::err(id, -32000, e),
    }
}

// ── memory_resolve ────────────────────────────────────────────────────────────

async fn tool_memory_resolve(
    id:         Option<Value>,
    runbox_id:  &str,
    session_id: &str,
    agent_name: &str,
    args:       &Value,
) -> JsonRpcResponse {
    let blocker_desc = match args.get("blocker_description").and_then(|v| v.as_str()) {
        Some(s) if !s.trim().is_empty() => s.trim().to_string(),
        _ => return JsonRpcResponse::err(id, -32602, "blocker_description is required"),
    };
    let fix = match args.get("fix").and_then(|v| v.as_str()) {
        Some(s) if !s.trim().is_empty() => s.trim().to_string(),
        _ => return JsonRpcResponse::err(id, -32602, "fix is required"),
    };

    match memory::resolve_blocker(runbox_id, session_id, agent_name, &blocker_desc, &fix).await {
        Ok(()) => {
            injector::invalidate_cache(runbox_id).await;
            crate::agent::globals::emit_memory_added(runbox_id);
            // Broadcast so other panes see the fix
            crate::agent::globals::emit_event(
                "supercontext:blocker-resolved",
                serde_json::json!({ "runbox_id": runbox_id, "fix": &fix }),
            );
            JsonRpcResponse::ok(id, json!({
                "content": [{ "type": "text", "text": format!(
                    "Blocker resolved. Failure memory written with fix: {}", &fix[..fix.len().min(120)]
                )}]
            }))
        }
        Err(e) => JsonRpcResponse::err(id, -32000, e),
    }
}

// ── memory_goal ───────────────────────────────────────────────────────────────

async fn tool_memory_goal(
    id:         Option<Value>,
    runbox_id:  &str,
    session_id: &str,
    agent_name: &str,
    args:       &Value,
) -> JsonRpcResponse {
    let goal = match args.get("goal").and_then(|v| v.as_str()) {
        Some(s) if !s.trim().is_empty() => s.trim().to_string(),
        _ => return JsonRpcResponse::err(id, -32602, "goal is required"),
    };

    let agent_type = memory::agent_type_from_name(agent_name);

    match memory::memory_add_typed(
        runbox_id, session_id, &goal,
        "main", "milestone", "goal", "", agent_name,
        memory::MT_GOAL, 100, false,
        memory::DECAY_NEVER, "local", &agent_type,
    ).await {
        Ok(mem) => {
            injector::invalidate_cache(runbox_id).await;
            crate::agent::globals::emit_memory_added(runbox_id);
            JsonRpcResponse::ok(id, json!({
                "content": [{ "type": "text", "text": format!(
                    "Goal set (id={}). Will be injected first in all future memory_context calls.",
                    &mem.id[..8]
                )}]
            }))
        }
        Err(e) => JsonRpcResponse::err(id, -32000, e),
    }
}

// ── memory_search ─────────────────────────────────────────────────────────────

async fn tool_memory_search(
    id:        Option<Value>,
    runbox_id: &str,
    args:      &Value,
) -> JsonRpcResponse {
    let query = match args.get("query").and_then(|v| v.as_str()) {
        Some(s) if !s.trim().is_empty() => s.trim().to_string(),
        _ => return JsonRpcResponse::err(id, -32602, "query is required"),
    };
    let type_filter = args.get("memory_type").and_then(|v| v.as_str());
    let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(10) as usize;

    // Week 3: ANN semantic search with keyword fallback
    let scored = match memory::memories_ann_search(runbox_id, &query, type_filter, limit).await {
        Ok(r) => r,
        Err(e) => return JsonRpcResponse::err(id, -32000, e),
    };

    if scored.is_empty() {
        return JsonRpcResponse::ok(id, json!({
            "content": [{ "type": "text", "text": format!("No memories found matching '{query}'.") }]
        }));
    }

    let using_ann = crate::agent::embedder::is_ready();
    let lines: Vec<String> = scored.iter().map(|(score, m)| {
        let mt  = m.effective_type();
        let ago = format_ago(m.timestamp);
        let resolved_tag = if m.resolved { " [resolved]" } else { "" };
        let score_str = if using_ann { format!(" [{:.2}]", score) } else { String::new() };
        format!("[{mt}{resolved_tag}]{score_str} [{ago}] {}",
            m.content.lines().next().unwrap_or("").trim())
    }).collect();

    let method = if using_ann { "semantic ANN" } else { "keyword" };
    JsonRpcResponse::ok(id, json!({
        "content": [{ "type": "text", "text": format!(
            "Found {} results ({method}):\n\n{}", scored.len(), lines.join("\n")
        )}]
    }))
}

// ── workspace_read ────────────────────────────────────────────────────────────

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
        format!("[{}] {} — {}", format_ago(e.timestamp), e.event_type,
            e.payload_json.chars().take(120).collect::<String>())
    }).collect();

    JsonRpcResponse::ok(id, json!({ "content": [{ "type": "text", "text": lines.join("\n") }] }))
}

// ── snapshot ──────────────────────────────────────────────────────────────────

async fn tool_snapshot(
    id: Option<Value>, runbox_id: &str, session_id: &str,
    args: &Value, state: &McpState,
) -> JsonRpcResponse {
    let message = match args.get("message").and_then(|v| v.as_str()) {
        Some(m) if !m.trim().is_empty() => m.to_string(),
        _ => return JsonRpcResponse::err(id, -32602, "message is required"),
    };
    crate::workspace::events::record_workspace_snapshot(&state.db, runbox_id, session_id, "", &message);
    JsonRpcResponse::ok(id, json!({ "content": [{ "type": "text", "text": format!("Snapshot: {message}") }] }))
}

// ── helpers ───────────────────────────────────────────────────────────────────

fn format_ago(ms: i64) -> String {
    let now  = memory::now_ms();
    let diff = (now - ms).max(0) / 1000;
    if diff < 60    { return "just now".to_string(); }
    if diff < 3600  { return format!("{}m ago", diff / 60); }
    if diff < 86400 { return format!("{}h ago", diff / 3600); }
    format!("{}d ago", diff / 86400)
}