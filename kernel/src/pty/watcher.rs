// src-tauri/src/pty/watcher.rs
//
// File system watcher — emits FileChanged workspace events.
// Debounced at 300ms. Ignores .git internals and context files.

use std::time::Duration;

use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use tauri::{AppHandle, Emitter};

use crate::{db::Db, workspace::events::record_file_changed};

pub fn start(
    app: AppHandle,
    db: Db,
    runbox_id: String,
    cwd: String,
    watchers: crate::state::WatcherMap,
) -> Result<(), String> {
    let rid = runbox_id.clone();
    let db2 = db.clone();
    let cwd_path = cwd.clone();

    let debouncer = new_debouncer(
        Duration::from_millis(300),
        move |res: notify_debouncer_mini::DebounceEventResult| {
            if let Ok(events) = res {
                for e in events {
                    if !matches!(e.kind, DebouncedEventKind::Any) {
                        continue;
                    }

                    let p = e.path.to_string_lossy();
                    // Skip .git internals and Stackbox-managed files
                    if p.contains("/.git/") || p.contains("\\.git\\") {
                        continue;
                    }
                    if p.ends_with(".stackbox-context.md") {
                        continue;
                    }
                    if p.ends_with("CLAUDE.md")
                        || p.ends_with("AGENTS.md")
                        || p.ends_with("GEMINI.md")
                    {
                        continue;
                    }

                    let path_str = e
                        .path
                        .strip_prefix(&cwd)
                        .unwrap_or(&e.path)
                        .to_string_lossy()
                        .to_string();

                    let change = if e.path.exists() {
                        "modified"
                    } else {
                        "deleted"
                    };

                    record_file_changed(&db2, &rid, &path_str, change);
                    let _ = app.emit(
                        "file-changed",
                        serde_json::json!({
                            "runbox_id": rid,
                            "path":      path_str,
                        }),
                    );
                }
            }
        },
    )
    .map_err(|e| e.to_string())?;

    {
        let mut d = debouncer;
        d.watcher()
            .watch(
                std::path::Path::new(&cwd_path),
                notify::RecursiveMode::Recursive,
            )
            .map_err(|e| e.to_string())?;
        watchers.lock().unwrap().insert(runbox_id, d);
    }

    Ok(())
}

pub fn stop(runbox_id: &str, watchers: &crate::state::WatcherMap) {
    watchers.lock().unwrap().remove(runbox_id);
}
