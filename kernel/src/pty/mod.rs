// src-tauri/src/pty/mod.rs
// Supercontext V3 — OutputClassifier + ResponseCapture removed.
// Agents write memory intentionally via remember()/session_log()/session_summary().
// Session end: expire TEMPORARY for agent, run auto_session_summary fallback.

pub mod detection;
pub mod watcher;
pub mod writer;  // ADD


use std::io::{Read, Write};
use std::time::Instant;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::{AppHandle, Emitter};

use crate::{
    agent::{context::inject, injector, kind::AgentKind},
    git::repo::{ensure_git_repo, remove_worktree},
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

/// Detect whether `cwd` is already an agent worktree.
///
/// `commands/pty.rs` calls `ensure_worktree` with the original workspace cwd
/// and then passes the resulting worktree path as `cwd` to this function.
/// So by the time we arrive here, `cwd` IS the worktree — we must not create
/// another one on top of it.
///
/// A path is a Stackbox worktree if its folder name starts with "stackbox-wt-".
fn detect_worktree(cwd: &str) -> Option<String> {
    let folder = std::path::Path::new(cwd)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");

    if folder.starts_with("stackbox-wt-") {
        Some(cwd.to_string())
    } else {
        None
    }
}

pub async fn spawn(
    app:            AppHandle,
    session_id:     String,
    runbox_id:      String,
    cwd:            String,
    agent_cmd:      Option<String>,
    workspace_name: Option<String>,
    cols:           Option<u16>,
    rows:           Option<u16>,
    docker:         bool,
    state:          &AppState,
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

    // Workspace label shown in the shell prompt — falls back to the last path
    // segment of the raw workspace cwd (not the worktree folder name).
    let ws_label: String = workspace_name
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            std::path::Path::new(&resolved_cwd)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("shell")
                .to_string()
        });

    clear_git_lock(&resolved_cwd);

    // Only call ensure_git_repo on the ORIGINAL workspace, not on a worktree.
    // If cwd is already a worktree (starts with stackbox-wt-), git is already
    // initialised — calling ensure_git_repo here would corrupt the worktree's
    // .git file pointer.
    let worktree_path = detect_worktree(&resolved_cwd);
    if worktree_path.is_none() {
        // Raw workspace cwd — still safe to ensure git
        ensure_git_repo(&resolved_cwd, &runbox_id)
            .unwrap_or_else(|e| { eprintln!("[pty] ensure_git_repo: {e}"); String::new() });
    }

    // effective_cwd is the worktree if one was detected, otherwise raw cwd
    let effective_cwd = worktree_path.as_deref().unwrap_or(&resolved_cwd).to_string();

    clear_git_lock(&effective_cwd);

    record_agent_spawned(&state.db, &runbox_id, &session_id, agent_kind.display_name(), &effective_cwd);

    crate::agent::globals::register_runbox_cwd(&runbox_id, &effective_cwd);

    if agent_kind != AgentKind::Shell {
        let rb4  = runbox_id.clone();
        let cwd4 = effective_cwd.clone();
        let db4  = state.db.clone();
        tauri::async_runtime::spawn(async move {
            crate::memory::sleep::boot_init(&rb4, &cwd4, &db4).await;
        });
    }

    {
        let rb    = runbox_id.clone();
        let sid   = session_id.clone();
        let cwd_c = effective_cwd.clone();
        let ak    = agent_kind.display_name().to_string();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = inject(&cwd_c, &rb, &sid, &ak) {
                eprintln!("[pty] inject context: {e}");
            }
        });
    }

    // ── Shell command ─────────────────────────────────────────────────────────
    //
    // The prompt uses STACKBOX_WORKSPACE_NAME so it always shows the human
    // workspace name (e.g. "Nodebook>") regardless of which worktree folder
    // the terminal is actually running inside.

    #[cfg(windows)]
    let mut cmd = {
        let sys_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
        let ps       = format!("{}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", sys_root);
        let mut c    = CommandBuilder::new(&ps);
        // Prompt references $env:STACKBOX_WORKSPACE_NAME — set below alongside
        // the other env vars so the workspace label is always correct even when
        // the terminal cwd is a stackbox-wt-* worktree folder.
        c.args(&[
            "-NoLogo", "-NoProfile", "-NoExit", "-NonInteractive", "-Command",
            r#"function prompt { (Split-Path -Leaf (Get-Location)) + "> " }"#,
        ]);
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
        // PROMPT uses double-quoted string so ${STACKBOX_WORKSPACE_NAME} is
        // expanded from the environment when zsh reads this file at startup.
        let zshrc = r#"
[ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc"
PROMPT="%B%F{cyan}%1~%f%b %% "
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

    // ── STACKBOX_WORKSPACE_NAME — must be set before cmd is spawned ───────────
    //
    // Both the Windows PS prompt and the Unix zshrc reference this variable.
    // It is the human-readable workspace name (e.g. "Nodebook"), never the
    // worktree folder name (e.g. "stackbox-wt-5304906b").
    cmd.env("STACKBOX_WORKSPACE_NAME", &ws_label);

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

    // ── Docker exec prefix ────────────────────────────────────────────────────
    if docker {
        if let Ok(prefix) = crate::docker::exec_prefix(&runbox_id) {
            cmd.env("STACKBOX_DOCKER_EXEC", &prefix);
            cmd.env("STACKBOX_IN_DOCKER",   "1");
        }
    }

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
        docker,
    });

    {
        let cwd_m = effective_cwd.clone();
        let rb_m  = runbox_id.clone();
        let sid_m = session_id.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = write_mcp_config(&cwd_m,None, &rb_m, &sid_m) {
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

            // URL detection — file:// and localhost URLs open in built-in browser
            let text_clean = strip_ansi(&text);
            for word in text_clean.split_whitespace() {
                let clean = word.trim_matches(|c: char| {
                    !c.is_alphanumeric() && c != '/' && c != ':' && c != '.'
                        && c != '-' && c != '_' && c != '?' && c != '='
                        && c != '&' && c != '#' && c != '%'
                });
                let is_valid_url = (clean.starts_with("https://")
                    || clean.starts_with("http://")
                    || clean.starts_with("file://"))
                    && clean.len() > 7
                    && !clean.contains(r"\x1b")
                    && !clean.contains(r"\u{")
                    && clean.chars().all(|c| c.is_ascii() && c >= ' ');
                if is_valid_url {
                    let _ = app_pty.emit("browser-open-url", clean.to_string());
                }
            }

            // start .\index.html intercept — relative file paths from PTY output
            for line in text_clean.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("start ") || trimmed.starts_with("Start-Process ") {
                    let rest = trimmed
                        .trim_start_matches("start ")
                        .trim_start_matches("Start-Process ")
                        .trim_matches('"')
                        .trim_matches('\'');
                    if rest.ends_with(".html") || rest.ends_with(".htm") {
                        let resolved = if rest.starts_with('.') || rest.starts_with('\\') {
                            std::path::Path::new(&cwd_thr)
                                .join(rest.trim_start_matches('.').trim_start_matches('\\')
                                          .trim_start_matches('/'))
                                .to_string_lossy()
                                .to_string()
                        } else {
                            rest.to_string()
                        };
                        let file_url = format!("file:///{}", resolved.replace('\\', "/")
                            .trim_start_matches('/'));
                        let _ = app_pty.emit("browser-open-url", file_url);
                    }
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

        // Only remove the worktree if it was detected (i.e. owned by this session).
        // pty_kill also calls remove_worktree — remove_worktree is idempotent so
        // double-calling is safe, but we guard here to avoid log noise.
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

                if let Err(e) = memory::expire_temporary_for_agent(&rb2, &agent_id).await {
                    eprintln!("[pty] expire_temporary: {e}");
                }

                crate::agent::supercontext::auto_session_summary(&rb2, &sid2, &an2, &db2).await;
                injector::invalidate_cache(&rb2).await;
                crate::memory::sleep::reflection(&rb2, &cwd2, &sid2).await;

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