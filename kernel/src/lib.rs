// src/lib.rs

mod agent;
mod browser;
mod conflict;
mod db;
mod docker;
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

use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state::AppState {
            sessions:          Arc::new(Mutex::new(HashMap::new())),
            db:                db::open().expect("failed to open stackbox db"),
            watchers:          Arc::new(Mutex::new(HashMap::new())),
            watched_runboxes:  Arc::new(Mutex::new(HashSet::new())),
            reinject_debounce: Arc::new(Mutex::new(HashMap::new())),
            pty_writer:        crate::pty::writer::PtyWriter::new(),
            conflict_registry: conflict::new_registry(),
        })
        .setup(|app| {
            agent::globals::set_app_handle(app.handle().clone());

            let app_handle      = Arc::new(app.handle().clone());
            let state           = app.state::<state::AppState>();
            let db_handle       = state.db.clone();
            let sessions_handle = state.sessions.clone();
            let app_state       = Arc::new(state::AppState {
                db:                db_handle.clone(),
                sessions:          sessions_handle.clone(),
                watchers:          state.watchers.clone(),
                watched_runboxes:  state.watched_runboxes.clone(),
                reinject_debounce: state.reinject_debounce.clone(),
                pty_writer:        state.pty_writer.clone(),
                conflict_registry: state.conflict_registry.clone(),
            });

            git::cleanup::prune_orphan_worktrees(&state.db);

            tauri::async_runtime::spawn(async move {
                match memory::init().await {
                    Ok(_) => {
                        eprintln!("[memory] init complete");
                        app_handle.emit("memory-ready", ()).ok();
                        tauri::async_runtime::spawn(async {
                            agent::embedder::init_embedder().await;
                            agent::scorer::decay_prune().await;
                        });
                    }
                    Err(e) => {
                        eprintln!("[memory] init failed: {e}");
                        app_handle.emit("memory-error", e).ok();
                    }
                }

                let webhook_state = app_state.clone();
                tauri::async_runtime::spawn(async move {
                    git::start_webhook_server(webhook_state).await;
                });

                server::start(app_handle, db_handle, sessions_handle, app_state).await;
            });

            Ok(())
        })
        .register_uri_scheme_protocol("proxy", |_ctx, req| proxy::handle(req))
        .invoke_handler(tauri::generate_handler![
            commands::pty::pty_spawn,
            commands::pty::pty_write,
            commands::pty::pty_resize,
            commands::pty::pty_kill,
            commands::watcher::watch_runbox,
            commands::watcher::unwatch_runbox,
            // ── Memory V1/V2 ─────────────────────────────────────────────────
            commands::memory::memory_add,
            commands::memory::memory_add_full,
            commands::memory::memory_list,
            commands::memory::memory_list_branch,
            commands::memory::memory_branches,
            commands::memory::memory_tags,
            commands::memory::memory_list_by_tag,
            commands::memory::memory_delete,
            commands::memory::memory_pin,
            commands::memory::memory_update,
            commands::memory::memory_update_tags,
            commands::memory::memory_move_branch,
            commands::memory::memory_delete_for_runbox,
            commands::memory::memory_search_global,
            commands::memory::memory_add_typed_cmd,
            commands::memory::memory_list_by_type,
            commands::memory::memory_active_blockers,
            commands::memory::memory_resolve_blocker,
            commands::memory::memory_get_context,
            commands::memory::memory_confirm_env,
            commands::memory::memory_decay_prune,
            // ── Memory V3 ────────────────────────────────────────────────────
            commands::memory::memory_add_locked,
            commands::memory::memory_list_by_level,
            commands::memory::memory_list_locked,
            commands::memory::memory_list_temporary_for_agent,
            commands::memory::memory_expire_temporary,
            commands::memory::memory_remember,
            // ── DB ───────────────────────────────────────────────────────────
            commands::db::db_sessions_for_runbox,
            commands::db::db_events_for_runbox,
            commands::db::get_worktree_path,
            commands::db::get_worktree_record,
            commands::db::get_workspace_worktrees,
            commands::db::set_worktree_path,
            commands::db::set_pr_url,
            commands::db::set_agent_status,
            // ── Git ──────────────────────────────────────────────────────────
            git::commands::git_ensure,
            git::commands::git_agent_worktree,
            git::commands::git_push_pr,
            git::commands::git_pull_merged,
            git::commands::git_log_for_runbox,
            git::commands::git_diff_for_commit,
            git::commands::git_diff_live,
            git::commands::git_worktree_create,
            git::commands::git_worktree_remove,
            git::commands::git_current_branch,
            git::commands::git_stage_and_commit,
            git::commands::git_worktree_list,
            git::commands::git_watch_start,
            git::commands::git_watch_stop,
            git::commands::git_push,
            git::commands::git_init,
            git::commands::git_stage_file,
            git::commands::git_unstage_file,
            git::commands::git_conflicts,
            git::commands::git_branches,
            git::commands::git_checkout,
            git::commands::git_diff_between_worktrees,
            git::commands::git_commit,
            git::commands::git_worktree_delete,
            git::commands::git_worktree_list_stackbox,
            git::commands::git_discard_file,     // NEW
            git::commands::git_pr_view,          // NEW
            git::commands::git_pr_merge,         // NEW
            // ── Conflict ─────────────────────────────────────────────────────
            conflict::conflict_request_lock,
            conflict::conflict_release_lock,
            conflict::conflict_verify_write,
            conflict::conflict_get_state,
            conflict::conflict_clear,
            // ── FS ───────────────────────────────────────────────────────────
            commands::fs::open_directory_dialog,
            commands::fs::open_in_editor,
            commands::fs::read_text_file,
            commands::fs::fs_list_dir,
            commands::fs::fs_rename,
            commands::fs::fs_delete,
            commands::fs::fs_create_dir,
            commands::fs::fs_create_file,
            commands::fs::copy_to_clipboard,
            commands::fs::fs_write_file,
            commands::fs::fs_search_in_files,
            // ── Browser ──────────────────────────────────────────────────────
            browser::webview::browser_create,
            browser::webview::browser_destroy,
            browser::webview::browser_navigate,
            browser::webview::browser_set_bounds,
            browser::webview::browser_go_back,
            browser::webview::browser_go_forward,
            browser::webview::browser_reload,
            browser::webview::browser_show,
            browser::webview::browser_hide,
            // ── Docker ───────────────────────────────────────────────────────
            docker::docker_available,
            docker::docker_status,
            docker::docker_ensure,
            docker::docker_stop,
            docker::docker_remove,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}