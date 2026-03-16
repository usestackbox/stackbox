// src-tauri/src/db/runboxes.rs

use rusqlite::{params, Result};
use super::{Db, now_ms};

pub fn runbox_set_branch(db: &Db, id: &str, branch: Option<&str>) -> Result<()> {
    let id     = id.to_string();
    let branch = branch.map(str::to_string);
    let ts     = now_ms();
    db.write_async(move |conn| {
        let _ = conn.execute(
            "UPDATE runboxes SET branch=?1, updated_at=?2 WHERE id=?3",
            params![branch, ts, id],
        );
    });
    Ok(())
}

pub fn runbox_set_worktree(db: &Db, id: &str, worktree_path: Option<&str>) -> Result<()> {
    let id            = id.to_string();
    let worktree_path = worktree_path.map(str::to_string);
    let ts            = now_ms();
    db.write_async(move |conn| {
        let _ = conn.execute(
            "UPDATE runboxes SET worktree_path=?1, updated_at=?2 WHERE id=?3",
            params![worktree_path, ts, id],
        );
    });
    Ok(())
}

pub fn runbox_delete(db: &Db, id: &str) -> Result<()> {
    let id = id.to_string();
    db.write_async(move |conn| {
        let _ = conn.execute("DELETE FROM runboxes WHERE id=?1", params![id]);
    });
    Ok(())
}
