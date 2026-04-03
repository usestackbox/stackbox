// src-tauri/src/workspace/snapshot.rs
//
// WorkspaceSnapshot — a checkpoint of the workspace state.
// Created on: git commit, auto-snapshot on session end, explicit user action.
// Tool-agnostic: git is the default source, but other sources can create snapshots too.

use crate::{db::Db, workspace::events::record_workspace_snapshot};

/// Read current git HEAD and create a WorkspaceSnapshot event.
/// Returns the short hash, or empty string if not a git repo.
pub fn snapshot_from_git(
    db:         &Db,
    runbox_id:  &str,
    session_id: &str,
    cwd:        &str,
) -> String {
    let head = git_head(cwd);
    let msg  = git_last_message(cwd);

    if !head.is_empty() {
        record_workspace_snapshot(db, runbox_id, session_id, &head, &msg);
        eprintln!("[snapshot] WorkspaceSnapshot: {head} — {msg}");
    }
    head
}

/// Create a snapshot with an explicit message (auto-snapshot, user action).
pub fn snapshot_manual(
    db:         &Db,
    runbox_id:  &str,
    session_id: &str,
    cwd:        &str,
    message:    &str,
) {
    let head = git_head(cwd);
    record_workspace_snapshot(db, runbox_id, session_id, &head, message);
}

fn git_head(cwd: &str) -> String {
    std::process::Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .current_dir(cwd)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

fn git_last_message(cwd: &str) -> String {
    std::process::Command::new("git")
        .args(["log", "--oneline", "-1", "--format=%s"])
        .current_dir(cwd)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}
