// src-tauri/src/pty/mod.rs

pub mod detection;
pub mod watcher;

use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::{AppHandle, Emitter};

use crate::{
    agent::{context::inject, kind::AgentKind},
    db::Db,
    git::repo::{ensure_git_repo, ensure_worktree, remove_worktree},
    memory,
    mcp::config::write_mcp_config,
    state::{AppState, PtySession},
    workspace::{
        events::{record_agent_spawned, record_command_result},
        context::rewrite_context,
        snapshot::snapshot_from_git,
    },
    db::sessions::{session_start, session_end},
};

use detection::{strip_ansi, capture_response, is_completion_signal, on_command_result};

// ── CWD expansion ─────────────────────────────────────────────────────────────
pub fn expand_cwd(raw: &str) -> String {
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

// ── spawn ─────────────────────────────────────────────────────────────────────
pub async fn spawn(
    app:            AppHandle,
    session_id:     String,
    runbox_id:      String,
    cwd:            String,
    agent_cmd:      Option<String>,
    headless:       Option<bool>,
    parent_session: Option<String>,
    state:          &AppState,
) -> Result<(), String> {
    let pty_system   = native_pty_system();
    let pair         = pty_system
        .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    let resolved_cwd = expand_cwd(&cwd);
    let agent_str    = agent_cmd.as_deref().unwrap_or("shell");
    let agent_kind   = AgentKind::detect(agent_str);
    let is_headless  = headless.unwrap_or(false);

    // ── Git repo + worktree ───────────────────────────────────────────────
    ensure_git_repo(&resolved_cwd, &runbox_id)
        .unwrap_or_else(|e| { eprintln!("[pty] ensure_git_repo: {e}"); String::new() });

    let worktree_path = if agent_kind != AgentKind::Shell && !is_headless {
        ensure_worktree(&resolved_cwd, &runbox_id)
    } else {
        None
    };
    let effective_cwd = worktree_path.as_deref().unwrap_or(&resolved_cwd).to_string();

    // ── Record AgentSpawned ───────────────────────────────────────────────
    record_agent_spawned(&state.db, &runbox_id, &session_id, agent_kind.display_name(), &effective_cwd);

    // ── Context injection ─────────────────────────────────────────────────
    {
        let db    = state.db.clone();
        let rb    = runbox_id.clone();
        let sid   = session_id.clone();
        let cwd_c = effective_cwd.clone();
        let ak    = agent_kind.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = inject(&db, &rb, &sid, &cwd_c, &ak).await {
                eprintln!("[pty] inject context: {e}");
            }
        });
    }

    // ── Shell command ─────────────────────────────────────────────────────
    #[cfg(windows)]
    let mut cmd = {
        let sys_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
        let ps       = format!("{}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", sys_root);
        let mut c    = CommandBuilder::new(&ps);
        c.args(&["-NoLogo", "-NoExit", "-NonInteractive", "-Command",
            r#"function prompt { "~/\" + (Split-Path -Leaf (Get-Location)) + "> " }"#]);
        for var in &["USERPROFILE","APPDATA","LOCALAPPDATA","TEMP","TMP","PATH","SystemRoot"] {
            c.env(var, std::env::var(var).unwrap_or_default());
        }
        c.env("SystemRoot", &sys_root);
        c
    };

    #[cfg(not(windows))]
    let mut cmd = CommandBuilder::new("bash");

    cmd.cwd(&effective_cwd);

    // Browser shim
    {
        let shim = if cfg!(windows) { "stackbox-open.exe" } else { "stackbox-open" };
        if let Some(path) = std::env::current_exe().ok()
            .and_then(|p| p.parent().map(|d| d.join(shim)))
            .filter(|p| p.exists())
        {
            cmd.env("BROWSER", path.to_string_lossy().to_string());
        }
    }

    // API keys
    if let Ok(key) = std::env::var("ANTHROPIC_API_KEY") { cmd.env("ANTHROPIC_API_KEY", key); }

    // Agent env
    let port     = crate::workspace::context::MEMORY_PORT;
    let ctx_file = format!("{effective_cwd}/.stackbox-context.md");
    cmd.env("STACKBOX_CONTEXT_FILE",  &ctx_file);
    cmd.env("STACKBOX_MEMORY_URL",    format!("http://localhost:{port}/memory"));
    cmd.env("STACKBOX_RUNBOX_ID",     &runbox_id);
    cmd.env("STACKBOX_SESSION_ID",    &session_id);
    cmd.env("STACKBOX_WORKTREE",      worktree_path.as_deref().unwrap_or(""));
    cmd.env("STACKBOX_EVENTS_URL",    format!("http://localhost:{port}/events?runbox_id={runbox_id}"));
    cmd.env("STACKBOX_TIMELINE_URL",  format!("http://localhost:{port}/timeline/stream?runbox_id={runbox_id}"));

    match &agent_kind {
        AgentKind::ClaudeCode    => { cmd.env("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1"); }
        AgentKind::Codex         => { cmd.env("CODEX_CONTEXT_FILE", &ctx_file); }
        AgentKind::CursorAgent   => { cmd.env("CURSOR_CONTEXT_FILE", &ctx_file); }
        AgentKind::GeminiCli     => { cmd.env("GEMINI_SYSTEM_MD", &ctx_file); }
        AgentKind::GitHubCopilot => { cmd.env("COPILOT_CONTEXT_FILE", &ctx_file); }
        AgentKind::OpenCode      => { cmd.env("OPENCODE_CONTEXT_FILE", &ctx_file); }
        AgentKind::Shell         => {}
    }

    let child      = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer     = pair.master.take_writer().map_err(|e| e.to_string())?;

    // Auto-launch agent
    if let Some(launch) = agent_kind.launch_cmd(&ctx_file) {
        if let Ok(mut w) = pair.master.take_writer() {
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(400)).await;
                let _ = w.write_all(launch.as_bytes());
                let _ = w.flush();
            });
        }
    }

    // DB session record
    let _ = session_start(&state.db, &session_id, &runbox_id, "", agent_str, &effective_cwd);

    state.sessions.lock().unwrap().insert(session_id.clone(), PtySession {
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
    });

    // MCP config
    {
        let cwd_m = effective_cwd.clone();
        let rb_m  = runbox_id.clone();
        let sid_m = session_id.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = write_mcp_config(&cwd_m, &rb_m, &sid_m) {
                eprintln!("[mcp] write_mcp_config: {e}");
            }
        });
    }

    // ── PTY reader thread ─────────────────────────────────────────────────
    let sid               = session_id.clone();
    let rb_id             = runbox_id.clone();
    let app_pty           = app.clone();
    let db_arc            = state.db.clone();
    let is_headless_thr   = is_headless;
    let worktree_path_thr = worktree_path.clone();
    let cwd_thr           = effective_cwd.clone();
    let session_start_ts  = Instant::now();

    let response_buf = Arc::new(Mutex::new(String::new()));

    std::thread::spawn(move || {
        let mut buf           = [0u8; 4096];
        let mut detected_kind = agent_kind.clone();

        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 { break; }
            let text = String::from_utf8_lossy(&buf[..n]).to_string();

            if is_headless_thr {
                // Headless: just emit to frontend, no events
                let _ = app_pty.emit(&format!("pty://output/{}", sid), &text);
            } else {
                // Upgrade agent kind from banner if still Shell
                if detected_kind == AgentKind::Shell {
                    let stripped = strip_ansi(&text);
                    if let Some(upgraded) = AgentKind::infer_from_output(&stripped) {
                        eprintln!("[pty] detected agent: {}", upgraded.display_name());
                        detected_kind = upgraded;
                    }
                }

                // URL detection → browser open
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

                // Capture response → memory on completion
                if let Some(summary) = capture_response(&text, &response_buf) {
                    let mem = format!("[{}] {}: {}", detected_kind.display_name(),
                        &sid[..sid.len().min(8)], summary);
                    let rb2  = rb_id.clone();
                    let sid2 = sid.clone();
                    tauri::async_runtime::spawn(async move {
                        if memory::memory_add(&rb2, &sid2, &mem).await.is_ok() {
                            crate::agent::globals::emit_memory_added(&rb2);
                        }
                    });
                }

                let _ = app_pty.emit(&format!("pty://output/{}", sid), &text);
            }
        }

        // ── Session ended ─────────────────────────────────────────────────
        let duration_ms = session_start_ts.elapsed().as_millis() as i64;
        let _ = session_end(&db_arc, &sid, None, None);

        // Record CommandResult for the session as a whole
        on_command_result(&db_arc, &rb_id, &sid, 0, duration_ms);

        // Auto-snapshot on session end
        if agent_kind != AgentKind::Shell {
            snapshot_from_git(&db_arc, &rb_id, &sid, &cwd_thr);
        }

        // Remove worktree
        if let Some(ref wt) = worktree_path_thr {
            remove_worktree(wt);
        }

        // Auto-memory snapshot
        if agent_kind != AgentKind::Shell {
            let rb2  = rb_id.clone();
            let sid2 = sid.clone();
            let db2  = db_arc.clone();
            let app2 = app_pty.clone();
            tauri::async_runtime::spawn(async move {
                let dur = if duration_ms < 60_000 {
                    format!("{}s", duration_ms / 1000)
                } else {
                    format!("{}m{}s", duration_ms / 60_000, (duration_ms % 60_000) / 1000)
                };
                let summary = format!(
                    "Session {} ({}, {}) completed",
                    &sid2[..sid2.len().min(8)],
                    agent_kind.display_name(),
                    dur,
                );
                if memory::memory_add(&rb2, &sid2, &summary).await.is_ok() {
                    crate::agent::globals::emit_memory_added(&rb2);
                    let _ = app2.emit("memory-added", serde_json::json!({ "runbox_id": rb2 }));
                }
            });
        }

        let _ = app_pty.emit(&format!("pty://ended/{}", sid), ());
    });

    Ok(())
}
