use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use crate::git::diff::diff_live;

struct WatchEntry {
    _watcher:      RecommendedWatcher,
    last_scheduled: Arc<Mutex<Option<Instant>>>,
}

static WATCHERS: Mutex<Option<HashMap<String, WatchEntry>>> = Mutex::new(None);

// Fire 150ms after the LAST change in a burst — fast enough to feel instant
const DEBOUNCE_MS: u64 = 150;

pub fn start_watch(app: AppHandle, cwd: String, runbox_id: String) {
    let mut guard = WATCHERS.lock().unwrap();
    let map = guard.get_or_insert_with(HashMap::new);

    // Already watching this path — do nothing
    if map.contains_key(&cwd) { return; }

    let cwd_clone    = cwd.clone();
    let runbox_clone = runbox_id.clone();
    let app_clone    = app.clone();

    // Tracks when we last scheduled a diff emission
    let last_scheduled: Arc<Mutex<Option<Instant>>> = Arc::new(Mutex::new(None));
    let last_scheduled_clone = Arc::clone(&last_scheduled);

    let watcher = RecommendedWatcher::new(
        move |res: notify::Result<notify::Event>| {
            let Ok(ev) = res else { return };

            // Skip pure .git internal writes (HEAD updates, index, etc.)
            let all_git = ev.paths.iter().all(|p| {
                p.components().any(|c| c.as_os_str() == ".git")
            });
            if all_git { return; }

            let now = Instant::now();

            // Record that a change just happened
            {
                let mut last = last_scheduled_clone.lock().unwrap();
                *last = Some(now);
            }

            // Spawn a debounce thread — only the LAST one will actually emit
            let cwd2   = cwd_clone.clone();
            let rid2   = runbox_clone.clone();
            let app2   = app_clone.clone();
            let lsc    = Arc::clone(&last_scheduled_clone);

            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(DEBOUNCE_MS));

                // If another change came in after us, bail — let that thread emit
                let scheduled = lsc.lock().unwrap();
                if let Some(t) = *scheduled {
                    if t > now { return; }
                }
                drop(scheduled);

                match diff_live(&cwd2, &rid2) {
                    Ok(files) => {
                        let _ = app2.emit("git:live-diff", &files);
                    }
                    Err(e) => eprintln!("[watcher] diff_live error: {e}"),
                }
            });
        },
        Config::default(),
    );

    match watcher {
        Ok(mut w) => {
            if w.watch(std::path::Path::new(&cwd), RecursiveMode::Recursive).is_ok() {
                eprintln!("[watcher] watching {cwd}");
                map.insert(cwd, WatchEntry { _watcher: w, last_scheduled });
            } else {
                eprintln!("[watcher] failed to watch path: {cwd}");
            }
        }
        Err(e) => eprintln!("[watcher] failed to create watcher: {e}"),
    }
}

pub fn stop_watch(cwd: &str) {
    if let Ok(mut guard) = WATCHERS.lock() {
        if let Some(map) = guard.as_mut() {
            if map.remove(cwd).is_some() {
                eprintln!("[watcher] stopped watching {cwd}");
            }
        }
    }
}