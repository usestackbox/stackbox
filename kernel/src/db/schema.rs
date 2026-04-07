// src-tauri/src/db/schema.rs
//
// All DDL lives here. Single source of truth for the database schema.
// Migrations are additive — never drop columns on existing installs.
//
// MIGRATION ORDER RULE: always run ALTER TABLE column additions BEFORE any
// CREATE INDEX that references those columns.

use rusqlite::{Connection, Result};

pub fn migrate(conn: &Connection) -> Result<()> {
    // ── Core tables ───────────────────────────────────────────────────────────
    conn.execute_batch(
        "
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
    ",
    )?;

    // Additive migrations — safe on existing databases
    conn.execute("ALTER TABLE runboxes ADD COLUMN worktree_path TEXT", [])
        .ok();

    // ── Legacy agent_worktrees table — kept for backwards compat reads ─────────
    // New writes go to agent_branches. This table is not dropped to avoid
    // breaking existing installs that might still have data in it.
    conn.execute_batch(
        "
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
    ",
    )?;

    conn.execute(
        "ALTER TABLE agent_worktrees ADD COLUMN agent_kind TEXT NOT NULL DEFAULT ''",
        [],
    )
    .ok();
    conn.execute("ALTER TABLE agent_worktrees ADD COLUMN branch TEXT", [])
        .ok();
    conn.execute("ALTER TABLE agent_worktrees ADD COLUMN pr_url TEXT", [])
        .ok();
    conn.execute(
        "ALTER TABLE agent_worktrees ADD COLUMN status TEXT NOT NULL DEFAULT 'working'",
        [],
    )
    .ok();
    conn.execute(
        "ALTER TABLE agent_worktrees ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0",
        [],
    )
    .ok();
    conn.execute(
        "ALTER TABLE agent_worktrees ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0",
        [],
    )
    .ok();

    conn.execute_batch(
        "
        CREATE INDEX IF NOT EXISTS idx_awt_pr_url ON agent_worktrees(pr_url);
    ",
    )?;

    // ── Agent branches — the new persistent branch tracking table ─────────────
    //
    // Separates worktree lifetime (temporary) from branch lifetime (permanent).
    //
    // id = "{runbox_id}-{session_id}" — unique per session, not per runbox.
    // branch = "stackbox/{runbox_short}/{slug}" — survives worktree removal.
    // worktree_path = NULL once PTY exits.
    // status: working → done → merged | deleted
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS agent_branches (
            id            TEXT PRIMARY KEY,
            runbox_id     TEXT NOT NULL,
            session_id    TEXT NOT NULL,
            agent_kind    TEXT NOT NULL DEFAULT '',
            branch        TEXT NOT NULL,
            worktree_path TEXT,
            status        TEXT NOT NULL DEFAULT 'working',
            commit_count  INTEGER NOT NULL DEFAULT 0,
            created_at    INTEGER NOT NULL DEFAULT 0,
            updated_at    INTEGER NOT NULL DEFAULT 0,
            merged_at     INTEGER
        );
    ",
    )?;

    // Additive column migrations for agent_branches (safe on existing installs)
    conn.execute(
        "ALTER TABLE agent_branches ADD COLUMN session_id TEXT NOT NULL DEFAULT ''",
        [],
    )
    .ok();
    conn.execute(
        "ALTER TABLE agent_branches ADD COLUMN agent_kind TEXT NOT NULL DEFAULT ''",
        [],
    )
    .ok();
    conn.execute(
        "ALTER TABLE agent_branches ADD COLUMN branch TEXT NOT NULL DEFAULT ''",
        [],
    )
    .ok();
    conn.execute(
        "ALTER TABLE agent_branches ADD COLUMN worktree_path TEXT",
        [],
    )
    .ok();
    conn.execute(
        "ALTER TABLE agent_branches ADD COLUMN status TEXT NOT NULL DEFAULT 'working'",
        [],
    )
    .ok();
    conn.execute(
        "ALTER TABLE agent_branches ADD COLUMN commit_count INTEGER NOT NULL DEFAULT 0",
        [],
    )
    .ok();
    conn.execute(
        "ALTER TABLE agent_branches ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0",
        [],
    )
    .ok();
    conn.execute(
        "ALTER TABLE agent_branches ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0",
        [],
    )
    .ok();
    conn.execute(
        "ALTER TABLE agent_branches ADD COLUMN merged_at INTEGER",
        [],
    )
    .ok();

    conn.execute_batch(
        "
        CREATE INDEX IF NOT EXISTS idx_ab_runbox  ON agent_branches(runbox_id);
        CREATE INDEX IF NOT EXISTS idx_ab_session ON agent_branches(session_id);
        CREATE INDEX IF NOT EXISTS idx_ab_status  ON agent_branches(status);
        CREATE INDEX IF NOT EXISTS idx_ab_branch  ON agent_branches(branch);
    ",
    )?;

    // Migrate existing agent_worktrees data into agent_branches (one-time, idempotent)
    conn.execute(
        "INSERT OR IGNORE INTO agent_branches
            (id, runbox_id, session_id, agent_kind, branch, worktree_path,
             status, created_at, updated_at)
         SELECT
            runbox_id,
            runbox_id,
            runbox_id,
            agent_kind,
            COALESCE(branch, 'stackbox/migrated'),
            NULL,
            CASE status WHEN 'merged' THEN 'merged' ELSE 'done' END,
            created_at,
            updated_at
         FROM agent_worktrees
         WHERE branch IS NOT NULL",
        [],
    )
    .ok();

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
    let fts_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='workspace_events_fts'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
        > 0;

    if !fts_exists {
        conn.execute_batch(
            "
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
        ",
        )?;
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
