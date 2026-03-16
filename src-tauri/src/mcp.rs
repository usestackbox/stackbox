// src-tauri/src/mcp.rs
//
// MCP (Model Context Protocol) server for Stackbox.
//
// Exposes the agent bus and memory store as native MCP tools so Claude Code
// (and any other MCP-aware agent) can coordinate in real-time without
// needing shell snippets or polling loops.
//
// Transport: HTTP JSON-RPC  (POST /mcp/:runbox_id)
// Claude connects via .claude/mcp.json written by git_memory.rs at spawn time.
//
// Tools:
//   bus_read      — read recent bus messages (what peers have done / are doing)
//   bus_publish   — publish a message to the bus
//   bus_agents    — list agents currently active in this runbox
//   task_claim    — atomically claim a task: publishes task.started, returns ack
//                   (prevents two agents picking up the same work)
//   memory_read   — read shared memories for this runbox
//   memory_write  — write a memory shared with all future agents
//
// Runbox ID is baked into the URL path so tools don't require it as an argument.
// Session ID is passed as a Bearer token in Authorization: Bearer <session_id>
// — Claude Code can set this via the mcpServers config (see write_mcp_config).

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;

use crate::{bus, db, memory};

// ── State passed into every MCP handler ───────────────────────────────────
#[derive(Clone)]
pub struct McpState {
    pub bus_registry: Arc<bus::BusRegistry>,
    pub db:           db::Db,
}

// ── JSON-RPC types ─────────────────────────────────────────────────────────
#[derive(Debug, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub method:  String,
    pub params:  Option<Value>,
    pub id:      Option<Value>,
}

#[derive(Debug, Serialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id:      Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result:  Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error:   Option<Value>,
}

impl JsonRpcResponse {
    fn ok(id: Option<Value>, result: Value) -> Self {
        Self { jsonrpc: "2.0".into(), id, result: Some(result), error: None }
    }
    fn err(id: Option<Value>, code: i32, message: impl Into<String>) -> Self {
        Self {
            jsonrpc: "2.0".into(),
            id,
            result:  None,
            error:   Some(json!({ "code": code, "message": message.into() })),
        }
    }
}

// ── Tool definitions ───────────────────────────────────────────────────────
fn tool_list() -> Value {
    json!({
        "tools": [
            {
                "name": "bus_read",
                "description": "Read recent messages from the agent bus. Call this at the start of every session to see what peer agents have done or are currently working on. Also call it before starting any significant task to avoid duplicating work.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "limit": {
                            "type": "number",
                            "description": "How many recent messages to return (default 20, max 100)"
                        },
                        "topic": {
                            "type": "string",
                            "description": "Filter to a specific topic e.g. 'task.done', 'task.started', 'error'"
                        }
                    }
                }
            },
            {
                "name": "bus_publish",
                "description": "Publish a message to the agent bus. All peer agents in this runbox will receive it. Use this to announce what you are working on (task.started), when you finish (task.done), or to signal errors. Peer agents monitor the bus so they can avoid duplicate work.",
                "inputSchema": {
                    "type": "object",
                    "required": ["topic", "payload"],
                    "properties": {
                        "topic": {
                            "type": "string",
                            "description": "Message topic. Valid values: task.started, task.done, task.failed, status, error, memory.added, file.changed, agent.delegated. Use custom.<name> for anything else."
                        },
                        "payload": {
                            "type": "string",
                            "description": "Message content. Plain text or JSON string. For task.started include a clear description of what you are doing. For task.done include files changed and outcome."
                        },
                        "correlation_id": {
                            "type": "string",
                            "description": "Optional — link this message to a previous one (e.g. the task.started ID) for tracing."
                        }
                    }
                }
            },
            {
                "name": "bus_agents",
                "description": "List agents currently active in this runbox. Use this to see who else is running before starting a task, so you can coordinate or divide work.",
                "inputSchema": {
                    "type": "object",
                    "properties": {}
                }
            },
            {
                "name": "task_claim",
                "description": "Atomically claim a task. This publishes a task.started message with a unique claim ID and returns that ID. Use this instead of bus_publish(task.started) when you want to prevent two agents from starting the same task concurrently. The claim is visible to all peers immediately.",
                "inputSchema": {
                    "type": "object",
                    "required": ["description"],
                    "properties": {
                        "description": {
                            "type": "string",
                            "description": "What task you are claiming. Be specific: include the file, module, or feature so peers can see exactly what is taken."
                        }
                    }
                }
            },
            {
                "name": "memory_read",
                "description": "Read shared memories for this runbox. Memories persist across sessions and agents. Call this to get context about what previous agents did, decisions made, known issues, and architectural notes.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "limit": {
                            "type": "number",
                            "description": "Max memories to return (default 30)"
                        }
                    }
                }
            },
            {
                "name": "memory_write",
                "description": "Write a memory that will be shared with all future agents in this runbox. Use this after completing a significant task: record what you did, which files changed, any decisions made, and known issues. Keep it to 1-3 sentences.",
                "inputSchema": {
                    "type": "object",
                    "required": ["content"],
                    "properties": {
                        "content": {
                            "type": "string",
                            "description": "Memory content (1-3 sentences). Include: what was done, files changed, any known issues or follow-up needed."
                        }
                    }
                }
            },
            {
                "name": "tasks_in_progress",
                "description": "Return all tasks currently claimed by peer agents (task.started with no matching task.done). Call this FIRST before starting any work to check for conflicts. If your intended task matches one here, pick something else or coordinate with the claiming agent.",
                "inputSchema": {
                    "type": "object",
                    "properties": {}
                }
            }
        ]
    })
}

// ── Main MCP handler ───────────────────────────────────────────────────────
pub async fn mcp_handler(
    Path(runbox_id):   Path<String>,
    State(state):      State<McpState>,
    // Extract session_id from Authorization: Bearer <session_id>
    headers:           axum::http::HeaderMap,
    Json(req):         Json<JsonRpcRequest>,
) -> impl IntoResponse {
    let id         = req.id.clone();
    let session_id = extract_session_id(&headers);

    let result = match req.method.as_str() {
        "initialize" => handle_initialize(id.clone()),

        "notifications/initialized" => {
            // ACK from client — no response needed for notifications
            return (StatusCode::OK, Json(json!(null))).into_response();
        }

        "tools/list" => JsonRpcResponse::ok(id, tool_list()),

        "tools/call" => {
            let params = req.params.unwrap_or(json!({}));
            let name   = params["name"].as_str().unwrap_or("").to_string();
            let args   = params["arguments"].clone();
            handle_tool_call(id, name, args, &runbox_id, &session_id, &state).await
        }

        "ping" => JsonRpcResponse::ok(id, json!({})),

        other => JsonRpcResponse::err(id, -32601, format!("unknown method '{other}'")),
    };

    (StatusCode::OK, Json(serde_json::to_value(result).unwrap_or(json!(null)))).into_response()
}

fn handle_initialize(id: Option<Value>) -> JsonRpcResponse {
    JsonRpcResponse::ok(id, json!({
        "protocolVersion": "2024-11-05",
        "capabilities": {
            "tools": {}
        },
        "serverInfo": {
            "name":    "stackbox",
            "version": "0.1.0"
        }
    }))
}

async fn handle_tool_call(
    id:         Option<Value>,
    name:       String,
    args:       Value,
    runbox_id:  &str,
    session_id: &str,
    state:      &McpState,
) -> JsonRpcResponse {
    match name.as_str() {
        "bus_read"     => tool_bus_read(id.clone(), args, runbox_id, state).await,
        "bus_publish"  => tool_bus_publish(id.clone(), args, runbox_id, session_id, state),
        "bus_agents"   => tool_bus_agents(id.clone(), runbox_id, state),
        "task_claim"   => tool_task_claim(id.clone(), args, runbox_id, session_id, state),
        "memory_read"  => tool_memory_read(id.clone(), args, runbox_id).await,
        "memory_write"      => tool_memory_write(id.clone(), args, runbox_id, session_id, state).await,
        "tasks_in_progress" => tool_tasks_in_progress(id.clone(), runbox_id, state).await,
        other               => JsonRpcResponse::err(id, -32602, format!("unknown tool '{other}'")),
    }
}

// ── Tool: bus_read ─────────────────────────────────────────────────────────
async fn tool_bus_read(
    id:        Option<Value>,
    args:      Value,
    runbox_id: &str,
    state:     &McpState,
) -> JsonRpcResponse {
    let limit = args["limit"].as_u64().unwrap_or(20).min(100) as usize;
    let topic = args["topic"].as_str().map(|s| s.to_string());

    let msgs = match db::bus_messages_for_runbox(&state.db, runbox_id, limit, topic.as_deref()) {
        Ok(m)  => m,
        Err(e) => return JsonRpcResponse::err(id, -32000, e.to_string()),
    };

    if msgs.is_empty() {
        return JsonRpcResponse::ok(id, json!({
            "content": [{ "type": "text", "text": "No bus messages yet for this runbox." }]
        }));
    }

    // Format as a readable timeline for the agent
    let lines: Vec<String> = msgs.iter().rev().map(|m| {
        let ago  = format_ms_ago(m.timestamp);
        let cid  = m.correlation_id.as_deref()
            .map(|c| format!(" [←{}]", &c[..c.len().min(8)]))
            .unwrap_or_default();
        format!(
            "[{ago}] {topic} from {from}{cid}\n  {payload}",
            ago     = ago,
            topic   = m.topic,
            from    = &m.from_agent[..m.from_agent.len().min(8)],
            cid     = cid,
            payload = m.payload.chars().take(200).collect::<String>(),
        )
    }).collect();

    let text = format!(
        "## Agent bus — last {} messages (runbox {})\n\n{}\n\n\
         Use bus_publish to announce your work so peers can coordinate.",
        msgs.len(),
        &runbox_id[..runbox_id.len().min(8)],
        lines.join("\n\n"),
    );

    JsonRpcResponse::ok(id, json!({
        "content": [{ "type": "text", "text": text }]
    }))
}

// ── Tool: bus_publish ──────────────────────────────────────────────────────
fn tool_bus_publish(
    id:         Option<Value>,
    args:       Value,
    runbox_id:  &str,
    session_id: &str,
    state:      &McpState,
) -> JsonRpcResponse {
    let topic   = match args["topic"].as_str() {
        Some(t) => t.to_string(),
        None    => return JsonRpcResponse::err(id, -32602, "topic is required"),
    };
    let payload = args["payload"].as_str().unwrap_or("").to_string();
    let cid     = args["correlation_id"].as_str().map(|s| s.to_string());

    if !bus::is_valid_topic(&topic) {
        return JsonRpcResponse::err(
            id, -32602,
            format!("invalid topic '{topic}' — use a valid topic or prefix with 'custom.'"),
        );
    }

    let mut msg = bus::BusMessage::new(session_id.to_string(), topic.clone(), payload.clone());
    msg.correlation_id = cid;
    let msg_id = msg.id.clone();

    // Persist first, then broadcast
    let _ = db::bus_message_insert(&state.db, &msg, runbox_id);
    let n = state.bus_registry.publish(runbox_id, msg).unwrap_or(0);

    JsonRpcResponse::ok(id, json!({
        "content": [{
            "type": "text",
            "text": format!(
                "Published '{topic}' to {n} active subscribers.\nMessage ID: {msg_id}\n\
                 Payload: {payload}",
                topic   = topic,
                n       = n,
                msg_id  = msg_id,
                payload = payload.chars().take(120).collect::<String>(),
            )
        }]
    }))
}

// ── Tool: bus_agents ───────────────────────────────────────────────────────
fn tool_bus_agents(
    id:        Option<Value>,
    runbox_id: &str,
    state:     &McpState,
) -> JsonRpcResponse {
    let agents = state.bus_registry.agents_in(runbox_id);

    let text = if agents.is_empty() {
        "No other agents currently active in this runbox. You are the only one running.".to_string()
    } else {
        format!(
            "{} agent(s) currently active in runbox {}:\n{}",
            agents.len(),
            &runbox_id[..runbox_id.len().min(8)],
            agents.iter().map(|a| format!("  • {}", a)).collect::<Vec<_>>().join("\n"),
        )
    };

    JsonRpcResponse::ok(id, json!({
        "content": [{ "type": "text", "text": text }]
    }))
}

// ── Tool: task_claim ───────────────────────────────────────────────────────
// Publishes task.started with a unique claim ID.
// Agents should call bus_read first to check no peer already claimed the same task,
// then call task_claim to stake their claim atomically.
fn tool_task_claim(
    id:         Option<Value>,
    args:       Value,
    runbox_id:  &str,
    session_id: &str,
    state:      &McpState,
) -> JsonRpcResponse {
    let description = match args["description"].as_str() {
        Some(d) => d.to_string(),
        None    => return JsonRpcResponse::err(id, -32602, "description is required"),
    };

    let claim_id = uuid::Uuid::new_v4().to_string();
    let payload  = serde_json::json!({
        "task":       description,
        "claim_id":   claim_id,
        "session_id": session_id,
    }).to_string();

    let msg = bus::BusMessage::new(session_id.to_string(), "task.started", payload)
        .with_correlation(claim_id.clone());
    let msg_id = msg.id.clone();

    let _ = db::bus_message_insert(&state.db, &msg, runbox_id);
    let n = state.bus_registry.publish(runbox_id, msg).unwrap_or(0);

    JsonRpcResponse::ok(id, json!({
        "content": [{
            "type": "text",
            "text": format!(
                "Task claimed: \"{description}\"\n\
                 Claim ID:     {claim_id}\n\
                 Message ID:   {msg_id}\n\
                 Delivered to: {n} active subscriber(s)\n\n\
                 Peers have been notified. When done, call bus_publish with:\n\
                 - topic:          task.done\n\
                 - payload:        what you completed + files changed\n\
                 - correlation_id: {claim_id}",
                description = description,
                claim_id    = claim_id,
                msg_id      = msg_id,
                n           = n,
            )
        }]
    }))
}

// ── Tool: memory_read ──────────────────────────────────────────────────────
async fn tool_memory_read(
    id:        Option<Value>,
    args:      Value,
    runbox_id: &str,
) -> JsonRpcResponse {
    let limit = args["limit"].as_u64().unwrap_or(30) as usize;

    let mut mems = match memory::memories_for_runbox(runbox_id).await {
        Ok(m)  => m,
        Err(e) => return JsonRpcResponse::err(id, -32000, e.to_string()),
    };
    mems.truncate(limit);

    if mems.is_empty() {
        return JsonRpcResponse::ok(id, json!({
            "content": [{ "type": "text", "text": "No memories yet for this runbox." }]
        }));
    }

    let lines: Vec<String> = mems.iter().map(|m| {
        let pin = if m.pinned { " 📌" } else { "" };
        let ago = format_ms_ago(m.timestamp);
        format!("[{ago}]{pin} {content}", ago = ago, pin = pin, content = m.content.trim())
    }).collect();

    let text = format!(
        "## Shared memories — {} entries\n\n{}\n\n\
         Use memory_write to add your own after completing a task.",
        mems.len(),
        lines.join("\n"),
    );

    JsonRpcResponse::ok(id, json!({
        "content": [{ "type": "text", "text": text }]
    }))
}

// ── Tool: memory_write ─────────────────────────────────────────────────────
async fn tool_memory_write(
    id:         Option<Value>,
    args:       Value,
    runbox_id:  &str,
    session_id: &str,
    state:      &McpState,
) -> JsonRpcResponse {
    let content = match args["content"].as_str() {
        Some(c) if !c.trim().is_empty() => c.to_string(),
        _ => return JsonRpcResponse::err(id, -32602, "content is required"),
    };

    let mem = match memory::memory_add(runbox_id, session_id, &content).await {
        Ok(m)  => m,
        Err(e) => return JsonRpcResponse::err(id, -32000, e.to_string()),
    };

    // Publish memory.added to bus so peers see it immediately
    let notify_msg = bus::BusMessage::new(
        session_id.to_string(),
        "memory.added",
        serde_json::json!({ "id": mem.id, "content": content }).to_string(),
    );
    let _ = db::bus_message_insert(&state.db, &notify_msg, runbox_id);
    let _ = state.bus_registry.publish(runbox_id, notify_msg);

    JsonRpcResponse::ok(id, json!({
        "content": [{
            "type": "text",
            "text": format!(
                "Memory saved (ID: {})\nContent: {}\n\
                 Peers notified via memory.added bus event.",
                mem.id,
                content.chars().take(120).collect::<String>(),
            )
        }]
    }))
}

// ── Tool: tasks_in_progress ───────────────────────────────────────────────
// Returns claimed tasks (task.started without a matching task.done).
// Pre-computes the same logic that build_peer_section uses so agents don't
// have to parse a raw message timeline themselves.
async fn tool_tasks_in_progress(
    id:        Option<Value>,
    runbox_id: &str,
    state:     &McpState,
) -> JsonRpcResponse {
    let msgs = match db::bus_messages_for_runbox(&state.db, runbox_id, 200, None) {
        Ok(m)  => m,
        Err(e) => return JsonRpcResponse::err(id, -32000, e.to_string()),
    };

    // Collect task.started messages, then remove those with a matching task.done.
    let mut claimed: Vec<(String, String, String)> = vec![]; // (from, description, correlation_id)
    for m in &msgs {
        if m.topic == "task.started" {
            let desc = serde_json::from_str::<serde_json::Value>(&m.payload)
                .ok()
                .and_then(|v| v["task"].as_str().map(str::to_string))
                .unwrap_or_else(|| m.payload.chars().take(80).collect());
            let cid = m.correlation_id.clone().unwrap_or_else(|| m.id.clone());
            claimed.push((m.from_agent.clone(), desc, cid));
        }
        if m.topic == "task.done" {
            if let Some(cid) = &m.correlation_id {
                claimed.retain(|(_, _, c)| c != cid);
            } else {
                // No correlation id — remove by agent
                claimed.retain(|(from, _, _)| from != &m.from_agent);
            }
        }
    }

    if claimed.is_empty() {
        return JsonRpcResponse::ok(id, json!({
            "content": [{ "type": "text", "text": "No tasks currently in progress. All clear to start work." }]
        }));
    }

    let lines: Vec<String> = claimed.iter().map(|(from, desc, _)| {
        format!("• {} — {}", &from[..from.len().min(12)], desc)
    }).collect();

    let text = format!(
        "{} task(s) currently in progress — do not duplicate these:

{}

         Call task_claim with a description that does not conflict with any of the above.",
        claimed.len(),
        lines.join("
"),
    );

    JsonRpcResponse::ok(id, json!({
        "content": [{ "type": "text", "text": text }]
    }))
}

// ── Axum router ───────────────────────────────────────────────────────────
// Mount at /mcp/:runbox_id
pub fn router(state: McpState) -> Router {
    Router::new()
        .route("/:runbox_id", post(mcp_handler))
        .with_state(state)
}

// ── MCP config writer — all supported agents ─────────────────────────────
// Each agent reads its MCP server list from a different file/format.
// We write all of them so any agent that supports MCP gets the stackbox tools.
pub fn write_mcp_config(cwd: &str, runbox_id: &str, session_id: &str) -> Result<(), String> {
    use crate::git_memory::MEMORY_PORT;
    let base = std::path::Path::new(cwd);
    let url  = format!("http://127.0.0.1:{}/mcp/{}", MEMORY_PORT, runbox_id);
    let auth = format!("Bearer {}", session_id);

    // ── Claude Code — .claude/mcp.json ───────────────────────────────────
    {
        let config = serde_json::json!({
            "mcpServers": {
                "stackbox": {
                    "type": "http", "url": url,
                    "headers": { "Authorization": auth },
                    "description": "Stackbox agent bus — call tasks_in_progress before starting any task"
                }
            }
        });
        let dir = base.join(".claude");
        std::fs::create_dir_all(&dir).ok();
        std::fs::write(dir.join("mcp.json"), serde_json::to_string_pretty(&config).unwrap()).ok();
    }

    // ── Codex — .codex/mcp.json (same format as Claude) ──────────────────
    {
        let config = serde_json::json!({
            "mcpServers": {
                "stackbox": { "type": "http", "url": url, "headers": { "Authorization": auth } }
            }
        });
        let dir = base.join(".codex");
        std::fs::create_dir_all(&dir).ok();
        std::fs::write(dir.join("mcp.json"), serde_json::to_string_pretty(&config).unwrap()).ok();
    }

    // ── Gemini CLI — .gemini/mcp.json ─────────────────────────────────────
    {
        let config = serde_json::json!({
            "mcpServers": [{
                "name": "stackbox",
                "transport": { "type": "http", "url": url },
                "headers": { "Authorization": auth }
            }]
        });
        let dir = base.join(".gemini");
        std::fs::create_dir_all(&dir).ok();
        std::fs::write(dir.join("mcp.json"), serde_json::to_string_pretty(&config).unwrap()).ok();
    }

    // ── OpenCode — .opencode/mcp.json ─────────────────────────────────────
    {
        let config = serde_json::json!({
            "providers": [{
                "name": "stackbox",
                "type": "http",
                "url":  url,
                "headers": { "Authorization": auth }
            }]
        });
        let dir = base.join(".opencode");
        std::fs::create_dir_all(&dir).ok();
        std::fs::write(dir.join("mcp.json"), serde_json::to_string_pretty(&config).unwrap()).ok();
    }

    // ── Cursor Agent — .cursor/mcp.json ──────────────────────────────────
    {
        let config = serde_json::json!({
            "mcpServers": {
                "stackbox": { "command": "npx", "args": ["-y", "mcp-remote", &url],
                    "env": { "MCP_REMOTE_HEADER_AUTHORIZATION": &auth } }
            }
        });
        let dir = base.join(".cursor");
        std::fs::create_dir_all(&dir).ok();
        std::fs::write(dir.join("mcp.json"), serde_json::to_string_pretty(&config).unwrap()).ok();
    }

    eprintln!("[mcp] wrote MCP configs for all agents — runbox={runbox_id}");
    Ok(())
}

// ── Helpers ────────────────────────────────────────────────────────────────
fn extract_session_id(headers: &axum::http::HeaderMap) -> String {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("mcp-client")
        .to_string()
}

fn format_ms_ago(ms: i64) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    let diff = (now - ms).max(0) / 1000;
    if diff < 60    { return "just now".to_string(); }
    if diff < 3600  { return format!("{}m ago", diff / 60); }
    if diff < 86400 { return format!("{}h ago", diff / 3600); }
    format!("{}d ago", diff / 86400)
}