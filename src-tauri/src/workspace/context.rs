// src-tauri/src/workspace/context.rs
//
// Builds .stackbox-context.md from current workspace state.
//
// Rewritten on:
//   AgentSpawned
//   CommandExecuted
//   CommandResult
//   WorkspaceSnapshot
//
// NOT rewritten on every FileChanged — too noisy.
//
// Agents read this file. It tells them:
//   - what this workspace is
//   - what happened recently
//   - what memories exist from previous sessions
//   - how to write memories

use crate::{
    db::{Db, events::{events_recent, events_by_type}},
    memory,
    workspace::events::{COMMAND_RESULT, WORKSPACE_SNAPSHOT, COMMAND_EXECUTED},
    agent::kind::AgentKind,
};

pub const MEMORY_PORT: u16 = 7547;

/// Write .stackbox-context.md to the workspace directory.
/// Called on significant workspace transitions.
pub async fn rewrite_context(
    db:         &Db,
    runbox_id:  &str,
    session_id: &str,
    cwd:        &str,
    agent:      &AgentKind,
) -> Result<(), String> {
    let content = build(db, runbox_id, session_id, cwd, agent).await?;
    let path    = std::path::Path::new(cwd).join(".stackbox-context.md");
    std::fs::write(&path, &content).map_err(|e| format!("write context: {e}"))?;
    Ok(())
}

/// Build the context string. Exported so agent/context.rs can extend it.
pub async fn build(
    db:         &Db,
    runbox_id:  &str,
    session_id: &str,
    cwd:        &str,
    agent:      &AgentKind,
) -> Result<String, String> {
    let port = MEMORY_PORT;
    let base = format!("http://localhost:{port}");

    // ── Recent workspace events ───────────────────────────────────────────
    let recent = events_recent(db, runbox_id, 20).unwrap_or_default();
    let recent_section = if recent.is_empty() {
        "No recent workspace activity.".to_string()
    } else {
        recent.iter().rev().map(|e| {
            let ts  = format_ms_ago(e.timestamp);
            let pay = e.payload_json.chars().take(120).collect::<String>();
            format!("- [{ts}] **{}** {}", e.event_type, pay)
        }).collect::<Vec<_>>().join("\n")
    };

    // ── Last command result ───────────────────────────────────────────────
    let last_result = events_by_type(db, runbox_id, COMMAND_RESULT, 1)
        .unwrap_or_default()
        .into_iter()
        .next()
        .map(|e| {
            let v = serde_json::from_str::<serde_json::Value>(&e.payload_json)
                .unwrap_or_default();
            let exit = v.get("exit_code").and_then(|x| x.as_i64()).unwrap_or(-1);
            let dur  = v.get("duration_ms").and_then(|x| x.as_i64()).unwrap_or(0);
            format!("exit={exit} duration={dur}ms")
        })
        .unwrap_or_else(|| "none".to_string());

    // ── Last snapshot ─────────────────────────────────────────────────────
    let last_snapshot = events_by_type(db, runbox_id, WORKSPACE_SNAPSHOT, 1)
        .unwrap_or_default()
        .into_iter()
        .next()
        .map(|e| {
            let v = serde_json::from_str::<serde_json::Value>(&e.payload_json)
                .unwrap_or_default();
            let hash = v.get("git_head").and_then(|x| x.as_str()).unwrap_or("unknown");
            let msg  = v.get("message").and_then(|x| x.as_str()).unwrap_or("");
            format!("{hash} — {msg}")
        })
        .unwrap_or_else(|| "no snapshots yet".to_string());

    // ── Memories ──────────────────────────────────────────────────────────
    let memories        = memory::memories_for_runbox(runbox_id).await.unwrap_or_default();
    let global_memories = memory::memories_for_runbox("__global__").await.unwrap_or_default();
    let all_memories: Vec<_> = memories.iter().chain(global_memories.iter()).collect();

    let memory_section = if all_memories.is_empty() {
        "No memories yet.".to_string()
    } else {
        all_memories.iter().take(20).map(|m| {
            let pin = if m.pinned { " 📌" } else { "" };
            let ts  = format_ms_ago(m.timestamp);
            format!("- [{ts}]{pin} {}", m.content.trim())
        }).collect::<Vec<_>>().join("\n")
    };

    // ── Agent identity ────────────────────────────────────────────────────
    let agent_line = format!(
        "> **You are: {}** (session `{}`)",
        agent.display_name(),
        &session_id[..session_id.len().min(8)],
    );

    // ── Memory write snippet ──────────────────────────────────────────────
    let memory_snippet = format!(
        "```bash\ncurl -s -X POST {base}/memory \\\n  -H 'Content-Type: application/json' \\\n  -d '{{\"runbox_id\":\"{runbox_id}\",\"content\":\"YOUR SUMMARY\"}}'\n```"
    );

    Ok(format!(
        "# Stackbox Workspace Context\n\
         > Auto-generated. Reflects current workspace state.\n\
         > Do not edit — your changes will be overwritten.\n\
         \n\
         {agent_line}\n\
         \n\
         ## Recent Workspace Activity\n\
         \n\
         {recent_section}\n\
         \n\
         ## Last Command Result\n\
         \n\
         {last_result}\n\
         \n\
         ## Last Snapshot\n\
         \n\
         {last_snapshot}\n\
         \n\
         ## Memories From Previous Sessions\n\
         \n\
         {memory_section}\n\
         \n\
         ## Instructions\n\
         \n\
         You are working in a reactive workspace. React to the state above.\n\
         Before starting any task, read the recent activity — another agent may have \
         already done it.\n\
         After completing work, save a memory (1–3 sentences):\n\
         \n\
         {memory_snippet}\n\
         \n\
         ---\n\
         *Managed by Stackbox*\n",
    ))
}

fn format_ms_ago(ms: i64) -> String {
    let now  = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    let diff = (now - ms).max(0) / 1000;
    if diff < 60    { return "just now".to_string(); }
    if diff < 3600  { return format!("{}m ago", diff / 60); }
    if diff < 86400 { return format!("{}h ago", diff / 3600); }
    format!("{}d ago", diff / 86400)
}
