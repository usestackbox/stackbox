// src-tauri/src/workspace/events.rs
//
// The five workspace event types. This is the entire event vocabulary.
// Do not add new types without strong justification.
//
// AgentSpawned      — agent process entered the runbox
// CommandExecuted   — command was run (PTY input)
// CommandResult     — command completed (exit code + duration)
// FileChanged       — file modified in workspace (debounced)
// WorkspaceSnapshot — git checkpoint (commit or auto-snapshot)

use crate::db::{events::event_record, Db};

pub const AGENT_SPAWNED: &str = "AgentSpawned";
pub const COMMAND_EXECUTED: &str = "CommandExecuted";
pub const COMMAND_RESULT: &str = "CommandResult";
pub const FILE_CHANGED: &str = "FileChanged";
pub const WORKSPACE_SNAPSHOT: &str = "WorkspaceSnapshot";

// ── Typed record helpers ──────────────────────────────────────────────────────
// Each function constructs the flat payload_json and calls event_record.
// Payload rules: flat key-value only, no nesting, no arrays.

pub fn record_agent_spawned(db: &Db, runbox_id: &str, session_id: &str, agent: &str, cwd: &str) {
    let payload = serde_json::json!({
        "agent": agent,
        "cwd":   cwd,
    })
    .to_string();
    let _ = event_record(db, runbox_id, session_id, AGENT_SPAWNED, "pty", &payload);
}

pub fn record_command_executed(
    db: &Db,
    runbox_id: &str,
    session_id: &str,
    command: &str,
    cwd: &str,
) {
    let payload = serde_json::json!({
        "command": &command[..command.len().min(300)],
        "cwd":     cwd,
    })
    .to_string();
    let _ = event_record(db, runbox_id, session_id, COMMAND_EXECUTED, "pty", &payload);
}

pub fn record_command_result(
    db: &Db,
    runbox_id: &str,
    session_id: &str,
    exit_code: i32,
    duration_ms: i64,
) {
    let payload = serde_json::json!({
        "exit_code":   exit_code,
        "duration_ms": duration_ms,
    })
    .to_string();
    let _ = event_record(db, runbox_id, session_id, COMMAND_RESULT, "pty", &payload);
}

pub fn record_file_changed(
    db: &Db,
    runbox_id: &str,
    path: &str,
    change: &str, // "modified" | "created" | "deleted"
) {
    let payload = serde_json::json!({
        "path":   path,
        "change": change,
    })
    .to_string();
    let _ = event_record(db, runbox_id, "", FILE_CHANGED, "watcher", &payload);
}

pub fn record_workspace_snapshot(
    db: &Db,
    runbox_id: &str,
    session_id: &str,
    git_head: &str,
    message: &str,
) {
    let payload = serde_json::json!({
        "git_head": git_head,
        "message":  &message[..message.len().min(200)],
    })
    .to_string();
    let _ = event_record(
        db,
        runbox_id,
        session_id,
        WORKSPACE_SNAPSHOT,
        "git",
        &payload,
    );
}
