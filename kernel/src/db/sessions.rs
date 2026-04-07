// src-tauri/src/db/sessions.rs

use super::{now_ms, Db, Session};
use rusqlite::{params, Result};

pub fn session_start(
    db: &Db,
    id: &str,
    runbox_id: &str,
    pane_id: &str,
    agent: &str,
    cwd: &str,
) -> Result<()> {
    let (id, runbox_id, pane_id, agent, cwd) = (
        id.to_string(),
        runbox_id.to_string(),
        pane_id.to_string(),
        agent.to_string(),
        cwd.to_string(),
    );
    let ts = now_ms();
    db.write_async(move |conn| {
        let _ = conn.execute(
            "INSERT OR REPLACE INTO sessions (id, runbox_id, pane_id, agent, cwd, started_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, runbox_id, pane_id, agent, cwd, ts],
        );
    });
    Ok(())
}

pub fn session_end(
    db: &Db,
    id: &str,
    exit_code: Option<i32>,
    log_path: Option<&str>,
) -> Result<()> {
    let id = id.to_string();
    let log_path = log_path.map(str::to_string);
    let ts = now_ms();
    db.write_async(move |conn| {
        let _ = conn.execute(
            "UPDATE sessions SET ended_at=?1, exit_code=?2, log_path=?3 WHERE id=?4",
            params![ts, exit_code, log_path, id],
        );
    });
    Ok(())
}

pub fn sessions_for_runbox(db: &Db, runbox_id: &str) -> Result<Vec<Session>> {
    let conn = db.read();
    let mut stmt = conn.prepare(
        "SELECT id, runbox_id, pane_id, agent, cwd, started_at, ended_at, exit_code, log_path
         FROM sessions WHERE runbox_id=?1 ORDER BY started_at DESC",
    )?;
    let rows = stmt.query_map(params![runbox_id], |r| {
        Ok(Session {
            id: r.get(0)?,
            runbox_id: r.get(1)?,
            pane_id: r.get(2)?,
            agent: r.get(3)?,
            cwd: r.get(4)?,
            started_at: r.get(5)?,
            ended_at: r.get(6)?,
            exit_code: r.get(7)?,
            log_path: r.get(8)?,
        })
    })?;
    rows.collect()
}
