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
    event_type: Option<String>,
    limit:      Option<usize>,
    state:      tauri::State<'_, AppState>,
) -> Result<Vec<db::WorkspaceEvent>, String> {
    let lim = limit.unwrap_or(20);
    if let Some(et) = event_type {
        db::events::events_by_type(&state.db, &runbox_id, &et, lim).map_err(|e| e.to_string())
    } else {
        db::events::events_recent(&state.db, &runbox_id, lim).map_err(|e| e.to_string())
    }
}
