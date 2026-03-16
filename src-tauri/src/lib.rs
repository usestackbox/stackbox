// src-tauri/src/lib.rs

mod browser;
mod bus;
mod db;
mod memory;
mod git_memory;
mod mcp;

use browser::{
    browser_create, browser_destroy, browser_navigate, browser_set_bounds,
    browser_go_back, browser_go_forward, browser_reload, browser_show, browser_hide,
};

use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::{
    collections::HashMap,
    convert::Infallible,
    io::{Read, Write},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};
use tauri::http::{Request, Response};

// ── CWD expansion ─────────────────────────────────────────────────────────────
fn expand_cwd(raw: &str) -> String {
    let s = raw.trim();
    let expanded = if s == "~" || s.starts_with("~/") || s.starts_with("~\\") {
        if let Some(home) = dirs::home_dir() {
            let rest = s[1..].trim_start_matches('/').trim_start_matches('\\');
            if rest.is_empty() { home.to_string_lossy().to_string() }
            else { home.join(rest).to_string_lossy().to_string() }
        } else { s.to_string() }
    } else { s.to_string() };

    #[cfg(windows)]
    if expanded.contains('%') {
        if let Ok(v) = std::env::var("USERPROFILE") {
            return expanded.replace("%USERPROFILE%", &v).replace("%userprofile%", &v);
        }
    }
    expanded
}

// ── Proxy scheme ──────────────────────────────────────────────────────────────
const PROXY_BASE: &str = "proxy://localhost/fetch?url=";

fn resolve_url(base: &str, href: &str) -> String {
    if href.starts_with("http://") || href.starts_with("https://") { return href.to_string(); }
    if href.starts_with("//") {
        let scheme = if base.starts_with("https") { "https:" } else { "http:" };
        return format!("{}{}", scheme, href);
    }
    if let Some(idx) = base.find("://") {
        let after = &base[idx + 3..];
        let origin_end = after.find('/').map(|i| idx + 3 + i).unwrap_or(base.len());
        let origin = &base[..origin_end];
        if href.starts_with('/') { return format!("{}{}", origin, href); }
        let path = &base[..base.rfind('/').unwrap_or(base.len())];
        return format!("{}/{}", path, href);
    }
    href.to_string()
}

fn rewrite_urls(body: &str, base_url: &str) -> String {
    let mut out = body.to_string();
    for attr in &["src", "href", "action"] {
        let mut result = String::new();
        let mut remaining = out.as_str();
        let pattern = format!("{}=\"", attr);
        while let Some(start) = remaining.find(&pattern) {
            result.push_str(&remaining[..start + pattern.len()]);
            remaining = &remaining[start + pattern.len()..];
            if let Some(end) = remaining.find('"') {
                let original = &remaining[..end];
                if original.starts_with('#') || original.starts_with("data:") || original.is_empty() {
                    result.push_str(original);
                } else {
                    let resolved = resolve_url(base_url, original);
                    result.push_str(&format!("{}{}", PROXY_BASE, urlencoding::encode(&resolved)));
                }
                remaining = &remaining[end..];
            }
        }
        result.push_str(remaining);
        out = result;
    }
    let base_tag = format!("<base href=\"{}{}\">", PROXY_BASE, urlencoding::encode(base_url));
    let form_shim = format!(r#"<script>
    (function() {{
        const PROXY = {:?};
        document.addEventListener('submit', function(e) {{
            const f = e.target;
            if (!f || f.method.toUpperCase() !== 'GET') return;
            e.preventDefault();
            const fd = new FormData(f);
            const qs = new URLSearchParams(fd).toString();
            const base = f.action || window.location.href;
            window.location.href = PROXY + encodeURIComponent(base.split('?')[0] + '?' + qs);
        }}, true);
    }})();
    </script>"#, PROXY_BASE);
    if let Some(pos) = out.find("</head>") {
        out.insert_str(pos, &(base_tag + &form_shim));
    }
    out
}

fn handle_proxy_request(request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let uri = request.uri().to_string();
    let url = if let Some(pos) = uri.find("?url=") {
        urlencoding::decode(&uri[pos + 5..]).unwrap_or_default().into_owned()
    } else {
        return Response::builder().status(400).body(b"missing url param".to_vec()).unwrap();
    };

    tauri::async_runtime::block_on(async move {
        let client = reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .cookie_store(true)
            .build()
            .unwrap_or_default();

        let resp: reqwest::Response = match client.get(&url).send().await {
            Ok(r)  => r,
            Err(e) => return Response::builder().status(502).body(e.to_string().into_bytes()).unwrap(),
        };

        let status = resp.status().as_u16();
        let mut is_html = false;
        let mut content_type = String::from("application/octet-stream");
        for (k, v) in resp.headers() {
            if k.as_str().to_lowercase() == "content-type" {
                let ct = v.to_str().unwrap_or("").to_string();
                if ct.contains("text/html") { is_html = true; }
                content_type = ct;
            }
        }
        let body_bytes = resp.bytes().await.unwrap_or_default();
        let final_body = if is_html {
            rewrite_urls(&String::from_utf8_lossy(&body_bytes), &url).into_bytes()
        } else {
            body_bytes.to_vec()
        };
        Response::builder()
            .status(status)
            .header("Content-Type", content_type)
            .header("Access-Control-Allow-Origin", "*")
            .body(final_body)
            .unwrap()
    })
}

// ── PTY session ───────────────────────────────────────────────────────────────
struct PtySession {
    writer:         Box<dyn Write + Send>,
    _master:        Box<dyn portable_pty::MasterPty + Send>,
    _child:         Box<dyn portable_pty::Child + Send + Sync>,
    input_buf:      String,
    runbox_id:      String,
    cwd:            String,
    headless:       bool,
    parent_session: Option<String>,
    agent_kind:     git_memory::AgentKind,
    worktree_path:  Option<String>,
}

type SessionMap = Arc<Mutex<HashMap<String, PtySession>>>;

// ── Watcher handle — keeps the debouncer alive ────────────────────────────────
type WatcherMap = Arc<Mutex<HashMap<String, notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>>>>;

type CmdReceiverMap = Arc<std::sync::Mutex<std::collections::HashMap<String, bus::CommandReceiver>>>;

struct AppState {
    sessions:        SessionMap,
    db:              db::Db,
    watchers:        WatcherMap,
    bus_registry:    Arc<bus::BusRegistry>,
    /// Persistent CommandReceivers keyed by session_id.
    /// Stored here so /bus/commands polls drain the SAME channel across requests.
    cmd_receivers:   CmdReceiverMap,
    /// RunBox IDs that already have a bus watcher running.
    /// Prevents duplicate watchers when multiple agents spawn in the same runbox.
    watched_runboxes: Arc<std::sync::Mutex<std::collections::HashSet<String>>>,
    /// Last re-inject timestamp per (runbox_id, peer_session_id).
    /// Prevents re-inject storms when agents publish events rapidly.
    reinject_debounce: Arc<std::sync::Mutex<std::collections::HashMap<String, u64>>>,
}

// ── Bus helper — publish to bus AND persist to SQLite in one call ─────────────
fn bus_publish_and_persist(
    bus_registry: &bus::BusRegistry,
    db:           &db::Db,
    runbox_id:    &str,
    msg:          bus::BusMessage,
) {
    let _ = db::bus_message_insert(db, &msg, runbox_id);
    if let Err(e) = bus_registry.publish(runbox_id, msg) {
        eprintln!("[bus] publish error: {e}");
    }
    // Counter-based TTL prune: every 500 publishes, trim this runbox to 2000 messages.
    {
        static PRUNE_CTR: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = PRUNE_CTR.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        if n % 500 == 0 {
            let db2  = db.clone();
            let rbid = runbox_id.to_string();
            tauri::async_runtime::spawn(async move {
                db::bus_messages_prune(&db2, &rbid, 2000);
            });
        }
    }
}

// ── PTY commands ──────────────────────────────────────────────────────────────
#[tauri::command]
async fn pty_spawn(
    app:            AppHandle,
    session_id:     String,
    runbox_id:      String,
    cwd:            String,
    agent_cmd:      Option<String>,
    headless:       Option<bool>,
    parent_session: Option<String>,
    state:          tauri::State<'_, AppState>,
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    let resolved_cwd = expand_cwd(&cwd);
    let agent_str    = agent_cmd.as_deref().unwrap_or("shell");
    let agent_kind   = git_memory::AgentKind::detect(agent_str);
    let is_headless  = headless.unwrap_or(false);

    // ── Ensure git repo exists ────────────────────────────────────────────
    git_memory::ensure_git_repo(&resolved_cwd, &runbox_id)
        .unwrap_or_else(|e| { eprintln!("[git_memory] ensure_git_repo: {e}"); String::new() });

    // ── Create isolated worktree for this runbox ──────────────────────────
    // Only for real agents (not shell, not headless sub-agents).
    // Headless sub-agents inherit the parent's worktree via their cwd.
    let worktree_path = if agent_kind != git_memory::AgentKind::Shell && !is_headless {
        git_memory::ensure_worktree_for_runbox(&resolved_cwd, &runbox_id)
    } else {
        None
    };

    // Use worktree as the effective cwd if one was created
    let effective_cwd = worktree_path.as_deref().unwrap_or(&resolved_cwd).to_string();

    // ── Record session-start event ────────────────────────────────────────
    let _ = db::event_insert(
        &state.db,
        &runbox_id,
        &session_id,
        "session_start",
        &format!("Agent {:?} started in {}", agent_kind, effective_cwd),
        None,
    );

    // ── Join the Agent Bus ────────────────────────────────────────────────
    let already_spawned = state.sessions.lock().unwrap().contains_key(&session_id);

    let already_spawned = state.sessions.lock().unwrap().contains_key(&session_id);
    let (_agent_handle, cmd_rx) = state.bus_registry.join(&runbox_id, session_id.clone());
    state.cmd_receivers.lock().unwrap().insert(session_id.clone(), cmd_rx);

    // Publish agent.started (or subagent.started for headless) to the bus
    let start_payload = serde_json::json!({
        "session_id":     session_id,
        "agent":          agent_str,
        "cwd":            effective_cwd,
        "worktree":       worktree_path.as_deref().unwrap_or(""),
        "headless":       is_headless,
        "parent_session": parent_session.as_deref().unwrap_or(""),
    }).to_string();

    let start_topic = if is_headless { "subagent.started" } else { "agent.started" };
    let mut start_msg = bus::BusMessage::new(session_id.clone(), start_topic, start_payload);
    if let Some(ref parent) = parent_session {
        start_msg = start_msg.with_correlation(parent.clone());
    }
    if !already_spawned {
        bus_publish_and_persist(&state.bus_registry, &state.db, &runbox_id, start_msg);
    }

    // ── Inject memories + git log non-blocking ────────────────────────────
    {
        let rb    = runbox_id.clone();
        let cwd_c = effective_cwd.clone();
        let ak    = agent_kind.clone();
        let sid_c = session_id.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = git_memory::inject_context_for_agent_with_session(&rb, &cwd_c, &ak, &sid_c).await {
                eprintln!("[git_memory] inject: {e}");
            }
        });
    }

    // ── Shell command ─────────────────────────────────────────────────────
    #[cfg(windows)]
    let mut cmd = {
        let sys_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
        let ps_path  = format!("{}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", sys_root);
        let mut c = CommandBuilder::new(&ps_path);
        c.args(&[
            "-NoLogo", "-NoExit", "-NonInteractive", "-Command",
            r#"function prompt { "~/\" + (Split-Path -Leaf (Get-Location)) + "> " }"#,
        ]);
        c.env("SystemRoot",   &sys_root);
        c.env("USERPROFILE",  std::env::var("USERPROFILE").unwrap_or_default());
        c.env("APPDATA",      std::env::var("APPDATA").unwrap_or_default());
        c.env("LOCALAPPDATA", std::env::var("LOCALAPPDATA").unwrap_or_default());
        c.env("TEMP",         std::env::var("TEMP").unwrap_or_default());
        c.env("TMP",          std::env::var("TMP").unwrap_or_default());
        c.env("PATH",         std::env::var("PATH").unwrap_or_default());
        c
    };

    #[cfg(not(windows))]
    let mut cmd = CommandBuilder::new("bash");

    cmd.cwd(&effective_cwd);

    // ── Browser shim ──────────────────────────────────────────────────────
    {
        let shim_name = if cfg!(windows) { "stackbox-open.exe" } else { "stackbox-open" };
        if let Some(shim_path) = std::env::current_exe().ok()
            .and_then(|p| p.parent().map(|d| d.join(shim_name)))
            .filter(|p| p.exists())
        {
            cmd.env("BROWSER", shim_path.to_string_lossy().to_string());
        }
    }

    // ── API key passthrough ───────────────────────────────────────────────
    if let Ok(key) = std::env::var("ANTHROPIC_API_KEY") {
        cmd.env("ANTHROPIC_API_KEY", key);
    }

    // ── Agent env vars ────────────────────────────────────────────────────
    let ctx_file = format!("{effective_cwd}/.stackbox-context.md");
    cmd.env("STACKBOX_CONTEXT_FILE", &ctx_file);
    cmd.env("STACKBOX_MEMORY_URL",   format!("http://localhost:{}/memory", git_memory::MEMORY_PORT));
    cmd.env("STACKBOX_RUNBOX_ID",    &runbox_id);
    cmd.env("STACKBOX_SESSION_ID",   &session_id);
    cmd.env("STACKBOX_WORKTREE",     worktree_path.as_deref().unwrap_or(""));
    // Expose bus endpoints so agents can publish/subscribe directly
    cmd.env("STACKBOX_BUS_PUBLISH_URL", format!("http://localhost:{}/bus/publish", git_memory::MEMORY_PORT));
    cmd.env("STACKBOX_BUS_STREAM_URL",  format!(
        "http://localhost:{}/bus/stream?runbox_id={}&agent_id={}",
        git_memory::MEMORY_PORT, runbox_id, session_id
    ));
    cmd.env("STACKBOX_BUS_COMMANDS_URL", format!(
        "http://localhost:{}/bus/commands?agent_id={}",
        git_memory::MEMORY_PORT, session_id
    ));

    match &agent_kind {
        git_memory::AgentKind::ClaudeCode    => { cmd.env("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1"); }
        git_memory::AgentKind::Codex         => { cmd.env("CODEX_CONTEXT_FILE", &ctx_file); }
        git_memory::AgentKind::CursorAgent   => { cmd.env("CURSOR_CONTEXT_FILE", &ctx_file); }
        git_memory::AgentKind::GeminiCli     => { cmd.env("GEMINI_SYSTEM_MD", &ctx_file); }
        git_memory::AgentKind::GitHubCopilot => { cmd.env("COPILOT_CONTEXT_FILE", &ctx_file); }
        git_memory::AgentKind::OpenCode      => { cmd.env("OPENCODE_CONTEXT_FILE", &ctx_file); }
        git_memory::AgentKind::Shell         => {}
    }

    let child  = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer     = pair.master.take_writer().map_err(|e| e.to_string())?;

    // ── Auto-launch agent after bash spawns ───────────────────────────────
    if let Some(launch) = agent_kind.launch_cmd_for(&ctx_file) {
        if let Ok(mut w) = pair.master.take_writer() {
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(400)).await;
                let _ = w.write_all(launch.as_bytes());
                let _ = w.flush();
            });
        }
    }

    // ── Record session in DB ──────────────────────────────────────────────
    let _ = db::session_start(
        &state.db, &session_id, &runbox_id,
        "", agent_str, &effective_cwd,
    );

    state.sessions.lock().unwrap().insert(
        session_id.clone(),
        PtySession {
            writer,
            _master:        pair.master,
            _child:         child,
            input_buf:      String::new(),
            runbox_id:      runbox_id.clone(),
            cwd:            effective_cwd.clone(),
            headless:       is_headless,
            parent_session: parent_session.clone(),
            agent_kind:     agent_kind.clone(),
            worktree_path:  worktree_path.clone(),
        },
    );

    {
        let cwd_mcp = effective_cwd.clone();
        let rb_mcp  = runbox_id.clone();
        let sid_mcp = session_id.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = mcp::write_mcp_config(&cwd_mcp, &rb_mcp, &sid_mcp) {
                eprintln!("[mcp] write_mcp_config failed: {e}");
            }
        });
    }

    // ── PTY reader thread ─────────────────────────────────────────────────
    let sid              = session_id.clone();
    let rb_id            = runbox_id.clone();
    let app_pty          = app.clone();
    let db_arc           = state.db.clone();
    let bus_arc          = state.bus_registry.clone();
    let cmd_rcvrs_arc    = state.cmd_receivers.clone();
    let agent_kind_clone = agent_kind.clone();
    let is_headless_thr  = is_headless;
    let parent_sess_thr  = parent_session.clone();
    let worktree_path_thr = worktree_path.clone();
    let session_start_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    // Per-session atomic to track whether a task is in-flight.
    let task_active = Arc::new(std::sync::atomic::AtomicBool::new(false));

    // Response buffer — accumulates agent output lines between prompts.
    // When a completion signal is detected, contents are flushed to memory + bus.
    let response_buf: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
    let response_buf_lock = response_buf.clone();

    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];

        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 { break; }
            let text = String::from_utf8_lossy(&buf[..n]).to_string();

            if is_headless_thr {
                // ── Headless: route output to bus as subagent.output ──────
                let mut out_msg = bus::BusMessage::new(
                    sid.clone(),
                    "subagent.output",
                    text.clone(),
                );
                if let Some(ref parent) = parent_sess_thr {
                    out_msg = out_msg.with_correlation(parent.clone());
                }
                // Broadcast only — do not persist subagent.output to SQLite.
                if let Err(e) = bus_arc.publish(&rb_id, out_msg) {
                    eprintln!("[subagent] broadcast error: {e}");
                }
            } else {
                // ── Interactive: emit to frontend terminal ────────────────
                for word in text.split_whitespace() {
                    let clean = word.trim_matches(|c: char| {
                        !c.is_alphanumeric() && c != '/' && c != ':' && c != '.'
                            && c != '-' && c != '_' && c != '?' && c != '='
                            && c != '&' && c != '#' && c != '%'
                    });
                    if clean.starts_with("https://") || clean.starts_with("http://") {
                        let _ = app_pty.emit("browser-open-url", clean.to_string());
                    }
                }

                // ── Task tool detection — detect sub-agent delegation ─────
                detect_task_delegation(&text, &sid, &rb_id, &bus_arc, &db_arc);

                // ── Task lifecycle — publish task.started / task.done ─────
                detect_task_lifecycle(&text, &sid, &rb_id, &bus_arc, &db_arc, &task_active, &agent_kind_clone);

                // ── Chat capture — save agent responses to memory + bus ───
                capture_agent_response(&text, &sid, &rb_id, &bus_arc, &db_arc, &agent_kind_clone, &response_buf, &response_buf_lock);

                let _ = app_pty.emit(&format!("pty://output/{}", sid), text);
            }
        }

        // ── Session ended ─────────────────────────────────────────────────
        let _ = db::session_end(&db_arc, &sid, None, None);
        let _ = db::event_insert(
            &db_arc,
            &rb_id,
            &sid,
            "session_end",
            &format!("Session ended for agent {:?}", agent_kind_clone),
            None,
        );

        // Publish agent.stopped only if not already published by pty_kill.
        let already_stopped = !cmd_rcvrs_arc.lock().unwrap().contains_key(&sid);
        bus_arc.leave(&rb_id, &sid);
        cmd_rcvrs_arc.lock().unwrap().remove(&sid);
        if !already_stopped {
            let stop_topic = if is_headless_thr { "subagent.done" } else { "agent.stopped" };
            let mut stop_msg = bus::BusMessage::new(
                sid.clone(),
                stop_topic,
                serde_json::json!({ "session_id": sid, "agent": format!("{:?}", agent_kind_clone) }).to_string(),
            );
            if let Some(ref parent) = parent_sess_thr {
                stop_msg = stop_msg.with_correlation(parent.clone());
            }
            bus_publish_and_persist(&bus_arc, &db_arc, &rb_id, stop_msg);
        }

        // ── Remove worktree on session end ────────────────────────────────
        if let Some(ref wt) = worktree_path_thr {
            git_memory::remove_worktree(wt);
        }

        // ── Auto-snapshot memory on session end ───────────────────────────
        if agent_kind_clone != git_memory::AgentKind::Shell {
            let rb_id2  = rb_id.clone();
            let sid2    = sid.clone();
            let db_arc2 = db_arc.clone();
            let app2    = app_pty.clone();

            tauri::async_runtime::spawn(async move {
                let events = db::events_for_session(&db_arc2, &sid2, 50)
                    .unwrap_or_default();

                if events.is_empty() { return; }

                let now_ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as i64;

                let duration_secs = ((now_ms - session_start_ms) / 1000).max(0);
                let duration_str  = if duration_secs < 60 {
                    format!("{}s", duration_secs)
                } else {
                    format!("{}m{}s", duration_secs / 60, duration_secs % 60)
                };

                let bullets: Vec<String> = events.iter()
                    .filter(|e| e.event_type != "session_start" && e.event_type != "session_end")
                    .map(|e| format!("• [{}] {}", e.event_type, e.summary))
                    .collect();

                if bullets.is_empty() { return; }

                let summary = format!(
                    "Auto-snapshot (session {}, duration {}): {}",
                    &sid2[..sid2.len().min(8)],
                    duration_str,
                    bullets.join("; "),
                );

                if let Ok(_) = memory::memory_add(&rb_id2, &sid2, &summary).await {
                    git_memory::emit_memory_added(&rb_id2);
                    let _ = app2.emit("memory-added", serde_json::json!({ "runbox_id": rb_id2 }));
                }
            });
        }

        let _ = app_pty.emit(&format!("pty://ended/{}", sid), ());
    });

    {
        let should_watch = {
            let mut set = state.watched_runboxes.lock().unwrap();
            if set.contains(&runbox_id) { false } else { set.insert(runbox_id.clone()); true }
        };
        if should_watch {
            let rb_w      = runbox_id.clone();
            let bus_w     = state.bus_registry.clone();
            let sess_w    = state.sessions.clone();
            let db_w      = state.db.clone();
            let wr_set    = state.watched_runboxes.clone();
            let debounce_w = state.reinject_debounce.clone();
            tauri::async_runtime::spawn(async move {
                spawn_bus_watcher(rb_w.clone(), bus_w, sess_w, db_w, debounce_w).await;
                wr_set.lock().unwrap().remove(&rb_w);
            });
        }
    }

    Ok(())
}

// ── Bus watcher — re-injects peer context on significant events ───────────────
type DebounceMap = Arc<std::sync::Mutex<std::collections::HashMap<String, u64>>>;

const REINJECT_DEBOUNCE_MS: u64 = 8_000;

async fn spawn_bus_watcher(
    runbox_id:    String,
    bus_registry: Arc<bus::BusRegistry>,
    sessions:     SessionMap,
    _db:          db::Db,
    debounce:     DebounceMap,
) {
    let mut rx = bus_registry.subscribe(&runbox_id);
    loop {
        let msg = match rx.recv().await {
            Ok(m) => m,
            Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                eprintln!("[bus_watcher:{runbox_id}] lagged {n} — continuing");
                continue;
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                eprintln!("[bus_watcher:{runbox_id}] bus closed, exiting");
                break;
            }
        };

        let significant = matches!(
            msg.topic.as_str(),
            "task.started" | "task.done" | "task.failed" | "memory.added" | "error" | "agent.stopped"
        );
        if !significant { continue; }

        eprintln!(
            "[bus_watcher:{runbox_id}] '{}' from {} — re-injecting peers",
            msg.topic, &msg.from[..msg.from.len().min(8)]
        );

        let peers: Vec<(String, String, String, git_memory::AgentKind)> = {
            let map = sessions.lock().unwrap();
            map.iter()
                .filter(|(sid, s)| s.runbox_id == runbox_id && *sid != &msg.from && !s.headless)
                .map(|(sid, s)| (sid.clone(), s.runbox_id.clone(), s.cwd.clone(), s.agent_kind.clone()))
                .collect()
        };

        let now = bus::now_ms();
        for (peer_sid, rb, cwd, kind) in peers {
            let debounce_key = format!("{}:{}", rb, peer_sid);
            {
                let mut map = debounce.lock().unwrap();
                let last = map.get(&debounce_key).copied().unwrap_or(0);
                if now - last < REINJECT_DEBOUNCE_MS {
                    continue;
                }
                map.insert(debounce_key.clone(), now);
            }
            let debounce2 = debounce.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = git_memory::inject_context_for_agent_with_session(
                    &rb, &cwd, &kind, &peer_sid,
                ).await {
                    eprintln!("[bus_watcher] re-inject {peer_sid}: {e}");
                } else {
                    eprintln!("[bus_watcher] re-injected {}", &peer_sid[..peer_sid.len().min(8)]);
                }
                debounce2.lock().unwrap().remove(&debounce_key);
            });
        }
    }
}

// ── Task tool delegation detector ─────────────────────────────────────────────
fn detect_task_delegation(
    text:      &str,
    from_sid:  &str,
    runbox_id: &str,
    bus:       &Arc<bus::BusRegistry>,
    db:        &db::Db,
) {
    for line in text.lines() {
        let stripped = strip_ansi(line);
        let lower    = stripped.to_lowercase();

        let task_desc = if let Some(pos) = lower.find("task(") {
            let rest = &stripped[pos + 5..];
            let trimmed = rest.trim_start_matches("description:").trim_start_matches(|c: char| c == '"' || c == '\'' || c.is_whitespace());
            let end = trimmed.find(|c: char| c == ')' || c == '"' || c == '\'').unwrap_or(trimmed.len().min(80));
            let desc = trimmed[..end].trim();
            if desc.len() > 3 { Some(desc.to_string()) } else { None }
        } else if lower.contains("creating sub-agent for:") || lower.contains("spawning agent:") || lower.contains("launching agent:") {
            let sep_idx = lower.find(':').unwrap_or(0);
            let desc = stripped[sep_idx + 1..].trim();
            if desc.len() > 3 { Some(desc[..desc.len().min(80)].to_string()) } else { None }
        } else {
            None
        };

        if let Some(desc) = task_desc {
            let payload = serde_json::json!({
                "task":     desc,
                "from":     from_sid,
                "detected": "pty_output",
            }).to_string();
            let msg = bus::BusMessage::new(from_sid.to_string(), "agent.delegated", payload);
            bus_publish_and_persist(bus, db, runbox_id, msg);
        }
    }
}

// ── Task lifecycle detector ───────────────────────────────────────────────────
fn detect_task_lifecycle(
    text:        &str,
    from_sid:    &str,
    runbox_id:   &str,
    bus:         &Arc<bus::BusRegistry>,
    db:          &db::Db,
    task_active: &std::sync::atomic::AtomicBool,
    agent_kind:  &git_memory::AgentKind,
) {
    for line in text.lines() {
        let stripped = strip_ansi(line);
        let trimmed  = stripped.trim();

        // ── task.started: detect prompt submission ────────────────────────
        if !task_active.load(std::sync::atomic::Ordering::Relaxed) {
            let is_prompt = trimmed.starts_with("› ")
                || trimmed.starts_with("❯ ")
                || trimmed.starts_with("> ");

            if is_prompt {
                let task_text = trimmed
                    .trim_start_matches("› ")
                    .trim_start_matches("❯ ")
                    .trim_start_matches("> ")
                    .trim();

                if task_text.len() > 3 && !task_text.starts_with('–') && !task_text.starts_with('-') {
                    task_active.store(true, std::sync::atomic::Ordering::Relaxed);
                    let payload = serde_json::json!({
                        "task":       &task_text[..task_text.len().min(120)],
                        "session_id": from_sid,
                        "agent":      agent_kind.display_name(),
                    }).to_string();
                    let msg = bus::BusMessage::new(from_sid.to_string(), "task.started", payload);
                    bus_publish_and_persist(bus, db, runbox_id, msg);
                }
            }
        }

        // ── task.done: detect completion signals ──────────────────────────
        if task_active.load(std::sync::atomic::Ordering::Relaxed) {
            let lower = trimmed.to_lowercase();

            let is_codex_done = lower.contains("worked for ")
                && (lower.contains('s') || lower.contains('m'));

            let is_agent_done = trimmed.starts_with('✓')
                || trimmed.starts_with('✔')
                || lower == "done."
                || lower.starts_with("task complete");

            if is_codex_done || is_agent_done {
                task_active.store(false, std::sync::atomic::Ordering::Relaxed);
                let payload = serde_json::json!({
                    "session_id": from_sid,
                    "agent":      agent_kind.display_name(),
                    "signal":     trimmed.chars().take(80).collect::<String>(),
                }).to_string();
                let msg = bus::BusMessage::new(from_sid.to_string(), "task.done", payload);
                bus_publish_and_persist(bus, db, runbox_id, msg);
            }
        }
    }
}

// ── Chat capture — save agent responses to memory + bus ──────────────────────
// Accumulates agent output in a buffer. When a completion signal is detected
// (same patterns as task.done), flushes a summary to memory and publishes
// a status message to the bus so peers know what this agent just did.
fn capture_agent_response(
    text:         &str,
    from_sid:     &str,
    runbox_id:    &str,
    bus:          &Arc<bus::BusRegistry>,
    db:           &db::Db,
    agent_kind:   &git_memory::AgentKind,
    response_buf: &Arc<Mutex<String>>,
    _lock:        &Arc<Mutex<String>>,
) {
    // Accumulate stripped output into the buffer
    for line in text.lines() {
        let stripped = strip_ansi(line);
        let trimmed  = stripped.trim();
        if trimmed.is_empty() { continue; }

        // Skip pure noise lines — ANSI artifacts, box-drawing, progress bars
        if trimmed.chars().all(|c| !c.is_alphabetic()) { continue; }

        if let Ok(mut buf) = response_buf.try_lock() {
            // Cap buffer at 4000 chars to avoid unbounded growth
            if buf.len() < 4000 {
                buf.push_str(trimmed);
                buf.push('\n');
            }
        }
    }

    // Detect completion — same signals as task.done
    let is_done = text.lines().any(|line| {
        let s = strip_ansi(line);
        let t = s.trim();
        let l = t.to_lowercase();
        (l.contains("worked for ") && (l.contains('s') || l.contains('m')))
            || t.starts_with('✓')
            || t.starts_with('✔')
            || l == "done."
            || l.starts_with("task complete")
    });

    if !is_done { return; }

    // Drain the buffer
    let content = {
        let Ok(mut buf) = response_buf.try_lock() else { return; };
        if buf.trim().is_empty() { return; }
        let c = buf.clone();
        buf.clear();
        c
    };

    // Take first 600 chars as the memory summary
    let summary = content.chars().take(600).collect::<String>();
    let summary = summary.trim().to_string();
    if summary.len() < 20 { return; }

    let memory_summary = format!(
        "[{}] {}: {}",
        agent_kind.display_name(),
        &from_sid[..from_sid.len().min(8)],
        summary,
    );

    // Write to memory async
    let rb   = runbox_id.to_string();
    let sid  = from_sid.to_string();
    let mem  = memory_summary.clone();
    tauri::async_runtime::spawn(async move {
        if let Ok(_) = memory::memory_add(&rb, &sid, &mem).await {
            git_memory::emit_memory_added(&rb);
        }
    });

    // Publish status to bus so peers see what this agent just did
    let payload = serde_json::json!({
        "agent":      agent_kind.display_name(),
        "session_id": from_sid,
        "summary":    &memory_summary[..memory_summary.len().min(200)],
    }).to_string();
    let msg = bus::BusMessage::new(from_sid.to_string(), "status", payload);
    bus_publish_and_persist(bus, db, runbox_id, msg);

    // Also record as a DB event so it shows up in event history
    let _ = db::event_insert(
        db,
        runbox_id,
        from_sid,
        "agent_response",
        &memory_summary[..memory_summary.len().min(300)],
        None,
    );
}

// ── list_agent_definitions ────────────────────────────────────────────────────
#[tauri::command]
fn list_agent_definitions() -> Vec<serde_json::Value> {
    let agents_dir = dirs::home_dir()
        .map(|h| h.join(".claude").join("agents"))
        .filter(|p| p.exists());

    let Some(dir) = agents_dir else { return vec![]; };

    let Ok(entries) = std::fs::read_dir(&dir) else { return vec![]; };

    entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map(|x| x == "md").unwrap_or(false))
        .map(|entry| {
            let path   = entry.path();
            let stem   = path.file_stem().and_then(|s| s.to_str()).unwrap_or("unknown").to_string();
            let content = std::fs::read_to_string(&path).unwrap_or_default();

            let mut name  = stem.clone();
            let mut desc  = String::new();
            let mut tools = String::new();

            if content.starts_with("---") {
                if let Some(end) = content[3..].find("---") {
                    let fm = &content[3..end + 3];
                    for line in fm.lines() {
                        if let Some(v) = line.strip_prefix("name:") { name  = v.trim().trim_matches('"').to_string(); }
                        if let Some(v) = line.strip_prefix("description:") { desc  = v.trim().trim_matches('"').to_string(); }
                        if let Some(v) = line.strip_prefix("tools:") { tools = v.trim().to_string(); }
                    }
                }
            }

            serde_json::json!({
                "name":        name,
                "description": desc,
                "tools":       tools,
                "file":        path.to_string_lossy(),
            })
        })
        .collect()
}

// ── bus_spawn ─────────────────────────────────────────────────────────────────
#[tauri::command]
async fn bus_spawn(
    app:        AppHandle,
    runbox_id:  String,
    from:       String,
    task:       String,
    agent_cmd:  Option<String>,
    cwd:        String,
    state:      tauri::State<'_, AppState>,
) -> Result<String, String> {
    let child_sid = format!("sub-{}", uuid::Uuid::new_v4());

    let delegated_payload = serde_json::json!({
        "task":           task,
        "child_session":  child_sid,
        "parent_session": from,
    }).to_string();
    let delegated_msg = bus::BusMessage::new(from.clone(), "agent.delegated", delegated_payload)
        .with_correlation(child_sid.clone());
    bus_publish_and_persist(&state.bus_registry, &state.db, &runbox_id, delegated_msg);

    pty_spawn(
        app,
        child_sid.clone(),
        runbox_id,
        cwd,
        agent_cmd,
        Some(true),
        Some(from),
        state,
    ).await?;

    Ok(child_sid)
}

#[allow(dead_code)]
fn strip_ansi(s: &str) -> String {
    let mut out   = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            match chars.peek() {
                Some('[') => {
                    chars.next();
                    for c2 in chars.by_ref() { if c2.is_ascii_alphabetic() { break; } }
                }
                Some(']') | Some('P') | Some('X') | Some('^') | Some('_') => {
                    chars.next();
                    loop {
                        match chars.next() {
                            None | Some('\x07') | Some('\u{9C}') => break,
                            Some('\x1b') => { chars.next(); break; }
                            _ => {}
                        }
                    }
                }
                _ => {}
            }
        } else { out.push(c); }
    }
    out
}

#[tauri::command]
fn pty_write(session_id: String, data: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut inject: Option<(String, String, git_memory::AgentKind)> = None;

    {
        let mut sessions = state.sessions.lock().unwrap();
        if let Some(s) = sessions.get_mut(&session_id) {
            let _ = s.writer.write_all(data.as_bytes());
            let _ = s.writer.flush();

            for ch in data.chars() {
                match ch {
                    '\r' | '\n' => {
                        let line = s.input_buf.trim().to_string();
                        s.input_buf.clear();
                        if !line.is_empty() {
                            let token    = line.split_whitespace().next().unwrap_or("");
                            let base_cmd = token.rsplit(['/', '\\']).next().unwrap_or(token);
                            let kind     = git_memory::AgentKind::detect(base_cmd);
                            if kind != git_memory::AgentKind::Shell {
                                inject = Some((s.runbox_id.clone(), s.cwd.clone(), kind));
                            }
                        }
                    }
                    '\x08' | '\x7f' => { s.input_buf.pop(); }
                    c if !c.is_control() => { s.input_buf.push(c); }
                    _ => {}
                }
            }
        }
    }

    if let Some((rb, cwd, kind)) = inject {
        let sid = session_id.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = git_memory::inject_context_for_agent_with_session(&rb, &cwd, &kind, &sid).await {
                eprintln!("[git_memory] re-inject (user typed {:?}): {e}", kind);
            }
        });
    }

    Ok(())
}

#[tauri::command]
fn pty_resize(session_id: String, cols: u16, rows: u16, state: tauri::State<'_, AppState>) -> Result<(), String> {
    if let Some(s) = state.sessions.lock().unwrap().get(&session_id) {
        s._master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn pty_kill(session_id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    if let Some(mut s) = state.sessions.lock().unwrap().remove(&session_id) {
        let _ = s._child.kill();
        let rb  = s.runbox_id.clone();
        let sid = session_id.clone();
        let bus = state.bus_registry.clone();
        let db  = state.db.clone();
        bus.leave(&rb, &sid);
        state.cmd_receivers.lock().unwrap().remove(&sid);

        // Remove worktree on explicit kill
        if let Some(ref wt) = s.worktree_path {
            git_memory::remove_worktree(wt);
        }

        let stop_msg = bus::BusMessage::new(
            sid.clone(),
            "agent.stopped",
            serde_json::json!({ "session_id": sid, "reason": "killed" }).to_string(),
        );
        bus_publish_and_persist(&bus, &db, &rb, stop_msg);
    }
    Ok(())
}

// ── File watcher commands ─────────────────────────────────────────────────────
#[tauri::command]
fn watch_runbox(
    app:       AppHandle,
    runbox_id: String,
    cwd:       String,
    state:     tauri::State<'_, AppState>,
) -> Result<(), String> {
    let cwd_expanded = expand_cwd(&cwd);
    let rid          = runbox_id.clone();
    let bus_arc      = state.bus_registry.clone();
    let db_arc       = state.db.clone();

    let debouncer = new_debouncer(Duration::from_millis(300), move |res: notify_debouncer_mini::DebounceEventResult| {
        if let Ok(events) = res {
            let has_change = events.iter().any(|e| {
                matches!(e.kind, DebouncedEventKind::Any) && {
                    let p = e.path.to_string_lossy();
                    !p.contains("/.git/")
                        && !p.contains("\\.git\\")
                        && !p.ends_with(".stackbox-context.md")
                }
            });
            if has_change {
                let _ = app.emit("file-changed", serde_json::json!({ "runbox_id": rid }));

                let rid2 = rid.clone();
                let bus2 = bus_arc.clone();
                let db2  = db_arc.clone();
                tauri::async_runtime::spawn(async move {
                    let msg = bus::BusMessage::new(
                        "watcher".to_string(),
                        "file.changed",
                        serde_json::json!({ "runbox_id": rid2 }).to_string(),
                    );
                    bus_publish_and_persist(&bus2, &db2, &rid2, msg);
                });
            }
        }
    }).map_err(|e| e.to_string())?;

    {
        let mut d = debouncer;
        d.watcher()
            .watch(std::path::Path::new(&cwd_expanded), notify::RecursiveMode::Recursive)
            .map_err(|e| e.to_string())?;
        state.watchers.lock().unwrap().insert(runbox_id, d);
    }

    Ok(())
}

#[tauri::command]
fn unwatch_runbox(runbox_id: String, state: tauri::State<'_, AppState>) {
    state.watchers.lock().unwrap().remove(&runbox_id);
}

// ── Memory commands ───────────────────────────────────────────────────────────
#[tauri::command]
async fn memory_add(runbox_id: String, session_id: String, content: String) -> Result<memory::Memory, String> {
    memory::memory_add(&runbox_id, &session_id, &content).await
}

#[tauri::command]
async fn memory_list(runbox_id: String) -> Result<Vec<memory::Memory>, String> {
    memory::memories_for_runbox(&runbox_id).await
}

#[tauri::command]
async fn memory_delete(id: String) -> Result<(), String> {
    memory::memory_delete(&id).await
}

#[tauri::command]
async fn memory_pin(id: String, pinned: bool) -> Result<(), String> {
    memory::memory_pin(&id, pinned).await
}

#[tauri::command]
async fn memory_update(id: String, content: String) -> Result<(), String> {
    memory::memory_update(&id, &content).await
}

#[tauri::command]
async fn memory_delete_for_runbox(runbox_id: String) -> Result<(), String> {
    memory::memories_delete_for_runbox(&runbox_id).await
}

#[tauri::command]
fn bus_messages_delete_for_runbox(runbox_id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    db::bus_messages_delete_for_runbox(&state.db, &runbox_id);
    Ok(())
}

// ── DB commands ───────────────────────────────────────────────────────────────
#[tauri::command]
fn db_sessions_for_runbox(runbox_id: String, state: tauri::State<'_, AppState>) -> Result<Vec<db::Session>, String> {
    db::sessions_for_runbox(&state.db, &runbox_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_events_for_runbox(
    runbox_id: String,
    query:     Option<String>,
    limit:     Option<usize>,
    state:     tauri::State<'_, AppState>,
) -> Result<Vec<db::SessionEvent>, String> {
    let q   = query.unwrap_or_default();
    let lim = limit.unwrap_or(20);
    if q.trim().is_empty() {
        db::events_recent(&state.db, &runbox_id, lim).map_err(|e| e.to_string())
    } else {
        db::events_search(&state.db, &runbox_id, &q, lim).map_err(|e| e.to_string())
    }
}

// ── Bus Tauri commands ────────────────────────────────────────────────────────
#[tauri::command]
fn bus_publish(
    runbox_id:      String,
    from:           String,
    topic:          String,
    payload:        String,
    correlation_id: Option<String>,
    state:          tauri::State<'_, AppState>,
) -> Result<(), String> {
    if !bus::is_valid_topic(&topic) {
        return Err(format!("invalid topic '{topic}' — use a known topic or prefix with 'custom.'"));
    }
    let mut msg = bus::BusMessage::new(from, topic, payload);
    msg.correlation_id = correlation_id;
    bus_publish_and_persist(&state.bus_registry, &state.db, &runbox_id, msg);
    Ok(())
}

#[tauri::command]
fn bus_history(
    runbox_id:    String,
    limit:        Option<usize>,
    topic_filter: Option<String>,
    state:        tauri::State<'_, AppState>,
) -> Result<Vec<db::BusMessageRow>, String> {
    db::bus_messages_for_runbox(
        &state.db,
        &runbox_id,
        limit.unwrap_or(50),
        topic_filter.as_deref(),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
fn bus_history_since(
    runbox_id: String,
    since_ms:  i64,
    limit:     Option<usize>,
    state:     tauri::State<'_, AppState>,
) -> Result<Vec<db::BusMessageRow>, String> {
    db::bus_messages_since(&state.db, &runbox_id, since_ms, limit.unwrap_or(50))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn bus_agents(
    runbox_id: String,
    state:     tauri::State<'_, AppState>,
) -> Vec<String> {
    state.bus_registry.agents_in(&runbox_id)
}

#[tauri::command]
async fn bus_send_command(
    runbox_id:      String,
    to_agent:       String,
    from:           String,
    payload:        String,
    correlation_id: Option<String>,
    state:          tauri::State<'_, AppState>,
) -> Result<(), String> {
    state.bus_registry.send_command(
        &runbox_id,
        &to_agent,
        from,
        payload,
        correlation_id,
    ).await
}

#[tauri::command]
fn bus_topics() -> Vec<&'static str> {
    bus::TOPICS.to_vec()
}

// ── Filesystem commands ───────────────────────────────────────────────────────
#[tauri::command]
async fn open_directory_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    Ok(app.dialog().file().blocking_pick_folder().map(|p| p.to_string()))
}

#[tauri::command]
fn open_in_editor(path: String, editor: String) {
    let cmd = match editor.as_str() { "cursor" => "cursor", _ => "code" };
    std::process::Command::new(cmd).arg(&path).spawn().ok();
}

#[tauri::command]
async fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

// ── Entry point ───────────────────────────────────────────────────────────────
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            sessions:          Arc::new(Mutex::new(HashMap::new())),
            db:                db::open().expect("failed to open stackbox db"),
            watchers:          Arc::new(Mutex::new(HashMap::new())),
            bus_registry:      bus::BusRegistry::new(),
            cmd_receivers:     Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
            watched_runboxes:  Arc::new(std::sync::Mutex::new(std::collections::HashSet::new())),
            reinject_debounce: Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
        })
        .setup(|app| {
            git_memory::set_app_handle(app.handle().clone());
            git_memory::set_global_db(app.state::<AppState>().db.clone());
            git_memory::set_global_bus_registry(app.state::<AppState>().bus_registry.clone());

            tauri::async_runtime::spawn(async {
                memory::init().await.expect("memory init failed");
            });

            let app_handle   = app.handle().clone();
            let db_handle    = app.state::<AppState>().db.clone();
            let bus_handle   = app.state::<AppState>().bus_registry.clone();

            tauri::async_runtime::spawn(async move {
                let app_handle = Arc::new(app_handle);
                let db_arc     = Arc::new(db_handle);
                let bus_arc    = bus_handle;

                // ── POST /memory ──────────────────────────────────────────
                let db_mem = db_arc.clone();
                let memory_route = axum::routing::post(
                    move |axum::extract::Json(body): axum::extract::Json<serde_json::Value>| {
                        let db_mem = db_mem.clone();
                        async move {
                            let runbox_id  = body["runbox_id"].as_str().unwrap_or("__global__").to_string();
                            let content    = body["content"].as_str().unwrap_or("").to_string();
                            if content.is_empty() {
                                return (axum::http::StatusCode::BAD_REQUEST, "missing content").into_response();
                            }
                            let session_id = format!("agent-{}", uuid::Uuid::new_v4());

                            match memory::memory_add(&runbox_id, &session_id, &content).await {
                                Ok(_) => {
                                    let _ = db::event_insert(
                                        &db_mem,
                                        &runbox_id,
                                        &session_id,
                                        "memory",
                                        &content,
                                        None,
                                    );
                                    git_memory::emit_memory_added(&runbox_id);
                                    (axum::http::StatusCode::OK, "ok").into_response()
                                }
                                Err(e) => {
                                    eprintln!("[memory_server] write failed: {e}");
                                    (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e).into_response()
                                }
                            }
                        }
                    }
                );

                // ── GET /events ───────────────────────────────────────────
                let db_ev = db_arc.clone();
                let events_route = axum::routing::get(
                    move |axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>| {
                        let db_ev = db_ev.clone();
                        async move {
                            let runbox_id = params.get("runbox_id").cloned().unwrap_or_default();
                            let query     = params.get("q").cloned().unwrap_or_default();
                            let limit     = params.get("limit")
                                .and_then(|s| s.parse::<usize>().ok())
                                .unwrap_or(20);

                            let events = if query.trim().is_empty() {
                                db::events_recent(&db_ev, &runbox_id, limit)
                            } else {
                                db::events_search(&db_ev, &runbox_id, &query, limit)
                            };

                            axum::Json(events.unwrap_or_default()).into_response()
                        }
                    }
                );

                // ── POST /bus/publish ─────────────────────────────────────
                let bus_pub    = bus_arc.clone();
                let db_bus_pub = db_arc.clone();
                let bus_publish_route = axum::routing::post(
                    move |axum::extract::Json(body): axum::extract::Json<serde_json::Value>| {
                        let bus_pub    = bus_pub.clone();
                        let db_bus_pub = db_bus_pub.clone();
                        async move {
                            let runbox_id = body["runbox_id"].as_str().unwrap_or("").to_string();
                            let from      = body["from"].as_str().unwrap_or("unknown").to_string();
                            let topic     = body["topic"].as_str().unwrap_or("").to_string();
                            let payload   = body["payload"].as_str().unwrap_or("").to_string();
                            let cid       = body["correlation_id"].as_str().map(str::to_string);

                            if runbox_id.is_empty() {
                                return (axum::http::StatusCode::BAD_REQUEST, "missing runbox_id").into_response();
                            }
                            if !bus::is_valid_topic(&topic) {
                                return (
                                    axum::http::StatusCode::BAD_REQUEST,
                                    format!("invalid topic '{topic}'"),
                                ).into_response();
                            }

                            let mut msg = bus::BusMessage::new(from, topic, payload);
                            msg.correlation_id = cid;
                            bus_publish_and_persist(&bus_pub, &db_bus_pub, &runbox_id, msg);

                            (axum::http::StatusCode::OK, "ok").into_response()
                        }
                    }
                );

                // ── GET /bus/stream — SSE ─────────────────────────────────
                let bus_sse    = bus_arc.clone();
                let db_bus_sse = db_arc.clone();
                let bus_stream_route = axum::routing::get(
                    move |axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>| {
                        let bus_sse    = bus_sse.clone();
                        let db_bus_sse = db_bus_sse.clone();
                        async move {
                            use axum::response::sse::{Event, KeepAlive, Sse};
                            use futures::stream;
                            use tokio::sync::broadcast::error::RecvError;

                            let runbox_id = params.get("runbox_id").cloned().unwrap_or_default();
                            let since_ms  = params.get("since_ms")
                                .and_then(|s| s.parse::<i64>().ok());

                            let rx = bus_sse.subscribe(&runbox_id);

                            let replay: Vec<bus::BusMessage> = if let Some(since) = since_ms {
                                db::bus_messages_since(&db_bus_sse, &runbox_id, since, 500)
                                    .unwrap_or_default()
                                    .into_iter()
                                    .map(|r| bus::BusMessage {
                                        id:             r.id,
                                        from:           r.from_agent,
                                        topic:          r.topic,
                                        payload:        r.payload,
                                        timestamp:      r.timestamp as u64,
                                        correlation_id: r.correlation_id,
                                    })
                                    .collect()
                            } else {
                                vec![]
                            };

                            let replay_ids: std::collections::HashSet<String> =
                                replay.iter().map(|m| m.id.clone()).collect();

                            let replay_stream = stream::iter(
                                replay.into_iter().map(|msg| {
                                    let json = serde_json::to_string(&msg).unwrap_or_default();
                                    Ok::<Event, Infallible>(Event::default().data(json))
                                })
                            );

                            let live_stream = stream::unfold((rx, replay_ids), |(mut rx, seen)| async move {
                                loop {
                                    match rx.recv().await {
                                        Ok(msg) => {
                                            if seen.contains(&msg.id) {
                                                continue;
                                            }
                                            let json = serde_json::to_string(&msg).unwrap_or_default();
                                            return Some((
                                                Ok::<Event, Infallible>(Event::default().data(json)),
                                                (rx, seen),
                                            ));
                                        }
                                        Err(RecvError::Lagged(n)) => {
                                            eprintln!("[bus/sse] receiver lagged by {n} messages — skipping");
                                            continue;
                                        }
                                        Err(RecvError::Closed) => return None,
                                    }
                                }
                            });

                            let combined = stream::StreamExt::chain(replay_stream, live_stream);
                            Sse::new(combined)
                                .keep_alive(KeepAlive::default())
                                .into_response()
                        }
                    }
                );

                // ── GET /bus/agents ───────────────────────────────────────
                let bus_agents_arc = bus_arc.clone();
                let bus_agents_route = axum::routing::get(
                    move |axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>| {
                        let bus_agents_arc = bus_agents_arc.clone();
                        async move {
                            let runbox_id = params.get("runbox_id").cloned().unwrap_or_default();
                            let agents    = bus_agents_arc.agents_in(&runbox_id);
                            axum::Json(agents).into_response()
                        }
                    }
                );

                // ── GET /bus/history ──────────────────────────────────────
                let db_bus_hist = db_arc.clone();
                let bus_history_route = axum::routing::get(
                    move |axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>| {
                        let db_bus_hist = db_bus_hist.clone();
                        async move {
                            let runbox_id = params.get("runbox_id").cloned().unwrap_or_default();
                            let topic     = params.get("topic").cloned();
                            let limit     = params.get("limit")
                                .and_then(|s| s.parse::<usize>().ok())
                                .unwrap_or(50);
                            let msgs = db::bus_messages_for_runbox(
                                &db_bus_hist,
                                &runbox_id,
                                limit,
                                topic.as_deref(),
                            ).unwrap_or_default();
                            axum::Json(msgs).into_response()
                        }
                    }
                );

                // ── GET /bus/commands ─────────────────────────────────────
                let cmd_receivers_arc = app_handle.state::<AppState>().cmd_receivers.clone();
                let bus_commands_route = axum::routing::get(
                    move |axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>| {
                        let cmd_receivers_arc = cmd_receivers_arc.clone();
                        async move {
                            let agent_id = params.get("agent_id").cloned().unwrap_or_default();
                            if agent_id.is_empty() {
                                return (axum::http::StatusCode::BAD_REQUEST, axum::Json(serde_json::json!({"error": "agent_id required"}))).into_response();
                            }
                            let mut cmds: Vec<serde_json::Value> = vec![];
                            let mut map = cmd_receivers_arc.lock().unwrap();
                            if let Some(rx) = map.get_mut(&agent_id) {
                                for _ in 0..50 {
                                    match rx.try_recv() {
                                        Ok(msg) => cmds.push(serde_json::json!({
                                            "id":             msg.id,
                                            "from":           msg.from,
                                            "payload":        msg.payload,
                                            "timestamp":      msg.timestamp,
                                            "correlation_id": msg.correlation_id,
                                        })),
                                        Err(_) => break,
                                    }
                                }
                            }
                            axum::Json(cmds).into_response()
                        }
                    }
                );

                let mcp_state = mcp::McpState {
                    bus_registry: bus_arc.clone(),
                    db:           (*db_arc).clone(),
                };

                let router = axum::Router::new()
                    .route("/memory",       memory_route)
                    .route("/events",       events_route)
                    .route("/bus/publish",  bus_publish_route)
                    .route("/bus/stream",   bus_stream_route)
                    .route("/bus/agents",   bus_agents_route)
                    .route("/bus/history",  bus_history_route)
                    .route("/bus/commands", bus_commands_route)
                    .route("/bus/tasks_in_progress", axum::routing::get({
                        let db_tip = db_arc.clone();
                        move |axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>| {
                            let db_tip = db_tip.clone();
                            async move {
                                let runbox_id = params.get("runbox_id").cloned().unwrap_or_default();
                                let all_msgs = db::bus_messages_for_runbox(&db_tip, &runbox_id, 200, None)
                                    .unwrap_or_default();

                                let mut claimed: Vec<(String, String, String, i64)> = vec![];
                                for m in &all_msgs {
                                    if m.topic == "task.started" {
                                        let p = serde_json::from_str::<serde_json::Value>(&m.payload)
                                            .unwrap_or(serde_json::Value::String(m.payload.clone()));
                                        let task = p.get("task").and_then(|v| v.as_str())
                                            .unwrap_or(&m.payload).chars().take(120).collect::<String>();
                                        let cid = m.correlation_id.clone().unwrap_or_else(|| m.id.clone());
                                        claimed.push((m.from_agent.clone(), task, cid, m.timestamp));
                                    }
                                    if m.topic == "task.done" {
                                        if let Some(ref cid) = m.correlation_id {
                                            claimed.retain(|(_, _, c, _)| c != cid);
                                        } else {
                                            claimed.retain(|(from, _, _, ts)| {
                                                from != &m.from_agent || *ts >= m.timestamp
                                            });
                                        }
                                    }
                                }

                                let in_progress: Vec<serde_json::Value> = claimed.iter()
                                    .map(|(from, task, _, ts)| serde_json::json!({
                                        "session_id": &from[..from.len().min(16)],
                                        "task":       task,
                                        "timestamp":  ts,
                                    }))
                                    .collect();
                                axum::Json(in_progress).into_response()
                            }
                        }
                    }))
                    .nest("/mcp", mcp::router(mcp_state))
                    .route("/bus/spawn", axum::routing::post({
                        let app_spawn = app_handle.clone();
                        move |body: axum::extract::Json<serde_json::Value>| {
                            let app_spawn = app_spawn.clone();
                            async move {
                                let runbox_id  = body.get("runbox_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                let from       = body.get("from").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                let task       = body.get("task").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                let agent_cmd  = body.get("agent_cmd").and_then(|v| v.as_str()).map(|s| s.to_string());
                                let cwd        = body.get("cwd").and_then(|v| v.as_str()).unwrap_or("~/").to_string();

                                if runbox_id.is_empty() || from.is_empty() {
                                    return (axum::http::StatusCode::BAD_REQUEST,
                                        axum::Json(serde_json::json!({"error": "runbox_id and from are required"}))).into_response();
                                }

                                let child_sid = format!("sub-{}", uuid::Uuid::new_v4());
                                let _ = app_spawn.emit("bus-spawn-request", serde_json::json!({
                                    "child_session_id": child_sid,
                                    "runbox_id":   runbox_id,
                                    "from":        from,
                                    "task":        task,
                                    "agent_cmd":   agent_cmd,
                                    "cwd":         cwd,
                                }));

                                (axum::http::StatusCode::OK,
                                    axum::Json(serde_json::json!({"child_session_id": child_sid}))).into_response()
                            }
                        }
                    }))
                    .route("/open-url", axum::routing::post({
                        let h = app_handle.clone();
                        move |body: String| {
                            let h = h.clone();
                            async move { let _ = h.emit("browser-open-url", body); "ok" }
                        }
                    }))
                    .route("/url-changed", axum::routing::get({
                        let h = app_handle.clone();
                        move |axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>| {
                            let h = h.clone();
                            async move {
                                if let (Some(id), Some(url)) = (params.get("id"), params.get("url")) {
                                    let _ = h.emit("browser-url-changed", serde_json::json!({ "id": id, "url": url }));
                                }
                                "ok"
                            }
                        }
                    }));

                let listener = tokio::net::TcpListener::bind(
                    format!("127.0.0.1:{}", git_memory::MEMORY_PORT)
                ).await.unwrap();

                let cors = tower_http::cors::CorsLayer::new()
                    .allow_origin(tower_http::cors::Any)
                    .allow_methods(tower_http::cors::Any)
                    .allow_headers(tower_http::cors::Any);

                axum::serve(listener, router.layer(cors)).await.unwrap();
            });

            Ok(())
        })
        .register_uri_scheme_protocol("proxy", |_ctx, req| handle_proxy_request(req))
        .invoke_handler(tauri::generate_handler![
            // PTY
            pty_spawn, pty_write, pty_resize, pty_kill,
            // File watcher
            watch_runbox, unwatch_runbox,
            // Memory
            memory_add, memory_list, memory_delete, memory_pin,
            memory_update, memory_delete_for_runbox,
            // DB
            db_sessions_for_runbox,
            db_events_for_runbox,
            // Git
            git_memory::git_ensure,
            git_memory::git_log_for_runbox,
            git_memory::git_diff_for_commit,
            git_memory::git_diff_live,
            git_memory::git_worktree_create,
            git_memory::git_worktree_remove,
            git_memory::git_current_branch,
            git_memory::git_stage_and_commit,
            // Filesystem
            open_directory_dialog, open_in_editor, read_text_file,
            // Browser
            browser_create, browser_destroy, browser_navigate, browser_set_bounds,
            browser_go_back, browser_go_forward, browser_reload, browser_show, browser_hide,
            // Agent Bus
            bus_publish, bus_history, bus_history_since,
            bus_agents, bus_send_command, bus_topics,
            // Sub-agents
            list_agent_definitions, bus_spawn,
            bus_messages_delete_for_runbox,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

use axum::response::IntoResponse;