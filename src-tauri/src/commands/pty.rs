// src-tauri/src/commands/pty.rs

use std::io::Write;
use tauri::AppHandle;

use crate::{
    agent::kind::AgentKind,
    db::sessions::session_end,
    git::repo::remove_worktree,
    pty::{self, detection::on_command_entered, expand_cwd},
    state::AppState,
};

#[tauri::command]
pub async fn pty_spawn(
    app:            AppHandle,
    session_id:     String,
    runbox_id:      String,
    cwd:            String,
    agent_cmd:      Option<String>,
    headless:       Option<bool>,
    parent_session: Option<String>,
    state:          tauri::State<'_, AppState>,
) -> Result<(), String> {
    pty::spawn(app, session_id, runbox_id, cwd, agent_cmd, headless, parent_session, &state).await
}

#[tauri::command]
pub fn pty_write(
    session_id: String,
    data:       String,
    state:      tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut inject: Option<(String, String, AgentKind)> = None;
    let mut command_line: Option<(String, String, String)> = None; // (runbox_id, session_id, cwd)

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
                            let kind     = AgentKind::detect(base_cmd);
                            if kind != AgentKind::Shell {
                                inject = Some((s.runbox_id.clone(), s.cwd.clone(), kind));
                            }
                            // Record every non-trivial command as a workspace event
                            command_line = Some((s.runbox_id.clone(), session_id.clone(), s.cwd.clone()));
                            // Store line for use after lock drops
                            let _ = &line; // borrowck: line used below
                        }
                    }
                    '\x08' | '\x7f' => { s.input_buf.pop(); }
                    c if !c.is_control() => { s.input_buf.push(c); }
                    _ => {}
                }
            }
        }
    }

    // Context re-injection when agent command detected
    if let Some((rb, cwd, kind)) = inject {
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
