// src-tauri/src/commands/watcher.rs

use tauri::AppHandle;

use crate::{
    pty::{expand_cwd, watcher},
    state::AppState,
};

#[tauri::command]
pub fn watch_runbox(
    app: AppHandle,
    runbox_id: String,
    cwd: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let cwd_expanded = expand_cwd(&cwd);
    watcher::start(
        app,
        state.db.clone(),
        runbox_id,
        cwd_expanded,
        state.watchers.clone(),
    )
}

#[tauri::command]
pub fn unwatch_runbox(runbox_id: String, state: tauri::State<'_, AppState>) {
    watcher::stop(&runbox_id, &state.watchers);
}
