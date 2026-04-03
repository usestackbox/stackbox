// src/db/runboxes.rs
//
// Runbox persistence — branches, worktrees, PR tracking, lifecycle status.
//
// Worktree key = runbox_id (unique per terminal session).
// agent_kind is stored as metadata for display — NOT part of the lookup key.
// This means 3 Claude instances → 3 rows → 3 worktrees, no collision.

use rusqlite::{params, Result};
use super::{Db, now_ms};

// ─────────────────────────────────────────────────────────────────────────────
// Schema migration — safe to run on every startup (additive only)
// ─────────────────────────────────────────────────────────────────────────────

/// Run on startup from db::open(). Creates/updates the agent_worktrees table.
pub fn migrate(conn: &rusqlite::Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS agent_worktrees (
            runbox_id      TEXT PRIMARY KEY,
            agent_kind     TEXT NOT NULL DEFAULT '',
            worktree_path  TEXT,
            branch         TEXT,
            pr_url         TEXT,
            status         TEXT NOT NULL DEFAULT 'working',
            created_at     INTEGER NOT NULL DEFAULT 0,
            updated_at     INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_awt_pr_url ON agent_worktrees(pr_url);
        ",
    )
}

/// Older schema string kept for fire-and-forget CREATE IF NOT EXISTS calls
/// inside write closures where we can't pass a connection reference directly.
const CREATE_TABLE: &str = "
    CREATE TABLE IF NOT EXISTS agent_worktrees (
        runbox_id      TEXT PRIMARY KEY,
        agent_kind     TEXT    NOT NULL DEFAULT '',
        worktree_path  TEXT,
        branch         TEXT,
        pr_url         TEXT,
        status         TEXT    NOT NULL DEFAULT 'working',
        created_at     INTEGER NOT NULL DEFAULT 0,
        updated_at     INTEGER NOT NULL DEFAULT 0
    )
";

// ─────────────────────────────────────────────────────────────────────────────
// Branch helper (used by git commands to persist branch name on runboxes table)
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

/// Persist (or update) the worktree record for a runbox.
/// Called after git_ensure / git_worktree_create.
/// Safe to call multiple times — uses INSERT OR REPLACE via ON CONFLICT.
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
        let _ = conn.execute(CREATE_TABLE, []);
        let _ = conn.execute(
            "INSERT INTO agent_worktrees
                (runbox_id, agent_kind, worktree_path, branch, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'working', ?5, ?5)
             ON CONFLICT(runbox_id) DO UPDATE SET
                agent_kind    = excluded.agent_kind,
                worktree_path = excluded.worktree_path,
                branch        = excluded.branch,
                status        = 'working',
                updated_at    = excluded.updated_at",
            params![id, agent_kind, worktree_path, branch, ts],
        );
    });
    Ok(())
}

/// Save PR url after agent opens a PR.
/// Also sets status to 'pr_open'.
pub fn runbox_set_pr(db: &Db, runbox_id: &str, pr_url: &str) -> Result<()> {
    let id     = runbox_id.to_string();
    let pr_url = pr_url.to_string();
    let ts     = now_ms();
    db.write_async(move |conn| {
        let _ = conn.execute(CREATE_TABLE, []);
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
        let _ = conn.execute(CREATE_TABLE, []);
        let _ = conn.execute(
            "UPDATE agent_worktrees SET status=?1, updated_at=?2 WHERE runbox_id=?3",
            params![status, ts, id],
        );
    });
    Ok(())
}

/// Delete the worktree record — called after the physical worktree is removed.
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

/// Delete all records for a runbox (worktree + session rows).
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

/// Get the worktree path string for a runbox (fast path).
pub fn runbox_get_worktree(db: &Db, runbox_id: &str) -> Option<String> {
    db.read()
        .query_row(
            "SELECT worktree_path FROM agent_worktrees WHERE runbox_id=?1",
            params![runbox_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten()
}

/// Get the full worktree record for a runbox.
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

// ─────────────────────────────────────────────────────────────────────────────
// Read — by PR url (webhook routing)
// ─────────────────────────────────────────────────────────────────────────────

/// Look up a runbox by its PR url.
/// Used by the webhook handler to route PR review comments to the right agent.
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

// ─────────────────────────────────────────────────────────────────────────────
// Read — by workspace
// ─────────────────────────────────────────────────────────────────────────────

/// Get all active worktree records for a workspace.
/// Matches on the parent directory prefix so worktrees that live next to the
/// workspace folder are included.
pub fn workspace_get_worktrees(db: &Db, cwd: &str) -> Vec<WorktreeRecord> {
    let parent = std::path::Path::new(cwd)
        .parent()
        .and_then(|p| p.to_str())
        .unwrap_or("")
        .to_string();

    let conn = db.read();
    let mut stmt = match conn.prepare(
        "SELECT runbox_id, agent_kind, worktree_path, branch, pr_url, status,
                created_at, updated_at
         FROM agent_worktrees
         WHERE worktree_path LIKE ?1
         ORDER BY rowid DESC",
    ) {
        Ok(s)  => s,
        Err(_) => return vec![],
    };

    let prefix = format!("{parent}/stackbox-wt-%");
    stmt.query_map(params![prefix], row_to_record)
        .ok()
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
}

/// Alias used by the new commands/db.rs additions.
#[inline]
pub fn workspace_list_worktrees(db: &Db, workspace_cwd: &str) -> Vec<WorktreeRecord> {
    workspace_get_worktrees(db, workspace_cwd)
}