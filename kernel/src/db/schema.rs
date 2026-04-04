// src-tauri/src/db/schema.rs
//
// All DDL lives here. Single source of truth for the database schema.
// Migrations are additive — never drop columns on existing installs.
//
// MIGRATION ORDER RULE: always run ALTER TABLE column additions BEFORE any
// CREATE INDEX that references those columns. SQLite's CREATE TABLE IF NOT
// EXISTS is a no-op on existing databases, so the index would reference a
// non-existent column and panic at startup.

use rusqlite::{Connection, Result};

pub fn migrate(conn: &Connection) -> Result<()> {
    // ── Core tables ───────────────────────────────────────────────────────────
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS runboxes (
            id             TEXT PRIMARY KEY,
            name           TEXT NOT NULL,
            cwd            TEXT NOT NULL,
            branch         TEXT,
            worktree_path  TEXT,
            created_at     INTEGER NOT NULL,
            updated_at     INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sessions (
            id         TEXT PRIMARY KEY,
            runbox_id  TEXT NOT NULL REFERENCES runboxes(id) ON DELETE CASCADE,
            pane_id    TEXT NOT NULL DEFAULT '',
            agent      TEXT NOT NULL DEFAULT 'shell',
            cwd        TEXT NOT NULL,
            started_at INTEGER NOT NULL,
            ended_at   INTEGER,
            exit_code  INTEGER,
            log_path   TEXT
        );

        CREATE TABLE IF NOT EXISTS pane_layouts (
            runbox_id   TEXT PRIMARY KEY REFERENCES runboxes(id) ON DELETE CASCADE,
            layout_json TEXT NOT NULL,
            active_pane TEXT NOT NULL DEFAULT '',
            updated_at  INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_runbox ON sessions(runbox_id);
    ")?;

    // Additive migrations — safe on existing databases
    conn.execute("ALTER TABLE runboxes ADD COLUMN worktree_path TEXT", []).ok();

    // ── Per-agent worktree table (V2 schema) ─────────────────────────────────
    //
    // PRIMARY KEY = runbox_id (one row per runbox, not per agent-kind).
    // Tracks worktree path, branch, PR url, and lifecycle status.
    //
    // CRITICAL: all ALTER TABLE column additions for this table MUST come
    // before the CREATE INDEX on pr_url. On existing installs the CREATE TABLE
    // is a no-op, so the index would reference a missing column and crash.
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS agent_worktrees (
            runbox_id      TEXT PRIMARY KEY,
            agent_kind     TEXT NOT NULL DEFAULT '',
            worktree_path  TEXT,
            branch         TEXT,
            pr_url         TEXT,
            status         TEXT NOT NULL DEFAULT 'working',
            created_at     INTEGER NOT NULL DEFAULT 0,
            updated_at     INTEGER NOT NULL DEFAULT 0
        );
    ")?;

    // Additive column migrations — run BEFORE any index that touches these columns.
    // Each uses .ok() so they silently no-op on new installs (column already exists).
    conn.execute("ALTER TABLE agent_worktrees ADD COLUMN agent_kind TEXT NOT NULL DEFAULT ''", []).ok();
    conn.execute("ALTER TABLE agent_worktrees ADD COLUMN branch TEXT", []).ok();
    conn.execute("ALTER TABLE agent_worktrees ADD COLUMN pr_url TEXT", []).ok();
    conn.execute("ALTER TABLE agent_worktrees ADD COLUMN status TEXT NOT NULL DEFAULT 'working'", []).ok();
    conn.execute("ALTER TABLE agent_worktrees ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0", []).ok();
    conn.execute("ALTER TABLE agent_worktrees ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0", []).ok();

    // NOW safe to create the index — pr_url is guaranteed to exist.
    conn.execute_batch("
        CREATE INDEX IF NOT EXISTS idx_awt_pr_url ON agent_worktrees(pr_url);
    ")?;

    // ── Workspace events — the core append-only event log ─────────────────────
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS workspace_events (
            id           TEXT PRIMARY KEY,
            runbox_id    TEXT NOT NULL,
            session_id   TEXT NOT NULL DEFAULT '',
            event_type   TEXT NOT NULL,
            source       TEXT NOT NULL DEFAULT 'system',
            payload_json TEXT NOT NULL DEFAULT '{}',
            timestamp    INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_wevents_runbox    ON workspace_events(runbox_id);
        CREATE INDEX IF NOT EXISTS idx_wevents_runbox_ts ON workspace_events(runbox_id, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_wevents_type      ON workspace_events(runbox_id, event_type);
    ")?;

    // FTS5 over payload_json for agent context search
    let fts_exists: bool = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='workspace_events_fts'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;

    if !fts_exists {
        conn.execute_batch("
            CREATE VIRTUAL TABLE workspace_events_fts USING fts5(
                payload_json,
                content='workspace_events',
                content_rowid='rowid',
                tokenize='porter ascii'
            );

            CREATE TRIGGER wevents_ai AFTER INSERT ON workspace_events BEGIN
                INSERT INTO workspace_events_fts(rowid, payload_json)
                VALUES (new.rowid, new.payload_json);
            END;

            CREATE TRIGGER wevents_ad AFTER DELETE ON workspace_events BEGIN
                INSERT INTO workspace_events_fts(workspace_events_fts, rowid, payload_json)
                VALUES ('delete', old.rowid, old.payload_json);
            END;
        ")?;
    }

    // ── Legacy session_events — kept for backwards compat, no new writes ──────
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS session_events (
            id         TEXT PRIMARY KEY,
            runbox_id  TEXT NOT NULL,
            session_id TEXT NOT NULL DEFAULT '',
            event_type TEXT NOT NULL,
            summary    TEXT NOT NULL,
            detail     TEXT,
            timestamp  INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_events_runbox    ON session_events(runbox_id);
        CREATE INDEX IF NOT EXISTS idx_events_runbox_ts ON session_events(runbox_id, timestamp DESC);
    ")?;

    Ok(())
}