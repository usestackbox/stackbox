// src-tauri/src/commands/pty.rs
use std::io::Write;
use tauri::AppHandle;
use crate::{
    agent::kind::AgentKind,
    db::sessions::session_end,
    git::repo::{ensure_git_repo, ensure_worktree, has_git, remove_worktree},
    pty::{self, expand_cwd, tmux_session_alive, kill_tmux_session},
    state::AppState,
};

#[tauri::command]
pub async fn pty_spawn(
    app:            AppHandle,
    session_id:     String,
    runbox_id:      String,
    cwd:            String,
    agent_cmd:      Option<String>,
    workspace_name: Option<String>,
    cols:           Option<u16>,
    rows:           Option<u16>,
    docker:         Option<bool>,
    state:          tauri::State<'_, AppState>,
) -> Result<(), String> {
    // ── 1. Resolve the real cwd ───────────────────────────────────────────────
    let real_cwd = expand_cwd(&cwd);

    // ── 2. Detect agent kind from agent_cmd ───────────────────────────────────
    let kind = agent_cmd.as_deref()
        .map(|cmd| {
            let token    = cmd.trim().split_whitespace().next().unwrap_or(cmd);
            let base_cmd = token.rsplit(['/', '\\']).next().unwrap_or(token);
            AgentKind::detect(base_cmd)
        })
        .unwrap_or(AgentKind::Shell);

    let agent_kind_str = kind.kind_str();

    // ── 3. Ensure git repo + eagerly create the agent's worktree ─────────────
    //
    // Worktree key = runbox_id + agent_kind so:
    //   • Different agents in the same workspace → separate worktrees
    //   • Two Claude sessions in the same workspace → same worktree (shared)
    let _worktree_path: Option<String> = if has_git(&real_cwd, &runbox_id) {
        let _ = ensure_git_repo(&real_cwd, &runbox_id);
        let wt = ensure_worktree(&real_cwd, &runbox_id, &session_id, agent_kind_str);

        if let Some(ref wt) = wt {
            let _ = crate::db::runboxes::runbox_set_worktree(
                &state.db, &runbox_id, agent_kind_str,
                Some(wt.path.as_str()), Some(wt.branch.as_str()),  // 5 args
            );
            let wt_path = &wt.path;
            eprintln!("[pty_spawn] worktree ready for {runbox_id}/{agent_kind_str}: {wt_path}");

            // Write MCP configs to BOTH main cwd AND worktree so every agent
            // finds its .codex/mcp.json / .claude/mcp.json regardless of where
            // it looks.
            let _ = crate::mcp::config::write_mcp_config(
                &real_cwd, Some(wt_path.as_str()), &runbox_id, &session_id,
            );
        } else {
            // No worktree (shadow repo) — write only to main cwd
            let _ = crate::mcp::config::write_mcp_config(
                &real_cwd, None, &runbox_id, &session_id,
            );
        }
        wt.map(|w| w.path)
    } else {
        // No git at all — still write MCP config to cwd
        let _ = crate::mcp::config::write_mcp_config(
            &real_cwd, None, &runbox_id, &session_id,
        );
        None
    };

    // ── 4. Terminal always starts in the user's real workspace folder ──────────
    let effective_cwd = real_cwd.clone();

    pty::spawn(
        app, session_id, runbox_id, effective_cwd,
        agent_cmd, workspace_name, cols, rows, docker.unwrap_or(false), &state,
    ).await
}

#[tauri::command]
pub fn pty_write(
    session_id: String,
    data:       String,
    state:      tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut inject:    Option<(String, String, AgentKind)> = None;
    let mut open_url:  Option<String> = None;
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
                                open_url  = Some(url);
                                send_data = Some("\x03\r\n".to_string());
                            } else {
                                let token    = line.split_whitespace().next().unwrap_or("");
                                let base_cmd = token.rsplit(['/', '\\']).next().unwrap_or(token);
                                let kind     = AgentKind::detect(base_cmd);
                                if kind != AgentKind::Shell {
                                    inject = Some((s.runbox_id.clone(), s.cwd.clone(), kind));
                                }
                            }
                        }
                    }
                    '\x08' | '\x7f' => { s.input_buf.pop(); }
                    c if !c.is_control() => { s.input_buf.push(c); }
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

    if let Some((rb, cwd, kind)) = inject {
        let sid = session_id.clone();
        let _db  = state.db.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = crate::agent::context::inject(&cwd, &rb, &sid, kind.kind_str(), None) {
                eprintln!("[pty_write] re-inject: {e}");
            }
        });
    }
    Ok(())
}

fn intercept_start_cmd(line: &str, cwd: &str) -> Option<String> {
    let mut parts = line.splitn(2, char::is_whitespace);
    let cmd = parts.next().unwrap_or("").to_lowercase();
    if cmd != "start" { return None; }

    let arg = parts.next()?.trim().trim_matches('"').trim_matches('\'');
    if arg.is_empty() { return None; }

    let lower = arg.to_lowercase();
    if !lower.ends_with(".html") && !lower.ends_with(".htm")
        && !lower.ends_with(".svg")  && !lower.ends_with(".pdf") {
        return None;
    }

    if arg.starts_with("file://") { return Some(arg.to_string()); }

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
    session_id: String, cols: u16, rows: u16,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    use portable_pty::PtySize;
    if let Some(s) = state.sessions.lock().unwrap().get(&session_id) {
        s._master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn pty_kill(session_id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    if let Some(mut s) = state.sessions.lock().unwrap().remove(&session_id) {
        let _ = s._child.kill();
        let _ = session_end(&state.db, &session_id, Some(1), None);
        if let Some(ref wt) = s.worktree_path {
            remove_worktree(wt);
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
    Ok(state.sessions.lock().unwrap()
        .get(&runbox_id)
        .and_then(|s| s.worktree_path.clone()))
}