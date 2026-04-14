// kernel/src/pty/mod.rs
// Supercontext V3 — OutputClassifier + ResponseCapture removed.
// Agents write memory intentionally via remember()/session_log()/session_summary().
// Session end: expire TEMPORARY for agent, run auto_session_summary fallback.
//
// WORKTREE LIFECYCLE:
//   spawn()  → ensure_worktree(cwd, runbox_id, session_id, agent_kind)
//            → worktree created at ~/calus/<fnv32(cwd)>/.worktrees/<agent_kind>-<name>/
//            → branch stays alive after worktree is removed
//   PTY exit → remove_worktree_only() → directory gone, branch intact
//   User     → git_merge_branch / git_delete_branch from frontend

pub mod detection;
pub mod watcher;
pub mod writer;

use std::io::{Read, Write};
use std::time::Instant;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::{AppHandle, Emitter};

use crate::{
    agent::{context::inject, injector, kind::AgentKind},
    db::sessions::{session_end, session_start},
    git::{
        inject::inject_into_repo,
        repo::{ensure_git_repo, remove_worktree_only},
    },
    memory,
    state::{AppState, PtySession},
    workspace::{
        events::{record_agent_spawned, record_command_result},
        snapshot::snapshot_from_git,
    },
};

use detection::{on_command_result, strip_ansi};

pub fn expand_cwd(raw: &str) -> String {
    let s = raw.trim();
    let expanded = if s == "~" || s.starts_with("~/") || s.starts_with("~\\") {
        if let Some(home) = dirs::home_dir() {
            let rest = s[1..].trim_start_matches('/').trim_start_matches('\\');
            if rest.is_empty() {
                home.to_string_lossy().to_string()
            } else {
                home.join(rest).to_string_lossy().to_string()
            }
        } else {
            s.to_string()
        }
    } else {
        s.to_string()
    };

    #[cfg(windows)]
    if expanded.contains('%') {
        if let Ok(v) = std::env::var("USERPROFILE") {
            return expanded
                .replace("%USERPROFILE%", &v)
                .replace("%userprofile%", &v);
        }
    }
    expanded
}

// ─────────────────────────────────────────────────────────────────────────────
// Tmux session persistence (Unix only)
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(not(windows))]
fn tmux_available() -> bool {
    std::process::Command::new("tmux")
        .arg("-V")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn tmux_session_name(runbox_id: &str) -> String {
    // Use first 16 chars to keep name short; replace non-alphanumeric with -
    let short: String = runbox_id
        .chars()
        .take(16)
        .map(|c| {
            if c.is_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect();
    format!("sb-{}", short)
}

#[cfg(not(windows))]
fn tmux_session_exists(name: &str) -> bool {
    std::process::Command::new("tmux")
        .args(["has-session", "-t", name])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(not(windows))]
pub fn kill_tmux_session(runbox_id: &str) {
    let name = tmux_session_name(runbox_id);
    let _ = std::process::Command::new("tmux")
        .args(["kill-session", "-t", &name])
        .output();
    eprintln!("[pty] tmux session killed: {name}");
}

#[cfg(not(windows))]
pub fn tmux_session_alive(runbox_id: &str) -> bool {
    tmux_available() && tmux_session_exists(&tmux_session_name(runbox_id))
}

#[cfg(windows)]
pub fn kill_tmux_session(_runbox_id: &str) {}
#[cfg(windows)]
pub fn tmux_session_alive(_runbox_id: &str) -> bool {
    false
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
/// Worktrees now live inside .worktrees/ so we check the grandparent folder name.
fn detect_worktree(cwd: &str) -> Option<String> {
    let path = std::path::Path::new(cwd);

    // New layout: .worktrees/calus-wt-...  — parent is .worktrees/, grandparent is project
    if let Some(parent) = path.parent() {
        if parent.file_name().and_then(|n| n.to_str()) == Some(".worktrees") {
            let folder = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if folder.starts_with("calus-wt-") {
                return Some(cwd.to_string());
            }
        }
    }

    // Legacy layout: sibling folder named calus-wt-*
    let folder = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if folder.starts_with("calus-wt-") {
        return Some(cwd.to_string());
    }

    None
}

fn is_intentional_url(url: &str) -> bool {
    if url.starts_with("file://") {
        return true;
    }
    if url.contains("localhost") || url.contains("127.0.0.1") || url.contains("0.0.0.0") {
        return true;
    }
    false
}

#[cfg(windows)]
fn find_powershell() -> String {
    let candidates = [
        "pwsh.exe",
        r"C:\Program Files\PowerShell\7\pwsh.exe",
        r"C:\Program Files\PowerShell\6\pwsh.exe",
    ];
    for c in &candidates {
        if std::path::Path::new(c).exists() || which_exe(c) {
            return c.to_string();
        }
    }
    let sys_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
    format!(
        "{}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        sys_root
    )
}

#[cfg(windows)]
fn which_exe(name: &str) -> bool {
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in path_var.split(';') {
            let candidate = std::path::Path::new(dir).join(name);
            if candidate.exists() {
                return true;
            }
        }
    }
    false
}

pub async fn spawn(
    app: AppHandle,
    session_id: String,
    runbox_id: String,
    cwd: String,
    agent_cmd: Option<String>,
    workspace_name: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
    docker: bool,
    state: &AppState,
) -> Result<(), String> {
    let pty_system = native_pty_system();

    let init_cols = cols.unwrap_or(220).max(40);
    let init_rows = rows.unwrap_or(50).max(10);

    let pair = pty_system
        .openpty(PtySize {
            rows: init_rows,
            cols: init_cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let resolved_cwd = expand_cwd(&cwd);
    let agent_str = agent_cmd.as_deref().unwrap_or("shell");
    let agent_kind = AgentKind::detect(agent_str);

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
        ensure_git_repo(&resolved_cwd, &runbox_id).unwrap_or_else(|e| {
            eprintln!("[pty] ensure_git_repo: {e}");
            String::new()
        });
    }

    // ── Create agent worktree for non-shell agents ────────────────────────────
    // Pass session_id so each session gets a unique worktree even if the same
    // agent runs multiple times on the same runbox.
    let agent_worktree = if worktree_path.is_none() && agent_kind != AgentKind::Shell {
        crate::git::repo::ensure_worktree(&resolved_cwd, &runbox_id, &session_id, agent_str)
    } else {
        None
    };

    let effective_cwd = agent_worktree
        .as_ref()
        .map(|w| w.path.clone())
        .or_else(|| worktree_path.clone())
        .unwrap_or_else(|| resolved_cwd.clone());

    clear_git_lock(&effective_cwd);

    // Persist branch record to DB
    if let Some(ref wt) = agent_worktree {
        let _ = crate::db::branches::record_branch_start(
            &state.db,
            &runbox_id,
            &session_id,
            agent_str,
            &wt.branch,
            &wt.path,
        );
    }

    record_agent_spawned(
        &state.db,
        &runbox_id,
        &session_id,
        agent_kind.display_name(),
        &effective_cwd,
    );

    crate::agent::globals::register_runbox_cwd(&runbox_id, &effective_cwd);

    // Inject agent instruction file + skill directories into the user's actual
    // repo root (resolved_cwd, not the worktree) at PTY spawn time.
    // This runs whether or not the agent ever calls git_ensure via MCP,
    // so CLAUDE.md / AGENTS.md / GEMINI.md / .cursorrules / copilot-instructions.md
    // and all skill dirs are always present when the agent starts reading the repo.
    if agent_kind != AgentKind::Shell {
        inject_into_repo(std::path::Path::new(&resolved_cwd), agent_kind.kind_str());
    }

    if agent_kind != AgentKind::Shell {
        let rb4 = runbox_id.clone();
        let cwd4 = effective_cwd.clone();
        let db4 = state.db.clone();
        tauri::async_runtime::spawn(async move {
            crate::memory::sleep::boot_init(&rb4, &cwd4, &db4).await;
        });
    }

    {
        let rb = runbox_id.clone();
        let sid = session_id.clone();
        let cwd_c = effective_cwd.clone();
        let ak = agent_kind.display_name().to_string();
        // Pass the real worktree path so the context file has the correct `cd` target.
        let wt_path = agent_worktree.as_ref().map(|w| w.path.clone());
        tauri::async_runtime::spawn(async move {
            if let Err(e) = inject(&cwd_c, &rb, &sid, &ak, wt_path.as_deref()) {
                eprintln!("[pty] inject context: {e}");
            }
        });
    }

    // ── Shell command ─────────────────────────────────────────────────────────
    #[cfg(windows)]
    let mut cmd = {
        let ps = find_powershell();

        // Write a temp init script so we can:
        //   1. Set a proper prompt (shows just the folder name)
        //   2. Emit OSC 7 on every prompt so the titlebar CWD tracks correctly
        //   3. OSC 7 emitted immediately so titlebar CWD is correct on first render
        let tmp_script =
            std::env::temp_dir().join(format!("calus-ps-init-{}.ps1", std::process::id()));

        // The prompt function:
        //   • Builds a file:// URL with forward slashes for the OSC 7 sequence
        //   • URL-encodes spaces as %20 so the frontend parser handles them
        //   • Writes ESC]7;url BEL directly to the console stream
        //   • Returns "leaf> " as the visible prompt string
        let init_ps1 = r#"
function prompt {
    $loc  = (Get-Location).Path
    $leaf = Split-Path -Leaf $loc
    # Build OSC 7 CWD sequence: ESC ] 7 ; file://hostname/C:/path BEL
    $url  = $loc.Replace('\', '/').Replace(' ', '%20')
    if (-not $url.StartsWith('/')) { $url = '/' + $url }
    $osc7 = [char]27 + ']7;file://' + $env:COMPUTERNAME + $url + [char]7
    [Console]::Write($osc7)
    # OSC 133;A — prompt start (signals previous command finished).
    $osc133a = [char]27 + ']133;A' + [char]7
    [Console]::Write($osc133a)
    return $leaf + '> '
}
# Emit OSC 7 + OSC 133;A immediately so the titlebar CWD and first block
# boundary are correct before the user types anything.
$loc  = (Get-Location).Path
$url  = $loc.Replace('\', '/').Replace(' ', '%20')
if (-not $url.StartsWith('/')) { $url = '/' + $url }
[Console]::Write([char]27 + ']7;file://' + $env:COMPUTERNAME + $url + [char]7)
[Console]::Write([char]27 + ']133;A' + [char]7)
"#;
        let _ = std::fs::write(&tmp_script, init_ps1);

        let mut c = CommandBuilder::new(&ps);
        c.args(&[
            "-NoLogo",
            "-NoProfile",
            "-NoExit",
            "-File",
            tmp_script.to_str().unwrap_or(""),
        ]);
        for var in &[
            "USERPROFILE",
            "APPDATA",
            "LOCALAPPDATA",
            "TEMP",
            "TMP",
            "PATH",
            "SystemRoot",
            "COMSPEC",
            "USERNAME",
            "USERDOMAIN",
            "HOMEDRIVE",
            "HOMEPATH",
        ] {
            if let Ok(val) = std::env::var(var) {
                c.env(var, val);
            }
        }
        c
    };

    #[cfg(not(windows))]
    let mut cmd = {
        let preferred_shell = std::env::var("SHELL").unwrap_or_default();
        let shell =
            if !preferred_shell.is_empty() && std::path::Path::new(&preferred_shell).exists() {
                preferred_shell
            } else {
                let candidates = [
                    "/bin/zsh",
                    "/usr/bin/zsh",
                    "/bin/bash",
                    "/usr/bin/bash",
                    "/bin/sh",
                ];
                candidates
                    .iter()
                    .find(|p| std::path::Path::new(*p).exists())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "/bin/sh".to_string())
            };

        let shell_name = std::path::Path::new(&shell)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("sh");

        let mut c = CommandBuilder::new(&shell);

        // ── Tmux session persistence ───────────────────────────────────────────
        // If tmux is available, wrap the shell inside a persistent tmux session.
        // On app reopen the shell reconnects to the existing session — CWD,
        // running processes, and scrollback are all preserved.
        let tmux_name = tmux_session_name(&runbox_id);
        let use_tmux = tmux_available();

        if use_tmux {
            // Create new session if it doesn't exist yet; attach if it does.
            if !tmux_session_exists(&tmux_name) {
                let _ = std::process::Command::new("tmux")
                    .args(["new-session", "-d", "-s", &tmux_name, "-c", &effective_cwd])
                    .output();
                eprintln!("[pty] tmux session created: {tmux_name}");
            } else {
                eprintln!("[pty] tmux session reconnect: {tmux_name}");
            }
            let mut c = CommandBuilder::new("tmux");
            c.args(&["attach-session", "-t", &tmux_name]);
            c.cwd(&effective_cwd);
            c
        } else if shell_name == "zsh" {
            let calus_zsh_dir = format!("/tmp/calus-zsh-{}", std::process::id());
            let _ = std::fs::create_dir_all(&calus_zsh_dir);
            let zshrc = r#"
            [ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc" 2>/dev/null
            autoload -U colors && colors 2>/dev/null
            PROMPT="%B%F{cyan}%1~%f%b %% "
            # Emit OSC 133;A (prompt start = previous command finished).
            # In tmux we must wrap with the DCS passthrough so the sequence
            # survives the tmux multiplexer and reaches the PTY reader.
            _calus_osc133a() {
                if [ -n "$TMUX" ]; then
                    printf '\033Ptmux;\033\033]133;A\007\033\\';
                else
                    printf '\033]133;A\007';
                fi
            }
            precmd() {
                _calus_osc133a
                printf '\e]7;file://%s%s\a' "$HOST" "$PWD"
            }
            "#;
            let _ = std::fs::write(format!("{calus_zsh_dir}/.zshrc"), zshrc);
            c.env("ZDOTDIR", &calus_zsh_dir);
            c
        } else if shell_name == "bash" {
            let calus_bash_dir = format!("/tmp/calus-bash-{}", std::process::id());
            let _ = std::fs::create_dir_all(&calus_bash_dir);
            let bashrc = r#"
            [ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc" 2>/dev/null
            PS1='\[\033[01;36m\]\W\[\033[00m\] \$ '
            _calus_osc133a() {
                if [ -n "$TMUX" ]; then
                    printf '\033Ptmux;\033\033]133;A\007\033\\';
                else
                    printf '\033]133;A\007';
                fi
            }
            _calus_precmd() {
                _calus_osc133a
                printf '\e]7;file://%s%s\a' "$HOSTNAME" "$PWD"
            }
            PROMPT_COMMAND="_calus_precmd${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
            "#;
            let bashrc_path = format!("{calus_bash_dir}/.bashrc");
            let _ = std::fs::write(&bashrc_path, bashrc);
            c = CommandBuilder::new(&shell);
            c.args(&["--rcfile", &bashrc_path]);
            c
        } else {
            c
        }
    };

    cmd.cwd(&effective_cwd);

    // ── Universal environment ─────────────────────────────────────────────────
    cmd.env("STACKBOX_WORKSPACE_NAME", &ws_label);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("LANG", "en_US.UTF-8");

    {
        let shim = if cfg!(windows) {
            "calus-open.exe"
        } else {
            "calus-open"
        };
        if let Some(path) = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join(shim)))
            .filter(|p| p.exists())
        {
            cmd.env("BROWSER", path.to_string_lossy().to_string());
        }
    }

    if let Ok(key) = std::env::var("ANTHROPIC_API_KEY") {
        cmd.env("ANTHROPIC_API_KEY", key);
    }
    if let Ok(key) = std::env::var("OPENAI_API_KEY") {
        cmd.env("OPENAI_API_KEY", key);
    }
    if let Ok(key) = std::env::var("GEMINI_API_KEY") {
        cmd.env("GEMINI_API_KEY", key);
    }

    if docker {
        if let Ok(prefix) = crate::docker::exec_prefix(&runbox_id) {
            cmd.env("STACKBOX_DOCKER_EXEC", &prefix);
            cmd.env("STACKBOX_IN_DOCKER", "1");
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
    cmd.env("PORT", pane_port.to_string());
    cmd.env("DEV_PORT", pane_port.to_string());
    cmd.env("VITE_PORT", pane_port.to_string());
    cmd.env("NEXT_PORT", pane_port.to_string());
    cmd.env("DEBUG_PORT", (pane_port + 1000).to_string());
    cmd.env("STACKBOX_PORT", pane_port.to_string());
    cmd.env("NODE_ENV", "development");
    cmd.env("STACKBOX_PANE_PORT", pane_port.to_string());

    let port = crate::MEMORY_PORT;
    let ctx_file = format!("{effective_cwd}/.calus-context.md");
    cmd.env("STACKBOX_CONTEXT_FILE", &ctx_file);
    cmd.env(
        "STACKBOX_MEMORY_URL",
        format!("http://localhost:{port}/memory"),
    );
    cmd.env("STACKBOX_RUNBOX_ID", &runbox_id);
    cmd.env("STACKBOX_SESSION_ID", &session_id);
    // STACKBOX_WORKTREE now points inside .worktrees/ — relative path for agent awareness
    let wt_env = agent_worktree
        .as_ref()
        .map(|w| w.path.as_str())
        .unwrap_or("");
    cmd.env("STACKBOX_WORKTREE", wt_env);
    cmd.env(
        "STACKBOX_EVENTS_URL",
        format!("http://localhost:{port}/events?runbox_id={runbox_id}"),
    );

    match &agent_kind {
        AgentKind::ClaudeCode => {
            cmd.env("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1");
        }
        AgentKind::Codex => {
            cmd.env("CODEX_CONTEXT_FILE", &ctx_file);
        }
        AgentKind::CursorAgent => {
            cmd.env("CURSOR_CONTEXT_FILE", &ctx_file);
        }
        AgentKind::GeminiCli => {
            cmd.env("GEMINI_SYSTEM_MD", &ctx_file);
            // Gemini CLI does not support --mcp-config as a CLI flag.
            // It reads GEMINI_MCP_CONFIG instead — point it at the shared
            // mcp.json that write_mcp_config() already wrote this spawn.
            // Also expose CALUS_PORT + CALUS_TOKEN so the stdio bridge
            // (calus-stdio entry in mcp.json) can reach the kernel HTTP server.
            cmd.env("CALUS_PORT", crate::MEMORY_PORT.to_string());
            cmd.env("CALUS_TOKEN", format!("Bearer {}", session_id));
        }
        AgentKind::GitHubCopilot => {
            cmd.env("COPILOT_CONTEXT_FILE", &ctx_file);
        }
        AgentKind::Shell => {}
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

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

    if let Some(launch) = agent_kind.launch_cmd(&ctx_file) {
        let tx2 = tx.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            let _ = tx2.send(launch.into_bytes());
        });
    }
    // NOTE: The old "send \\r\\n after 300ms for shell sessions" block was removed.
    // It caused the prompt to render twice — the shell already prints its prompt on
    // startup via the ZDOTDIR .zshrc / .bashrc init scripts above (chpwd / PROMPT_COMMAND),
    // so the extra Enter just triggered a second, blank prompt line.

    struct ChannelWriter(tokio::sync::mpsc::UnboundedSender<Vec<u8>>);
    impl Write for ChannelWriter {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.send(buf.to_vec()).map_err(|_| {
                std::io::Error::new(std::io::ErrorKind::BrokenPipe, "PTY channel closed")
            })?;
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    let _ = session_start(
        &state.db,
        &session_id,
        &runbox_id,
        "",
        agent_str,
        &effective_cwd,
    );

    // Store the worktree path for cleanup on exit
    let wt_path_for_session = agent_worktree.as_ref().map(|w| w.path.clone());

    state.sessions.lock().unwrap().insert(
        session_id.clone(),
        PtySession {
            writer: Box::new(ChannelWriter(tx)),
            _master: pair.master,
            _child: child,
            input_buf: String::new(),
            runbox_id: runbox_id.clone(),
            cwd: effective_cwd.clone(),
            agent_kind: agent_kind.clone(),
            worktree_path: wt_path_for_session.clone(),
            docker,
        },
    );

    // ── PTY reader thread ─────────────────────────────────────────────────────
    let sid = session_id.clone();
    let rb_id = runbox_id.clone();
    let app_pty = app.clone();
    let db_arc = state.db.clone();
    let pty_writer_arc = state.pty_writer.clone();
    let conflict_reg_thr = state.conflict_registry.clone();
    let worktree_path_thr = wt_path_for_session.clone();
    let cwd_thr = effective_cwd.clone();
    let session_start_ts = Instant::now();

    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut detected_kind = agent_kind.clone();

        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            let text = String::from_utf8_lossy(&buf[..n]).to_string();

            // ── Warp-style block boundary: OSC 133;A = prompt appeared ────────
            // Shell emits ESC ] 133 ; A BEL (via precmd/PROMPT_COMMAND/prompt fn)
            // every time the prompt is drawn.  This is our reliable signal that
            // the previous command has finished and the shell is idle again.
            // The frontend uses this to close the current output block.
            let osc133_payloads = detection::extract_osc133(&text);
            for payload in osc133_payloads {
                if payload.starts_with('A') {
                    // "A" = prompt start → previous command is done
                    let _ = app_pty.emit(&format!("pty://block/prompt/{}", sid), ());
                } else if payload.starts_with("D;") || payload == "D" {
                    // "D;N" = command finished with exit code N
                    let exit_code: i32 = payload
                        .strip_prefix("D;")
                        .and_then(|s| s.parse().ok())
                        .unwrap_or(0);
                    let _ = app_pty.emit(
                        &format!("pty://block/exit/{}", sid),
                        serde_json::json!({ "exit_code": exit_code }),
                    );
                }
            }

            if detected_kind == AgentKind::Shell {
                let stripped = strip_ansi(&text);
                if let Some(upgraded) = AgentKind::infer_from_output(&stripped) {
                    detected_kind = upgraded.clone();
                    let _ = app_pty.emit(
                        &format!("pty://agent/{}", sid),
                        upgraded.display_name().to_string(),
                    );
                    // Agent was typed inside an already-running shell — inject
                    // instruction file + skill dirs now, since PTY spawn ran as
                    // Shell and skipped injection earlier.
                    inject_into_repo(std::path::Path::new(&cwd_thr), upgraded.kind_str());
                }
            }

            let text_clean = strip_ansi(&text);
            for word in text_clean.split_whitespace() {
                let clean = word.trim_matches(|c: char| {
                    !c.is_alphanumeric()
                        && c != '/'
                        && c != ':'
                        && c != '.'
                        && c != '-'
                        && c != '_'
                        && c != '?'
                        && c != '='
                        && c != '&'
                        && c != '#'
                        && c != '%'
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
                                .join(
                                    rest.trim_start_matches('.')
                                        .trim_start_matches('\\')
                                        .trim_start_matches('/'),
                                )
                                .to_string_lossy()
                                .to_string()
                        } else {
                            rest.to_string()
                        };
                        let file_url = format!(
                            "file:///{}",
                            resolved.replace('\\', "/").trim_start_matches('/')
                        );
                        let _ = app_pty.emit("browser-open-url", file_url);
                    }
                }
            }

            let _ = app_pty.emit(&format!("pty://output/{}", sid), &text);
        }

        // ── Session ended ─────────────────────────────────────────────────────
        eprintln!("[pty] session ended naturally: {sid}");

        let duration_ms = session_start_ts.elapsed().as_millis() as i64;
        let _ = session_end(&db_arc, &sid, None, None);
        on_command_result(&db_arc, &rb_id, &sid, 0, duration_ms);

        crate::conflict::on_session_exit(&conflict_reg_thr, &sid, &cwd_thr);
        pty_writer_arc.unregister(&rb_id);

        if agent_kind != AgentKind::Shell {
            snapshot_from_git(&db_arc, &rb_id, &sid, &cwd_thr);
        }

        // Remove worktree directory — branch is kept for user to merge/delete.
        if let Some(ref wt) = worktree_path_thr {
            remove_worktree_only(wt);
            let _ = crate::db::branches::record_branch_done(&db_arc, &rb_id, &sid);
            eprintln!("[pty] worktree removed, branch kept for {rb_id}/{sid}");
        }

        // Emit pty:exited so frontend can update branch status badge.
        let _ = app_pty.emit("pty:exited", &sid);

        // V3 session cleanup + sleep-time jobs
        if agent_kind != AgentKind::Shell {
            let rb2 = rb_id.clone();
            let sid2 = sid.clone();
            let cwd2 = cwd_thr.clone();
            let db2 = db_arc.clone();
            let an2 = detected_kind.display_name().to_string();

            tauri::async_runtime::spawn(async move {
                let agent_type = memory::agent_type_from_name(&an2);
                let agent_id = memory::make_agent_id(&agent_type, &sid2);

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
