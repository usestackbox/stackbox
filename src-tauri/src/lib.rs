#![allow(dead_code, unused_imports, unused_variables, unused_assignments)]
mod agent;
mod browser;
mod db;
mod git;
mod mcp;
mod memory;
mod proxy;
mod pty;
mod server;
mod state;
mod workspace;
mod commands;

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state::AppState {
            sessions:          Arc::new(Mutex::new(HashMap::new())),
            db:                db::open().expect("failed to open stackbox db"),
            watchers:          Arc::new(Mutex::new(HashMap::new())),
            watched_runboxes:  Arc::new(Mutex::new(HashSet::new())),
            reinject_debounce: Arc::new(Mutex::new(HashMap::new())),
        })
        .setup(|app| {
            // ── Global singletons ─────────────────────────────────────────
            agent::globals::set_app_handle(app.handle().clone());

            // ── Memory init ───────────────────────────────────────────────
            tauri::async_runtime::spawn(async {
                memory::init().await.expect("memory init failed");
            });

            // ── HTTP server ───────────────────────────────────────────────
            let app_handle = Arc::new(app.handle().clone());
            let db_handle  = app.state::<state::AppState>().db.clone();

            tauri::async_runtime::spawn(async move {
                server::start(app_handle, db_handle, ()).await;
            });

            Ok(())
        })
        .register_uri_scheme_protocol("proxy", |_ctx, req| proxy::handle(req))
        .invoke_handler(tauri::generate_handler![
            // ── PTY ───────────────────────────────────────────────────────
            commands::pty::pty_spawn,
            commands::pty::pty_write,
            commands::pty::pty_resize,
            commands::pty::pty_kill,
            // ── File watcher ──────────────────────────────────────────────
            commands::watcher::watch_runbox,
            commands::watcher::unwatch_runbox,
            // ── Memory ────────────────────────────────────────────────────
            commands::memory::memory_add,
            commands::memory::memory_list,
            commands::memory::memory_delete,
            commands::memory::memory_pin,
            commands::memory::memory_update,
            commands::memory::memory_delete_for_runbox,
            // ── DB / events ───────────────────────────────────────────────
            commands::db::db_sessions_for_runbox,
            commands::db::db_events_for_runbox,
            // ── Git ───────────────────────────────────────────────────────
            git::commands::git_ensure,
            git::commands::git_log_for_runbox,
            git::commands::git_diff_for_commit,
            git::commands::git_diff_live,
            git::commands::git_worktree_create,
            git::commands::git_worktree_remove,
            git::commands::git_current_branch,
            git::commands::git_stage_and_commit,
            // ── Filesystem ────────────────────────────────────────────────
            commands::fs::open_directory_dialog,
            commands::fs::open_in_editor,
            commands::fs::read_text_file,
            // ── Browser ───────────────────────────────────────────────────
            browser::webview::browser_create,
            browser::webview::browser_destroy,
            browser::webview::browser_navigate,
            browser::webview::browser_set_bounds,
            browser::webview::browser_go_back,
            browser::webview::browser_go_forward,
            browser::webview::browser_reload,
            browser::webview::browser_show,
            browser::webview::browser_hide,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
