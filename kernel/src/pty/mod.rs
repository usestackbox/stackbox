// kernel/src/pty/mod.rs
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
fn is_intentional_url(url: &str) -> bool {
    if url.starts_with("file://") {
        return true;
    }
    if url.contains("localhost") || url.contains("127.0.0.1") || url.contains("0.0.0.0") {
        return true;
    }
    false
}

/// On Windows, try to find PowerShell Core (pwsh.exe) first for a better
/// terminal experience, falling back to Windows PowerShell.
#[cfg(windows)]
fn find_powershell() -> String {
    // Try PowerShell Core locations
    let candidates = [
        "pwsh.exe", // in PATH
        r"C:\Program Files\PowerShell\7\pwsh.exe",
        r"C:\Program Files\PowerShell\6\pwsh.exe",
    ];
    for c in &candidates {
        if std::path::Path::new(c).exists() || which_exe(c) {
            return c.to_string();
        }
    }
    // Fallback: Windows PowerShell
    let sys_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
    format!("{}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", sys_root)
}

#[cfg(windows)]
fn which_exe(name: &str) -> bool {
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in path_var.split(';') {
            let candidate = std::path::Path::new(dir).join(name);
            if candidate.exists() { return true; }
        }
    }
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

    let init_cols = cols.unwrap_or(220).max(40);
    let init_rows = rows.unwrap_or(50).max(10);

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

    // WINDOWS: Launch PowerShell (Core preferred, Windows PowerShell fallback).
    //
    // CRITICAL FIX: The previous code passed -NonInteractive which caused the
    // shell to exit immediately even with -NoExit, because -NonInteractive tells
    // PowerShell not to read from stdin at all. Removed entirely.
    //
    // Flag explanation:
    //   -NoLogo    — suppress copyright banner
    //   -NoProfile — skip $PROFILE (faster startup; we inject our own prompt)
    //   -NoExit    — stay running after -Command executes
    //   -Command   — set a compact prompt function then hand off to the REPL
    //
    // Without -NonInteractive the shell reads from the PTY's stdin normally.
    #[cfg(windows)]
    let mut cmd = {
        let ps = find_powershell();
        let mut c = CommandBuilder::new(&ps);
        c.args(&[
            "-NoLogo",
            "-NoProfile",
            "-NoExit",
            "-Command",
            // Set a compact prompt: "FolderName> "
            // Single quotes inside the raw string to avoid escaping issues.
            r#"function prompt { (Split-Path -Leaf (Get-Location)) + '> ' }"#,
        ]);
        // Pass through essential Windows environment variables
        for var in &[
            "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP",
            "PATH", "SystemRoot", "COMSPEC", "USERNAME", "USERDOMAIN",
            "HOMEDRIVE", "HOMEPATH",
        ] {
            if let Ok(val) = std::env::var(var) {
                c.env(var, val);
            }
        }
        c
    };

    // UNIX: Use the user's preferred shell (from $SHELL), falling back through
    // zsh → bash → sh. Inject a minimal .zshrc / .bashrc that sources the
    // real one and sets a Stackbox-themed prompt.
    #[cfg(not(windows))]
    let mut cmd = {
        let preferred_shell = std::env::var("SHELL").unwrap_or_default();
        let shell = if !preferred_shell.is_empty() && std::path::Path::new(&preferred_shell).exists() {
            preferred_shell
        } else {
            // Probe common shells in order of preference
            let candidates = ["/bin/zsh", "/usr/bin/zsh", "/bin/bash", "/usr/bin/bash", "/bin/sh"];
            candidates.iter()
                .find(|p| std::path::Path::new(*p).exists())
                .map(|s| s.to_string())
                .unwrap_or_else(|| "/bin/sh".to_string())
        };

        let shell_name = std::path::Path::new(&shell)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("sh");

        let mut c = CommandBuilder::new(&shell);

        if shell_name == "zsh" {
            // Write a minimal ZDOTDIR/.zshrc that sources the real .zshrc
            // and sets a clean Stackbox prompt.
            let stackbox_zsh_dir = format!("/tmp/stackbox-zsh-{}", std::process::id());
            let _ = std::fs::create_dir_all(&stackbox_zsh_dir);
            let zshrc = r#"
# Source the user's real .zshrc if it exists
[ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc" 2>/dev/null

# Stackbox prompt: cyan folder + grey prompt char
autoload -U colors && colors 2>/dev/null
PROMPT="%B%F{cyan}%1~%f%b %% "

# OSC 7: report CWD so the titlebar stays in sync
chpwd() { printf '\e]7;file://%s%s\a' "$HOST" "$PWD" }
chpwd
"#;
            let _ = std::fs::write(format!("{stackbox_zsh_dir}/.zshrc"), zshrc);
            c.env("ZDOTDIR", &stackbox_zsh_dir);

        } else if shell_name == "bash" {
            // Write a minimal bashrc
            let stackbox_bash_dir = format!("/tmp/stackbox-bash-{}", std::process::id());
            let _ = std::fs::create_dir_all(&stackbox_bash_dir);
            let bashrc = r#"
# Source the user's real .bashrc if it exists
[ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc" 2>/dev/null

# Stackbox prompt: cyan folder + grey $
PS1='\[\033[01;36m\]\W\[\033[00m\] \$ '

# OSC 7: report CWD so the titlebar stays in sync
_stackbox_osc7() { printf '\e]7;file://%s%s\a' "$HOSTNAME" "$PWD"; }
PROMPT_COMMAND="_stackbox_osc7${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
"#;
            let bashrc_path = format!("{stackbox_bash_dir}/.bashrc");
            let _ = std::fs::write(&bashrc_path, bashrc);
            // bash --rcfile <file> loads the file as interactive rc
            c = CommandBuilder::new(&shell);
            c.args(&["--rcfile", &bashrc_path]);
        }

        c
    };

    cmd.cwd(&effective_cwd);

    // ── Universal environment ─────────────────────────────────────────────────
    cmd.env("STACKBOX_WORKSPACE_NAME", &ws_label);
    cmd.env("TERM",      "xterm-256color"); // full 256-colour + OSC sequences
    cmd.env("COLORTERM", "truecolor");      // enable 24-bit RGB in colour-aware apps
    cmd.env("LANG",      "en_US.UTF-8");    // UTF-8 for emoji, box-drawing, etc.

    // BROWSER shim: routes `start index.html` → Stackbox browser panel
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
    if let Ok(key) = std::env::var("OPENAI_API_KEY")    { cmd.env("OPENAI_API_KEY",    key); }
    if let Ok(key) = std::env::var("GEMINI_API_KEY")    { cmd.env("GEMINI_API_KEY",    key); }

    if docker {
        if let Ok(prefix) = crate::docker::exec_prefix(&runbox_id) {
            cmd.env("STACKBOX_DOCKER_EXEC", &prefix);
            cmd.env("STACKBOX_IN_DOCKER",   "1");
        }
    }

    // Deterministic per-workspace port (3100–3999) so parallel agents don't collide
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
    cmd.env("STACKBOX_CONTEXT_FILE", &ctx_file);
    cmd.env("STACKBOX_MEMORY_URL",   format!("http://localhost:{port}/memory"));
    cmd.env("STACKBOX_RUNBOX_ID",    &runbox_id);
    cmd.env("STACKBOX_SESSION_ID",   &session_id);
    cmd.env("STACKBOX_WORKTREE",     worktree_path.as_deref().unwrap_or(""));
    cmd.env("STACKBOX_EVENTS_URL",   format!("http://localhost:{port}/events?runbox_id={runbox_id}"));

    match &agent_kind {
        AgentKind::ClaudeCode    => { cmd.env("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1"); }
        AgentKind::Codex         => { cmd.env("CODEX_CONTEXT_FILE",   &ctx_file); }
        AgentKind::CursorAgent   => { cmd.env("CURSOR_CONTEXT_FILE",  &ctx_file); }
        AgentKind::GeminiCli     => { cmd.env("GEMINI_SYSTEM_MD",     &ctx_file); }
        AgentKind::GitHubCopilot => { cmd.env("COPILOT_CONTEXT_FILE", &ctx_file); }
        AgentKind::Shell         => {}
    }

    let child      = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    // ── Writer channel ────────────────────────────────────────────────────────
    // take_writer() must be called exactly once (portable-pty limitation).
    // We own the writer behind an mpsc channel; every caller (pty_write command,
    // webhook handler, agent launch cmd) sends through the channel.

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();

    state.pty_writer.register(&runbox_id, tx.clone());

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

    // Send the agent's launch command after the shell has had time to start
    if let Some(launch) = agent_kind.launch_cmd(&ctx_file) {
        let tx2 = tx.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            let _ = tx2.send(launch.into_bytes());
        });
    }

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

    // ── PTY reader thread ─────────────────────────────────────────────────────
    let sid               = session_id.clone();
    let rb_id             = runbox_id.clone();
    let app_pty           = app.clone();
    let db_arc            = state.db.clone();
    let pty_writer_arc    = state.pty_writer.clone();
    let conflict_reg_thr  = state.conflict_registry.clone();
    let worktree_path_thr = worktree_path.clone();
    let cwd_thr           = effective_cwd.clone();
    let session_start_ts  = Instant::now();

    std::thread::spawn(move || {
        let mut buf           = [0u8; 8192]; // larger buffer → fewer round-trips
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

            // URL detection: only localhost / file:// open in browser pane
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

            // `start ./index.html` intercept
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

        crate::conflict::on_session_exit(&conflict_reg_thr, &sid, &cwd_thr);
        pty_writer_arc.unregister(&rb_id);

        if agent_kind != AgentKind::Shell {
            snapshot_from_git(&db_arc, &rb_id, &sid, &cwd_thr);
        }

        if let Some(ref wt) = worktree_path_thr {
            remove_worktree(wt);
        }

        // V3 session cleanup + GCC+Letta sleep-time jobs
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