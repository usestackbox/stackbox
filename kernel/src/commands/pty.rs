// src-tauri/src/commands/pty.rs
use crate::{
    agent::kind::AgentKind,
    db::sessions::session_end,
    git::repo::{ensure_git_repo, has_git, remove_worktree_only},
    pty::{self, expand_cwd, kill_tmux_session, tmux_session_alive},
    state::AppState,
    workspace::persistent,
};
use std::io::Write;
use tauri::AppHandle;

#[tauri::command]
pub async fn pty_spawn(
    app: AppHandle,
    session_id: String,
    runbox_id: String,
    cwd: String,
    agent_cmd: Option<String>,
    workspace_name: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
    docker: Option<bool>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    // ── 1. Resolve the real cwd ───────────────────────────────────────────────
    let real_cwd = expand_cwd(&cwd);

    // ── 2. Detect agent kind from agent_cmd ───────────────────────────────────
    let kind = agent_cmd
        .as_deref()
        .map(|cmd| {
            let token = cmd.trim().split_whitespace().next().unwrap_or(cmd);
            let base_cmd = token.rsplit(['/', '\\']).next().unwrap_or(token);
            AgentKind::detect(base_cmd)
        })
        .unwrap_or(AgentKind::Shell);

    let agent_kind_str = kind.kind_str();

    // ── 3. Init persistent project dir in appdata ─────────────────────────────
    if let Err(e) = persistent::init_project(&real_cwd) {
        eprintln!("[pty_spawn] persistent::init_project: {e}");
    }

    // ── 4. Ensure git repo (no worktree creation — agent does that itself) ────
    if has_git(&real_cwd, &runbox_id) {
        let _ = ensure_git_repo(&real_cwd, &runbox_id);
    }

    // ── 6. Write per-agent context file to appdata ────────────────────────────
    // No worktree path yet — agent will create the worktree itself.
    if let Err(e) =
        crate::agent::context::inject(&real_cwd, &runbox_id, &session_id, agent_kind_str, None)
    {
        eprintln!("[pty_spawn] context::inject: {e}");
    }

    let context_file = crate::agent::context::context_file_path(&real_cwd, &runbox_id);
    eprintln!("[pty_spawn] STACKBOX_CONTEXT={}", context_file.display());

    // ── 8. Terminal always starts in the user's real workspace folder ─────────
    pty::spawn(
        app,
        session_id,
        runbox_id,
        real_cwd,
        agent_cmd,
        workspace_name,
        cols,
        rows,
        docker.unwrap_or(false),
        &state,
    )
    .await
}


#[tauri::command]
pub fn pty_write(
    session_id: String,
    data: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut inject: Option<(String, String, AgentKind, Option<String>)> = None;
    let mut open_url: Option<String> = None;
    let mut send_data: Option<String> = None;

    {
        let mut sessions = state.sessions.lock().unwrap();
        if let Some(s) = sessions.get_mut(&session_id) {
            for ch in data.chars() {
                match ch {
                    '\r' | '\n' => {
                        let line = s.input_buf.trim().to_string();
                        s.input_buf.clear();
                        if !line.is_empty() {
                            if let Some(url) = intercept_start_cmd(&line, &s.cwd) {
                                open_url = Some(url);
                                send_data = Some("\x03\r\n".to_string());
                            } else {
                                // ── Warp-style block: tell the frontend a new command
                                // was submitted so it can open a fresh output block
                                // before any output bytes arrive.
                                crate::agent::globals::emit_event(
                                    &format!("pty://block/cmd/{}", session_id),
                                    serde_json::json!({ "command": line }),
                                );

                                let token = line.split_whitespace().next().unwrap_or("");
                                let base_cmd = token.rsplit(['/', '\\']).next().unwrap_or(token);
                                let kind = AgentKind::detect(base_cmd);
                                if kind != AgentKind::Shell {
                                    inject = Some((
                                        s.runbox_id.clone(),
                                        s.cwd.clone(),
                                        kind,
                                        s.worktree_path.clone(),
                                    ));
                                }
                            }
                        }
                    }
                    '\x08' | '\x7f' => {
                        s.input_buf.pop();
                    }
                    c if !c.is_control() => {
                        s.input_buf.push(c);
                    }
                    _ => {}
                }
            }

            let to_write = send_data.as_deref().unwrap_or(&data);
            let _ = s.writer.write_all(to_write.as_bytes());
            let _ = s.writer.flush();
        }
    }

    if let Some(url) = open_url {
        crate::agent::globals::emit_event("browser-open-url", serde_json::json!(url));
    }

    if let Some((rb, cwd, kind, wt_path)) = inject {
        let sid = session_id.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) =
                crate::agent::context::inject(&cwd, &rb, &sid, kind.kind_str(), wt_path.as_deref())
            {
                eprintln!("[pty_write] re-inject: {e}");
            }
        });
    }
    Ok(())
}

fn intercept_start_cmd(line: &str, cwd: &str) -> Option<String> {
    let mut parts = line.splitn(2, char::is_whitespace);
    let cmd = parts.next().unwrap_or("").to_lowercase();
    if cmd != "start" {
        return None;
    }

    let arg = parts.next()?.trim().trim_matches('"').trim_matches('\'');
    if arg.is_empty() {
        return None;
    }

    let lower = arg.to_lowercase();
    if !lower.ends_with(".html")
        && !lower.ends_with(".htm")
        && !lower.ends_with(".svg")
        && !lower.ends_with(".pdf")
    {
        return None;
    }

    if arg.starts_with("file://") {
        return Some(arg.to_string());
    }

    if arg.len() >= 2 && arg.chars().nth(1) == Some(':') {
        let normalised = arg.replace('\\', "/");
        return Some(format!("file:///{normalised}"));
    }

    let abs = std::path::Path::new(cwd).join(arg);

    if let Ok(canonical) = abs.canonicalize() {
        if let Ok(url) = url::Url::from_file_path(&canonical) {
            return Some(url.to_string());
        }
        let s = canonical.to_string_lossy().replace('\\', "/");
        return Some(format!("file:///{}", s.trim_start_matches('/')));
    }

    let s = abs.to_string_lossy().replace('\\', "/");
    Some(format!("file:///{}", s.trim_start_matches('/')))
}

#[tauri::command]
pub fn pty_resize(
    session_id: String,
    cols: u16,
    rows: u16,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    use portable_pty::PtySize;
    if let Some(s) = state.sessions.lock().unwrap().get(&session_id) {
        s._master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn pty_kill(session_id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    if let Some(mut s) = state.sessions.lock().unwrap().remove(&session_id) {
        let _ = s._child.kill();
        let _ = session_end(&state.db, &session_id, Some(1), None);

        persistent::deregister_session(&s.runbox_id);

        // Only clean up worktree if agent actually created one.
        // wt_path is None at spawn — it gets set later when agent reports via MCP.
        if let Some(ref wt) = s.worktree_path {
            let wt_name = persistent::wt_name_from_path(wt);
            persistent::update_agent_status(&s.cwd, &wt_name, "paused");
            // Keep worktree on disk — agent resumes from it on next open.
            remove_worktree_only(wt);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn pty_session_alive(runbox_id: String) -> bool {
    tmux_session_alive(&runbox_id)
}

#[tauri::command]
pub fn pty_kill_session(runbox_id: String) -> Result<(), String> {
    kill_tmux_session(&runbox_id);
    Ok(())
}

#[tauri::command]
pub async fn get_session_worktree_path(
    runbox_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Option<String>, String> {
    Ok(state
        .sessions
        .lock()
        .unwrap()
        .get(&runbox_id)
        .and_then(|s| s.worktree_path.clone()))
}

// ── Persistent memory commands ────────────────────────────────────────────────

#[tauri::command]
pub fn get_workspace_agents(cwd: String) -> Vec<persistent::AgentEntry> {
    persistent::list_all_agents(&cwd)
}

#[tauri::command]
pub fn get_resumable_agents(cwd: String) -> Vec<persistent::AgentEntry> {
    persistent::agents_to_resume(&cwd)
}

#[tauri::command]
pub fn get_agent_state(cwd: String, wt_name: String) -> Option<String> {
    persistent::read_agent_state(&cwd, &wt_name)
}

#[tauri::command]
pub fn mark_agent_done(cwd: String, wt_name: String) -> Result<(), String> {
    persistent::update_agent_status(&cwd, &wt_name, "done");
    Ok(())
}

/// Returns the current working directory of a running PTY session.
/// Uses the stored cwd from session state (set at spawn time).
/// For a live cwd, the frontend should track cd events from PTY output.
#[tauri::command]
pub fn pty_get_cwd(session_id: String, state: tauri::State<'_, AppState>) -> Option<String> {
    let sessions = state.sessions.lock().ok()?;
    let session = sessions.get(&session_id)?;

    // Try to resolve the live cwd via the OS process if pid is available.
    let pid = session._child.process_id();

    if let Some(pid) = pid {
        #[cfg(target_os = "linux")]
        {
            if let Ok(path) = std::fs::read_link(format!("/proc/{pid}/cwd")) {
                if let Some(s) = path.to_str() {
                    return Some(s.to_string());
                }
            }
        }
        #[cfg(target_os = "macos")]
        {
            if let Ok(out) = std::process::Command::new("lsof")
                .args(["-a", "-p", &pid.to_string(), "-d", "cwd", "-Fn"])
                .output()
            {
                if let Ok(s) = String::from_utf8(out.stdout) {
                    if let Some(line) = s.lines().find(|l| l.starts_with('n')) {
                        return Some(line[1..].to_string());
                    }
                }
            }
        }
        // Windows: not easily available without WMI — fall through to stored cwd.
        let _ = pid;
    }

    // Fallback: return the cwd stored at session spawn time.
    Some(session.cwd.clone())
}