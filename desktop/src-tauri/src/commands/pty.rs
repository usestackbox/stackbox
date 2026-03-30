// src-tauri/src/commands/pty.rs
use std::io::Write;
use tauri::AppHandle;
use crate::{
    agent::kind::AgentKind,
    db::sessions::session_end,
    git::repo::{ensure_git_repo, ensure_worktree, has_git, remove_worktree},
    pty::{self, expand_cwd},
    state::AppState,
};

#[tauri::command]
pub async fn pty_spawn(
    app:        AppHandle,
    session_id: String,
    runbox_id:  String,
    cwd:        String,
    agent_cmd:  Option<String>,
    cols:       Option<u16>,
    rows:       Option<u16>,
    docker:     Option<bool>,
    state:      tauri::State<'_, AppState>,
) -> Result<(), String> {
    // ── 1. Resolve the real cwd (expands ~ etc.) ──────────────────────────────
    let real_cwd = expand_cwd(&cwd);

    // ── 2. Ensure git repo + eagerly create the agent's worktree ─────────────
    //
    // Only do this when there is already a .git (or a shadow repo) at cwd.
    // We never auto-init here — that stays an explicit user action.
    let worktree_path: Option<String> = if has_git(&real_cwd, &runbox_id) {
        let _ = ensure_git_repo(&real_cwd, &runbox_id);
        let wt = ensure_worktree(&real_cwd, &runbox_id);

        // Persist worktree path to DB so cleanup and the frontend can read it
        if let Some(ref wt_path) = wt {
            let _ = crate::db::runboxes::runbox_set_worktree(
                &state.db, &runbox_id, Some(wt_path.as_str()),
            );
            eprintln!("[pty_spawn] worktree ready for {runbox_id}: {wt_path}");
        }
        wt
    } else {
        None
    };

    // ── 3. Terminal starts INSIDE the worktree, not the raw workspace ─────────
    //
    // If a worktree was created the terminal's cwd is the isolated checkout.
    // If not (no git yet, shadow repo, docker) the terminal uses the raw cwd.
    let effective_cwd = worktree_path
        .as_deref()
        .unwrap_or(&real_cwd)
        .to_string();

    pty::spawn(
        app, session_id, runbox_id, effective_cwd,
        agent_cmd, cols, rows, docker.unwrap_or(false), &state,
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
        // Note: `cwd` here is already the worktree path (set in pty_spawn).
        // context::inject writes CLAUDE.md / AGENTS.md etc. into the worktree.
        let sid = session_id.clone();
        let db  = state.db.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = crate::agent::context::inject(&db, &rb, &sid, &cwd, &kind).await {
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