// src-tauri/src/pty/mod.rs
// Supercontext V3 — OutputClassifier + ResponseCapture removed.
// Agents write memory intentionally via remember()/session_log()/session_summary().
// Session end: expire TEMPORARY for agent, run auto_session_summary fallback.

pub mod detection;
pub mod watcher;
pub mod writer;

use std::io::{Read, Write};
use std::time::Instant;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::{AppHandle, Emitter};

use crate::{
    agent::{context::inject, injector, kind::AgentKind},
    git::repo::{ensure_git_repo, remove_worktree},
    memory,
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

/// Returns true if this URL is intentional (localhost / file://) and should
/// open in the browser pane.  Filters out the noise that build tools print
/// (cargo doc links, npm package URLs, log lines, etc.).
///
/// FIX (Bug #13): Previously every http/https/file URL in PTY output opened
/// a browser tab — including cargo, npm, and logger output.
fn is_intentional_url(url: &str) -> bool {
    // file:// always intentional (local HTML preview)
    if url.starts_with("file://") {
        return true;
    }
    // localhost / 127.0.0.1 / 0.0.0.0 dev servers — intentional
    if url.contains("localhost") || url.contains("127.0.0.1") || url.contains("0.0.0.0") {
        return true;
    }
    // Everything else (https://docs.rs/..., https://npmjs.com/..., etc.) — skip
    false
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

    let worktree_path = detect_worktree(&resolved_cwd);
    if worktree_path.is_none() {
        ensure_git_repo(&resolved_cwd, &runbox_id)
            .unwrap_or_else(|e| { eprintln!("[pty] ensure_git_repo: {e}"); String::new() });
    }

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

    #[cfg(windows)]
    let mut cmd = {
        let sys_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
        let ps       = format!("{}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", sys_root);
        let mut c    = CommandBuilder::new(&ps);
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

    if docker {
        if let Ok(prefix) = crate::docker::exec_prefix(&runbox_id) {
            cmd.env("STACKBOX_DOCKER_EXEC", &prefix);
            cmd.env("STACKBOX_IN_DOCKER",   "1");
        }
    }

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

    // FIX (Bug #2 + Bug #14): call take_writer() exactly once.
    //
    // Previously take_writer() was called twice:
    //   1. to store in PtySession.writer
    //   2. inside the agent launch_cmd block — always fails silently since (1)
    //      already consumed it, so the agent's startup command was never sent.
    //
    // Now we own the writer in a channel-based forwarder.  All writes go
    // through a tokio::sync::mpsc channel:
    //   • The PTY session's `.writer` field sends through this channel.
    //   • The webhook handler also sends through state.pty_writer (same channel).
    //   • The agent launch command is sent through the same channel (no second
    //     take_writer() needed).
    //
    // This is exactly the pattern documented in pty/writer.rs.

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();

    // FIX (Bug #14): Register the channel so the webhook handler can inject
    // feedback into this agent's PTY.
    state.pty_writer.register(&runbox_id, tx.clone());

    // Spawn the forwarder: reads bytes from the channel and writes to PTY stdin.
    let raw_writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    {
        let mut pty_w = raw_writer;
        tauri::async_runtime::spawn(async move {
            while let Some(bytes) = rx.recv().await {
                let _ = pty_w.write_all(&bytes);
                let _ = pty_w.flush();
            }
        });
    }

    // Send the agent's launch command through the channel (fixes the lost launch
    // command from Bug #2 — no second take_writer() call needed).
    if let Some(launch) = agent_kind.launch_cmd(&ctx_file) {
        let tx2 = tx.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(400)).await;
            let _ = tx2.send(launch.into_bytes());
        });
    }

    // A thin Write wrapper around the channel sender so PtySession.writer still
    // satisfies `Box<dyn Write + Send>` without any other code changes.
    struct ChannelWriter(tokio::sync::mpsc::UnboundedSender<Vec<u8>>);
    impl Write for ChannelWriter {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.send(buf.to_vec()).map_err(|_| std::io::Error::new(
                std::io::ErrorKind::BrokenPipe, "PTY channel closed",
            ))?;
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
    }

    let _ = session_start(&state.db, &session_id, &runbox_id, "", agent_str, &effective_cwd);

    state.sessions.lock().unwrap().insert(session_id.clone(), PtySession {
        writer:        Box::new(ChannelWriter(tx)),
        _master:       pair.master,
        _child:        child,
        input_buf:     String::new(),
        runbox_id:     runbox_id.clone(),
        cwd:           effective_cwd.clone(),
        agent_kind:    agent_kind.clone(),
        worktree_path: worktree_path.clone(),
        docker,
    });

    // FIX (Bug #6): The redundant write_mcp_config call that was here (always
    // with worktree: None, overwriting the correct config written by
    // commands/pty.rs) has been removed. commands/pty.rs already writes the
    // correct config — including the worktree path — before calling spawn().

    // ── PTY reader thread ─────────────────────────────────────────────────────
    let sid               = session_id.clone();
    let rb_id             = runbox_id.clone();
    let app_pty           = app.clone();
    let db_arc            = state.db.clone();
    let pty_writer_arc    = state.pty_writer.clone();
    let conflict_reg_thr  = state.conflict_registry.clone(); // Bug #10 fix
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

            // FIX (Bug #13): Only open localhost / file:// URLs automatically.
            // External URLs printed by cargo, npm, loggers, etc. are ignored.
            let text_clean = strip_ansi(&text);
            for word in text_clean.split_whitespace() {
                let clean = word.trim_matches(|c: char| {
                    !c.is_alphanumeric() && c != '/' && c != ':' && c != '.'
                        && c != '-' && c != '_' && c != '?' && c != '='
                        && c != '&' && c != '#' && c != '%'
                });
                let looks_like_url = (clean.starts_with("https://")
                    || clean.starts_with("http://")
                    || clean.starts_with("file://"))
                    && clean.len() > 7
                    && !clean.contains(r"\x1b")
                    && !clean.contains(r"\u{")
                    && clean.chars().all(|c| c.is_ascii() && c >= ' ');

                if looks_like_url && is_intentional_url(clean) {
                    let _ = app_pty.emit("browser-open-url", clean.to_string());
                }
            }

            // start ./index.html intercept — relative file paths from PTY output
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

        // FIX (Bug #10): Release all file conflict locks held by this session.
        // Previously on_session_exit was declared but never called, so locks
        // from dead agent processes stayed held permanently, blocking other agents.
        crate::conflict::on_session_exit(&conflict_reg_thr, &sid, &cwd_thr);

        // FIX (Bug #14 cleanup): Unregister the PTY from the writer map so the
        // webhook handler stops trying to deliver events to a dead session.
        pty_writer_arc.unregister(&rb_id);

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