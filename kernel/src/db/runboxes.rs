// src/db/runboxes.rs
//
// Runbox persistence — branches, worktrees, PR tracking, lifecycle status.
//
// Schema DDL lives entirely in db/schema.rs::migrate(), which is called once
// at startup from db::open(). No DDL here — only reads and writes.

use rusqlite::{params, Result};
use super::{Db, now_ms};

// ─────────────────────────────────────────────────────────────────────────────
// Branch helper
// ─────────────────────────────────────────────────────────────────────────────

pub fn runbox_set_branch(db: &Db, runbox_id: &str, branch: Option<&str>) -> Result<()> {
    let id     = runbox_id.to_string();
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

// ─────────────────────────────────────────────────────────────────────────────
// Write
// ─────────────────────────────────────────────────────────────────────────────

pub fn runbox_set_worktree(
    db:            &Db,
    runbox_id:     &str,
    agent_kind:    &str,
    worktree_path: Option<&str>,
    branch:        Option<&str>,
) -> Result<()> {
    let id            = runbox_id.to_string();
    let agent_kind    = agent_kind.to_string();
    let worktree_path = worktree_path.map(str::to_string);
    let branch        = branch.map(str::to_string);
    let ts            = now_ms();

    db.write_async(move |conn| {
        // schema::migrate() guarantees the table and all columns exist.
        let _ = conn.execute(
            "INSERT INTO agent_worktrees
                (runbox_id, agent_kind, worktree_path, branch, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'working', ?5, ?5)
             ON CONFLICT(runbox_id) DO UPDATE SET
                agent_kind    = excluded.agent_kind,
                worktree_path = excluded.worktree_path,
                branch        = excluded.branch,
                -- Preserve status if agent is already past 'working'
                -- (e.g. pr_open, approved) so reconnect doesn't erase PR tracking.
                status        = CASE
                    WHEN agent_worktrees.status IN ('pr_open','approved','changes_requested')
                    THEN agent_worktrees.status
                    ELSE 'working'
                END,
                updated_at    = excluded.updated_at",
            params![id, agent_kind, worktree_path, branch, ts],
        );
    });
    Ok(())
}

pub fn runbox_set_pr(db: &Db, runbox_id: &str, pr_url: &str) -> Result<()> {
    let id     = runbox_id.to_string();
    let pr_url = pr_url.to_string();
    let ts     = now_ms();
    db.write_async(move |conn| {
        let _ = conn.execute(
            "UPDATE agent_worktrees SET pr_url=?1, status='pr_open', updated_at=?2
             WHERE runbox_id=?3",
            params![pr_url, ts, id],
        );
    });
    Ok(())
}

/// Update lifecycle status.
/// Valid values: working | pr_open | approved | changes_requested | merged | cancelled | error
pub fn runbox_set_status(db: &Db, runbox_id: &str, status: &str) -> Result<()> {
    let id     = runbox_id.to_string();
    let status = status.to_string();
    let ts     = now_ms();
    db.write_async(move |conn| {
        let _ = conn.execute(
            "UPDATE agent_worktrees SET status=?1, updated_at=?2 WHERE runbox_id=?3",
            params![status, ts, id],
        );
    });
    Ok(())
}

pub fn runbox_delete_worktree(db: &Db, runbox_id: &str) -> Result<()> {
    let id = runbox_id.to_string();
    db.write_async(move |conn| {
        let _ = conn.execute(
            "DELETE FROM agent_worktrees WHERE runbox_id=?1",
            params![id],
        );
    });
    Ok(())
}

pub fn runbox_delete(db: &Db, runbox_id: &str) -> Result<()> {
    let id = runbox_id.to_string();
    db.write_async(move |conn| {
        let _ = conn.execute("DELETE FROM runboxes WHERE id=?1", params![id]);
        let _ = conn.execute(
            "DELETE FROM agent_worktrees WHERE runbox_id=?1",
            params![id],
        );
    });
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Read types
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize)]
pub struct WorktreeRecord {
    pub runbox_id:     String,
    pub agent_kind:    String,
    pub worktree_path: Option<String>,
    pub branch:        Option<String>,
    pub pr_url:        Option<String>,
    pub status:        String,
    pub created_at:    i64,
    pub updated_at:    i64,
}

fn row_to_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorktreeRecord> {
    Ok(WorktreeRecord {
        runbox_id:     row.get(0)?,
        agent_kind:    row.get(1)?,
        worktree_path: row.get(2)?,
        branch:        row.get(3)?,
        pr_url:        row.get(4)?,
        status:        row.get(5)?,
        created_at:    row.get(6)?,
        updated_at:    row.get(7)?,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Read — by runbox_id
// ─────────────────────────────────────────────────────────────────────────────

pub fn runbox_get_worktree(db: &Db, runbox_id: &str) -> Option<String> {
    db.read()
        .query_row(
            "SELECT worktree_path FROM agent_worktrees WHERE runbox_id=?1",
            params![runbox_id],
            |row| row.get(0),
        )
        .ok()
        .flatten()
}

pub fn runbox_get_worktree_record(db: &Db, runbox_id: &str) -> Option<WorktreeRecord> {
    db.read()
        .query_row(
            "SELECT runbox_id, agent_kind, worktree_path, branch, pr_url, status,
                    created_at, updated_at
             FROM agent_worktrees WHERE runbox_id=?1",
            params![runbox_id],
            row_to_record,
        )
        .ok()
}

pub fn runbox_find_by_pr(db: &Db, pr_url: &str) -> Option<WorktreeRecord> {
    db.read()
        .query_row(
            "SELECT runbox_id, agent_kind, worktree_path, branch, pr_url, status,
                    created_at, updated_at
             FROM agent_worktrees WHERE pr_url=?1",
            params![pr_url],
            row_to_record,
        )
        .ok()
}

pub fn runbox_all_with_worktrees(db: &Db) -> Vec<WorktreeRecord> {
    let conn = db.read();
    let mut stmt = match conn.prepare(
        "SELECT runbox_id, agent_kind, worktree_path, branch, pr_url, status,
                created_at, updated_at
         FROM agent_worktrees WHERE worktree_path IS NOT NULL",
    ) {
        Ok(s)  => s,
        Err(_) => return vec![],
    };
    stmt.query_map([], row_to_record)
        .ok()
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
}

// ─────────────────────────────────────────────────────────────────────────────
// Read — by workspace_cwd (lists every agent worktree under the workspace root)
// ─────────────────────────────────────────────────────────────────────────────

pub fn workspace_list_worktrees(db: &Db, workspace_cwd: &str) -> Vec<WorktreeRecord> {
    let conn = db.read();
    // Escape LIKE special chars (% and _) in the path so a workspace
    // containing these chars doesn't accidentally match unrelated rows.
    let escaped = workspace_cwd
        .trim_end_matches('/')
        .replace('%', "\\%")
        .replace('_', "\\_");
    let prefix = format!("{}%", escaped);
    let mut stmt = match conn.prepare(
        "SELECT runbox_id, agent_kind, worktree_path, branch, pr_url, status,
                created_at, updated_at
         FROM agent_worktrees
         WHERE worktree_path LIKE ?1 ESCAPE '\\'
         ORDER BY updated_at DESC",
    ) {
        Ok(s)  => s,
        Err(_) => return vec![],
    };
    stmt.query_map(rusqlite::params![prefix], row_to_record)
        .ok()
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
}