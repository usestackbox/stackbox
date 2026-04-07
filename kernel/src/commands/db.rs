// src/commands/db.rs
//
// Tauri commands for DB queries exposed to the frontend.

use crate::{db, state::AppState};

// ─────────────────────────────────────────────────────────────────────────────
// Session / event queries
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn db_sessions_for_runbox(
    runbox_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<db::Session>, String> {
    db::sessions::sessions_for_runbox(&state.db, &runbox_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_events_for_runbox(
    runbox_id: String,
    query: Option<String>,
    event_type: Option<String>,
    limit: Option<usize>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<db::WorkspaceEvent>, String> {
    let lim = limit.unwrap_or(50);

    if let Some(q) = query.as_deref().filter(|q| !q.trim().is_empty()) {
        return db::events::events_search(&state.db, &runbox_id, q, lim).map_err(|e| e.to_string());
    }

    if let Some(et) = event_type {
        db::events::events_by_type(&state.db, &runbox_id, &et, lim).map_err(|e| e.to_string())
    } else {
        db::events::events_recent(&state.db, &runbox_id, lim).map_err(|e| e.to_string())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Worktree queries
// ─────────────────────────────────────────────────────────────────────────────

/// Get the worktree path for a runbox (fast path — path string only).
#[tauri::command]
pub fn get_worktree_path(runbox_id: String, state: tauri::State<'_, AppState>) -> Option<String> {
    db::runboxes::runbox_get_worktree(&state.db, &runbox_id)
}

/// Get full worktree record including status, branch, PR url.
#[tauri::command]
pub fn get_worktree_record(
    runbox_id: String,
    state: tauri::State<'_, AppState>,
) -> Option<db::runboxes::WorktreeRecord> {
    db::runboxes::runbox_get_worktree_record(&state.db, &runbox_id)
}

/// Get all worktrees for a workspace — shows every agent and its status.
#[tauri::command]
pub fn get_workspace_worktrees(
    workspace_cwd: String,
    state: tauri::State<'_, AppState>,
) -> Vec<db::runboxes::WorktreeRecord> {
    db::runboxes::workspace_list_worktrees(&state.db, &workspace_cwd)
}

// ─────────────────────────────────────────────────────────────────────────────
// Worktree writes (called by agent via MCP or frontend)
// ─────────────────────────────────────────────────────────────────────────────

/// Called by agent via MCP after it creates/attaches to a worktree.
#[tauri::command]
pub fn set_worktree_path(
    runbox_id: String,
    agent_kind: String,
    worktree_path: Option<String>,
    branch: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    db::runboxes::runbox_set_worktree(
        &state.db,
        &runbox_id,
        &agent_kind,
        worktree_path.as_deref(),
        branch.as_deref(),
    )
    .map_err(|e| e.to_string())
}

/// Called by agent via MCP after it opens a PR.
#[tauri::command]
pub fn set_pr_url(
    runbox_id: String,
    pr_url: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    db::runboxes::runbox_set_pr(&state.db, &runbox_id, &pr_url).map_err(|e| e.to_string())
}

/// Called by agent via MCP to update its lifecycle status.
/// Valid values: working | pr_open | approved | changes_requested | merged | cancelled | error
#[tauri::command]
pub fn set_agent_status(
    runbox_id: String,
    status: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    db::runboxes::runbox_set_status(&state.db, &runbox_id, &status).map_err(|e| e.to_string())
}
