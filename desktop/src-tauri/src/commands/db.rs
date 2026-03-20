// src-tauri/src/commands/db.rs

use crate::{db, state::AppState};

#[tauri::command]
pub fn db_sessions_for_runbox(
    runbox_id: String,
    state:     tauri::State<'_, AppState>,
) -> Result<Vec<db::Session>, String> {
    db::sessions::sessions_for_runbox(&state.db, &runbox_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_events_for_runbox(
    runbox_id:  String,
    query:      Option<String>,   // BM25 full-text search — from MemoryPanel EventLog
    event_type: Option<String>,   // type filter — AgentSpawned, FileChanged, etc.
    limit:      Option<usize>,
    state:      tauri::State<'_, AppState>,
) -> Result<Vec<db::WorkspaceEvent>, String> {
    let lim = limit.unwrap_or(50);

    // BM25 search takes priority over type filter
    if let Some(q) = query.as_deref().filter(|q| !q.trim().is_empty()) {
        return db::events::events_search(&state.db, &runbox_id, q, lim)
            .map_err(|e| e.to_string());
    }

    if let Some(et) = event_type {
        db::events::events_by_type(&state.db, &runbox_id, &et, lim)
            .map_err(|e| e.to_string())
    } else {
        db::events::events_recent(&state.db, &runbox_id, lim)
            .map_err(|e| e.to_string())
    }
}