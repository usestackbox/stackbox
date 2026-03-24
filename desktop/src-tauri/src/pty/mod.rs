// src-tauri/src/pty/mod.rs
// Supercontext V3 — OutputClassifier + ResponseCapture removed.
// Agents write memory intentionally via remember()/session_log()/session_summary().
// Session end: expire TEMPORARY for agent, run auto_session_summary fallback.

pub mod detection;
pub mod watcher;

use std::io::{Read, Write};
use std::time::Instant;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::{AppHandle, Emitter};

use crate::{
    agent::{context::inject, injector, kind::AgentKind},
    git::repo::{ensure_git_repo, ensure_worktree, remove_worktree},
    memory,
    mcp::config::write_mcp_config,
    state::{AppState, PtySession},
    workspace::{
        events::{record_agent_spawned, record_command_result},
        snapshot::snapshot_from_git,
    },
    db::sessions::{session_start, session_end},
};

use detection::{strip_ansi, on_command_result};

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

fn clear_git_lock(cwd: &str) {
    let lock = std::path::Path::new(cwd).join(".git").join("index.lock");
    if lock.exists() {
        if let Err(e) = std::fs::remove_file(&lock) {
            eprintln!("[pty] could not remove index.lock: {e}");
        } else {
            eprintln!("[pty] cleared stale index.lock in {cwd}");
        }
    }
}

pub async fn spawn(
    app:        AppHandle,
    session_id: String,
    runbox_id:  String,
    cwd:        String,
    agent_cmd:  Option<String>,
    cols:       Option<u16>,
    rows:       Option<u16>,
    state:      &AppState,
) -> Result<(), String> {
    let pty_system = native_pty_system();

    let init_cols = cols.unwrap_or(80);
    let init_rows = rows.unwrap_or(24);

    let pair = pty_system
        .openpty(PtySize {
            rows:         init_rows,
            cols:         init_cols,
            pixel_width:  0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let resolved_cwd = expand_cwd(&cwd);
    let agent_str    = agent_cmd.as_deref().unwrap_or("shell");
    let agent_kind   = AgentKind::detect(agent_str);

    clear_git_lock(&resolved_cwd);

    ensure_git_repo(&resolved_cwd, &runbox_id)
        .unwrap_or_else(|e| { eprintln!("[pty] ensure_git_repo: {e}"); String::new() });

    let worktree_path = if agent_kind != AgentKind::Shell {
        ensure_worktree(&resolved_cwd, &session_id)
    } else {
        None
    };
    let effective_cwd = worktree_path.as_deref().unwrap_or(&resolved_cwd).to_string();

    clear_git_lock(&effective_cwd);

    record_agent_spawned(&state.db, &runbox_id, &session_id, agent_kind.display_name(), &effective_cwd);

    // GCC+Letta: register cwd for FS sync + injector reads
    crate::agent::globals::register_runbox_cwd(&runbox_id, &effective_cwd);

    // GCC+Letta: boot_init — scan codebase, write metadata.yaml + main.md
    // Runs async in background, no-op if metadata.yaml is < 7 days old
    if agent_kind != AgentKind::Shell {
        let rb4  = runbox_id.clone();
        let cwd4 = effective_cwd.clone();
        let db4  = state.db.clone();
        tauri::async_runtime::spawn(async move {
            crate::memory::sleep::boot_init(&rb4, &cwd4, &db4).await;
        });
    }

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

    #[cfg(windows)]
    let mut cmd = {
        let sys_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
        let ps       = format!("{}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", sys_root);
        let mut c    = CommandBuilder::new(&ps);
        c.args(&["-NoLogo", "-NoExit", "-NonInteractive", "-Command",
            r#"function prompt { "~\" + (Split-Path -Leaf (Get-Location)) + "> " }"#]);
        for var in &["USERPROFILE","APPDATA","LOCALAPPDATA","TEMP","TMP","PATH","SystemRoot"] {
            c.env(var, std::env::var(var).unwrap_or_default());
        }
        c.env("SystemRoot", &sys_root);
        c
    };

    #[cfg(not(windows))]
    let mut cmd = {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let stackbox_zsh_dir = "/tmp/stackbox-zsh";
        let _ = std::fs::create_dir_all(stackbox_zsh_dir);
        let zshrc = r#"
        [ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc"
        PROMPT='%B%F{cyan}%1~%f%b %% '
        zle_highlight=( region:bg=blue isearch:underline paste:standout suffix:bold default:fg=yellow )
        chpwd() { printf '\e]7;file://%s%s\a' "$HOST" "$PWD" }
        chpwd
        "#;
        let _ = std::fs::write(format!("{stackbox_zsh_dir}/.zshrc"), zshrc);
        let mut c = CommandBuilder::new(&shell);
        c.env("ZDOTDIR", stackbox_zsh_dir);
        c
    };

    cmd.cwd(&effective_cwd);

    {
        let shim = if cfg!(windows) { "stackbox-open.exe" } else { "stackbox-open" };
        if let Some(path) = std::env::current_exe().ok()
            .and_then(|p| p.parent().map(|d| d.join(shim)))
            .filter(|p| p.exists())
        {
            cmd.env("BROWSER", path.to_string_lossy().to_string());
        }
    }

    if let Ok(key) = std::env::var("ANTHROPIC_API_KEY") { cmd.env("ANTHROPIC_API_KEY", key); }

    // ── Per-pane stable port allocation ──────────────────────────────────────
    let pane_port = {
        let mut hash: u32 = 0x811c9dc5;
        for b in runbox_id.as_bytes() {
            hash ^= *b as u32;
            hash = hash.wrapping_mul(0x01000193);
        }
        3100u16 + (hash % 900) as u16
    };
    cmd.env("PORT",               pane_port.to_string());
    cmd.env("DEV_PORT",           pane_port.to_string());
    cmd.env("VITE_PORT",          pane_port.to_string());
    cmd.env("NEXT_PORT",          pane_port.to_string());
    cmd.env("DEBUG_PORT",         (pane_port + 1000).to_string());
    cmd.env("STACKBOX_PORT",      pane_port.to_string());
    cmd.env("NODE_ENV",           "development");
    cmd.env("STACKBOX_PANE_PORT", pane_port.to_string());

    let port     = crate::workspace::context::MEMORY_PORT;
    let ctx_file = format!("{effective_cwd}/.stackbox-context.md");
    cmd.env("STACKBOX_CONTEXT_FILE",  &ctx_file);
    cmd.env("STACKBOX_MEMORY_URL",    format!("http://localhost:{port}/memory"));
    cmd.env("STACKBOX_RUNBOX_ID",     &runbox_id);
    cmd.env("STACKBOX_SESSION_ID",    &session_id);
    cmd.env("STACKBOX_WORKTREE",      worktree_path.as_deref().unwrap_or(""));
    cmd.env("STACKBOX_EVENTS_URL",    format!("http://localhost:{port}/events?runbox_id={runbox_id}"));

    match &agent_kind {
        AgentKind::ClaudeCode    => { cmd.env("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1"); }
        AgentKind::Codex         => { cmd.env("CODEX_CONTEXT_FILE", &ctx_file); }
        AgentKind::CursorAgent   => { cmd.env("CURSOR_CONTEXT_FILE", &ctx_file); }
        AgentKind::GeminiCli     => { cmd.env("GEMINI_SYSTEM_MD", &ctx_file); }
        AgentKind::GitHubCopilot => { cmd.env("COPILOT_CONTEXT_FILE", &ctx_file); }
        AgentKind::Shell         => {}
    }

    let child      = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer     = pair.master.take_writer().map_err(|e| e.to_string())?;

    if let Some(launch) = agent_kind.launch_cmd(&ctx_file) {
        if let Ok(mut w) = pair.master.take_writer() {
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(400)).await;
                let _ = w.write_all(launch.as_bytes());
                let _ = w.flush();
            });
        }
    }

    let _ = session_start(&state.db, &session_id, &runbox_id, "", agent_str, &effective_cwd);

    state.sessions.lock().unwrap().insert(session_id.clone(), PtySession {
        writer,
        _master:       pair.master,
        _child:        child,
        input_buf:     String::new(),
        runbox_id:     runbox_id.clone(),
        cwd:           effective_cwd.clone(),
        agent_kind:    agent_kind.clone(),
        worktree_path: worktree_path.clone(),
    });

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

    // ── PTY reader thread ─────────────────────────────────────────────────────
    let sid               = session_id.clone();
    let rb_id             = runbox_id.clone();
    let app_pty           = app.clone();
    let db_arc            = state.db.clone();
    let worktree_path_thr = worktree_path.clone();
    let cwd_thr           = effective_cwd.clone();
    let session_start_ts  = Instant::now();

    std::thread::spawn(move || {
        let mut buf           = [0u8; 4096];
        let mut detected_kind = agent_kind.clone();

        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 { break; }
            let text = String::from_utf8_lossy(&buf[..n]).to_string();

            // Agent kind detection from shell output
            if detected_kind == AgentKind::Shell {
                let stripped = strip_ansi(&text);
                if let Some(upgraded) = AgentKind::infer_from_output(&stripped) {
                    detected_kind = upgraded.clone();
                    let _ = app_pty.emit(&format!("pty://agent/{}", sid),
                        upgraded.display_name().to_string());
                }
            }

            // URL detection — emit browser-open-url for localhost URLs
            let text_clean = strip_ansi(&text);
            for word in text_clean.split_whitespace() {
                let clean = word.trim_matches(|c: char| {
                    !c.is_alphanumeric() && c != '/' && c != ':' && c != '.'
                        && c != '-' && c != '_' && c != '?' && c != '='
                        && c != '&' && c != '#' && c != '%'
                });
                let is_valid_url = (clean.starts_with("https://") || clean.starts_with("http://"))
                    && clean.len() > 10
                    && !clean.contains(r"\x1b")
                    && !clean.contains(r"\u{")
                    && clean.chars().all(|c| c.is_ascii() && c >= ' ');
                if is_valid_url {
                    let _ = app_pty.emit("browser-open-url", clean.to_string());
                }
            }

            let _ = app_pty.emit(&format!("pty://output/{}", sid), &text);
        }

        // ── Session ended ─────────────────────────────────────────────────────
        let duration_ms = session_start_ts.elapsed().as_millis() as i64;
        let _ = session_end(&db_arc, &sid, None, None);
        on_command_result(&db_arc, &rb_id, &sid, 0, duration_ms);

        if agent_kind != AgentKind::Shell {
            snapshot_from_git(&db_arc, &rb_id, &sid, &cwd_thr);
        }

        if let Some(ref wt) = worktree_path_thr {
            remove_worktree(wt);
        }

        // ── V3 session cleanup + GCC+Letta sleep-time jobs ────────────────────
        if agent_kind != AgentKind::Shell {
            let rb2  = rb_id.clone();
            let sid2 = sid.clone();
            let cwd2 = cwd_thr.clone();
            let db2  = db_arc.clone();
            let an2  = detected_kind.display_name().to_string();

            tauri::async_runtime::spawn(async move {
                let agent_type = memory::agent_type_from_name(&an2);
                let agent_id   = memory::make_agent_id(&agent_type, &sid2);

                // 1. Expire all TEMPORARY for this agent
                if let Err(e) = memory::expire_temporary_for_agent(&rb2, &agent_id).await {
                    eprintln!("[pty] expire_temporary: {e}");
                }

                // 2. Auto session summary fallback (no-op if agent wrote one)
                crate::agent::supercontext::auto_session_summary(&rb2, &sid2, &an2, &db2).await;

                // 3. Invalidate injector cache
                injector::invalidate_cache(&rb2).await;

                // 4. GCC+Letta: reflection — extract env facts from session logs
                crate::memory::sleep::reflection(&rb2, &cwd2, &sid2).await;

                // 5. GCC+Letta: weekly defrag check
                if crate::memory::sleep::is_defrag_due(&cwd2) {
                    crate::memory::sleep::defrag(&rb2, &cwd2).await;
                    crate::memory::sleep::mark_defrag_done(&cwd2);
                }
            });
        }

        let _ = app_pty.emit(&format!("pty://ended/{}", sid), ());
    });

    Ok(())
}