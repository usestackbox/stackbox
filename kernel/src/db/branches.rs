// src/db/branches.rs
//
// Persistent record of every agent branch created by Stackbox.
//
// KEY DESIGN:
//   - One row per agent session (runbox_id + session_id + agent_kind).
//   - branch (calus/{short}/{slug}) is permanent — survives worktree removal.
//   - worktree_path is nullable — set on spawn, cleared when PTY exits.
//   - status: working → done → merged | deleted
//
// Schema DDL lives in db/schema.rs::migrate().

use super::{now_ms, Db};
use rusqlite::{params, Result};

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize)]
pub struct AgentBranch {
    pub id: String,
    pub runbox_id: String,
    pub session_id: String,
    pub agent_kind: String,
    /// e.g. "stackbox/a1b2c3d4/codex"
    pub branch: String,
    /// None once PTY exits; branch still lives.
    pub worktree_path: Option<String>,
    /// working | done | merged | deleted
    pub status: String,
    pub commit_count: i64,
    pub created_at: i64,
    pub updated_at: i64,
    /// None until user merges.
    pub merged_at: Option<i64>,
}

fn row_to_branch(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentBranch> {
    Ok(AgentBranch {
        id: row.get(0)?,
        runbox_id: row.get(1)?,
        session_id: row.get(2)?,
        agent_kind: row.get(3)?,
        branch: row.get(4)?,
        worktree_path: row.get(5)?,
        status: row.get(6)?,
        commit_count: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
        merged_at: row.get(10)?,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Write — lifecycle events
// ─────────────────────────────────────────────────────────────────────────────

/// Called at PTY spawn: create the branch record with worktree_path set.
pub fn record_branch_start(
    db: &Db,
    runbox_id: &str,
    session_id: &str,
    agent_kind: &str,
    branch: &str,
    worktree_path: &str,
) -> Result<()> {
    let id = format!("{runbox_id}-{session_id}");
    let rb = runbox_id.to_string();
    let sid = session_id.to_string();
    let ak = agent_kind.to_string();
    let br = branch.to_string();
    let wt = worktree_path.to_string();
    let ts = now_ms();

    db.write_async(move |conn| {
        let _ = conn.execute(
            "INSERT INTO agent_branches
                (id, runbox_id, session_id, agent_kind, branch, worktree_path,
                 status, commit_count, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'working', 0, ?7, ?7)
             ON CONFLICT(id) DO UPDATE SET
                worktree_path = excluded.worktree_path,
                status        = 'working',
                updated_at    = excluded.updated_at",
            params![id, rb, sid, ak, br, wt, ts],
        );
    });
    Ok(())
}

/// Called when PTY exits naturally or is killed.
/// Clears worktree_path (directory removed) but keeps the branch.
pub fn record_branch_done(db: &Db, runbox_id: &str, session_id: &str) -> Result<()> {
    let id = format!("{runbox_id}-{session_id}");
    let ts = now_ms();
    db.write_async(move |conn| {
        let _ = conn.execute(
            "UPDATE agent_branches SET
                worktree_path = NULL,
                status        = CASE WHEN status = 'working' THEN 'done' ELSE status END,
                updated_at    = ?1
             WHERE id = ?2",
            params![ts, id],
        );
    });
    Ok(())
}

/// Called after user merges the branch into main.
pub fn record_branch_merged(db: &Db, branch: &str) -> Result<()> {
    let br = branch.to_string();
    let ts = now_ms();
    db.write_async(move |conn| {
        let _ = conn.execute(
            "UPDATE agent_branches SET status='merged', merged_at=?1, updated_at=?1
             WHERE branch=?2",
            params![ts, br],
        );
    });
    Ok(())
}

/// Called after user explicitly deletes a branch.
pub fn record_branch_deleted(db: &Db, branch: &str) -> Result<()> {
    let br = branch.to_string();
    let ts = now_ms();
    db.write_async(move |conn| {
        let _ = conn.execute(
            "UPDATE agent_branches SET status='deleted', updated_at=?1 WHERE branch=?2",
            params![ts, br],
        );
    });
    Ok(())
}

/// Increment the commit count for a branch (called after git_commit).
pub fn increment_commit_count(db: &Db, branch: &str) -> Result<()> {
    let br = branch.to_string();
    let ts = now_ms();
    db.write_async(move |conn| {
        let _ = conn.execute(
            "UPDATE agent_branches SET commit_count=commit_count+1, updated_at=?1 WHERE branch=?2",
            params![ts, br],
        );
    });
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Read
// ─────────────────────────────────────────────────────────────────────────────

/// All branch records for a runbox, newest first.
pub fn list_for_runbox(db: &Db, runbox_id: &str) -> Result<Vec<AgentBranch>> {
    let conn = db.read();
    let mut stmt = conn.prepare(
        "SELECT id, runbox_id, session_id, agent_kind, branch, worktree_path,
                status, commit_count, created_at, updated_at, merged_at
         FROM agent_branches WHERE runbox_id=?1
         ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map(params![runbox_id], row_to_branch)?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

/// All branches with an active worktree (worktree_path IS NOT NULL).
/// Used by cleanup to detect orphans.
pub fn list_active_worktrees(db: &Db) -> Vec<String> {
    let conn = db.read();
    let mut stmt = match conn
        .prepare("SELECT worktree_path FROM agent_branches WHERE worktree_path IS NOT NULL")
    {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map([], |row| row.get::<_, String>(0))
        .ok()
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default()
}

/// Get a single branch record by branch name.
pub fn get_by_branch(db: &Db, branch: &str) -> Option<AgentBranch> {
    db.read()
        .query_row(
            "SELECT id, runbox_id, session_id, agent_kind, branch, worktree_path,
                    status, commit_count, created_at, updated_at, merged_at
             FROM agent_branches WHERE branch=?1 ORDER BY created_at DESC LIMIT 1",
            params![branch],
            row_to_branch,
        )
        .ok()
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy compatibility — keep runbox_set_worktree working for callers not yet migrated
// ─────────────────────────────────────────────────────────────────────────────

pub use super::runboxes::{runbox_delete, runbox_set_branch};
