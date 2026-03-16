// src-tauri/src/db.rs
// rusqlite — runboxes, sessions, pane_layouts, session_events (FTS5), bus_messages

use rusqlite::{Connection, Result, params};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

// ── Public handle ─────────────────────────────────────────────────────────
pub struct DbInner {
    pub reader: Mutex<Connection>,
    pub writer: std::sync::mpsc::SyncSender<Box<dyn FnOnce(&Connection) + Send>>,
}
pub type Db = Arc<DbInner>;

impl DbInner {
    /// Acquire the reader connection for SELECT queries.
    /// Never hold across an await point.
    pub fn read(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.reader.lock().unwrap()
    }

    /// Execute a write closure synchronously on the writer thread.
    /// Blocks until the writer thread has executed the closure and sent back the result.
    /// Use this for write operations that need to return data (e.g. last_insert_rowid).
    pub fn write_sync<F, T>(&self, f: F) -> rusqlite::Result<T>
    where
        F: FnOnce(&Connection) -> rusqlite::Result<T> + Send + 'static,
        T: Send + 'static,
    {
        let (result_tx, result_rx) = std::sync::mpsc::sync_channel(1);
        let task: Box<dyn FnOnce(&Connection) + Send> = Box::new(move |conn| {
            let _ = result_tx.send(f(conn));
        });
        self.writer.send(task).map_err(|e| rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error { code: rusqlite::ffi::ErrorCode::InternalMalfunction, extended_code: 0 },
            Some(e.to_string()),
        ))?;
        result_rx.recv().map_err(|e| rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error { code: rusqlite::ffi::ErrorCode::InternalMalfunction, extended_code: 0 },
            Some(e.to_string()),
        ))?
    }

    /// Fire-and-forget write. Does not wait for execution.
    /// Use for writes where you don't need the result (most bus/session writes).
    pub fn write_async(&self, f: impl FnOnce(&Connection) + Send + 'static) {
        let task: Box<dyn FnOnce(&Connection) + Send> = Box::new(f);
        let _ = self.writer.send(task); // silently drop if channel is full (should never happen)
    }
}



// ── Row types ─────────────────────────────────────────────────────────────


#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Session {
    pub id:         String,
    pub runbox_id:  String,
    pub pane_id:    String,
    pub agent:      String,
    pub cwd:        String,
    pub started_at: i64,
    pub ended_at:   Option<i64>,
    pub exit_code:  Option<i32>,
    pub log_path:   Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PaneLayout {
    pub runbox_id:   String,
    pub layout_json: String,
    pub active_pane: String,
    pub updated_at:  i64,
}

/// A structured event capturing agent activity — powers FTS5 BM25 search.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SessionEvent {
    pub id:         String,
    pub runbox_id:  String,
    pub session_id: String,
    /// "session_start" | "session_end" | "memory" | "file_change" | "git"
    pub event_type: String,
    /// Short human-readable summary — indexed by FTS5
    pub summary:    String,
    /// Optional full content (long diff text, raw output, etc.)
    pub detail:     Option<String>,
    pub timestamp:  i64,
}

/// Persisted bus message — written on every publish for late-join catchup.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BusMessageRow {
    pub id:             String,
    pub runbox_id:      String,
    pub from_agent:     String,
    pub topic:          String,
    pub payload:        String,
    pub timestamp:      i64,
    pub correlation_id: Option<String>,
}

// ── Init ──────────────────────────────────────────────────────────────────

pub fn db_path() -> PathBuf {
    let base = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("stackbox").join("stackbox.db")
}

pub fn open() -> Result<Db> {
    let path = db_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let writer_conn = Connection::open(&path)?;
    writer_conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;")?;
    migrate(&writer_conn)?;
    let reader_conn = Connection::open(&path)?;
    reader_conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA query_only=ON;")?;
    let (tx, rx) = std::sync::mpsc::sync_channel::<Box<dyn FnOnce(&Connection) + Send>>(4096);
    std::thread::Builder::new()
        .name("stackbox-db-writer".into())
        .spawn(move || { while let Ok(f) = rx.recv() { f(&writer_conn); } })
        .expect("failed to spawn db writer thread");
    Ok(Arc::new(DbInner { reader: Mutex::new(reader_conn), writer: tx }))
}

// ── Helpers for writer-thread dispatch ───────────────────────────────────────
//
// db_write(db, |conn| { ... }) — runs a closure on the writer thread, blocking
// until the writer thread accepts it (not until it executes). Errors from the
// send are converted to rusqlite::Error via a string.
//
// db_read(db) — locks the reader connection. Returns MutexGuard<Connection>.
// Always short-lived; never hold across await points.
//

fn migrate(conn: &Connection) -> Result<()> {
    // ── Core tables ───────────────────────────────────────────────────────
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

    // Additive migrations — safe to run on existing databases
    conn.execute(
        "ALTER TABLE runboxes ADD COLUMN worktree_path TEXT",
        [],
    ).ok(); // Silently ignore "duplicate column" errors on re-run

    // ── Session events — powers BM25 retrieval ────────────────────────────
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

    // FTS5 virtual table — BM25 ranked search over summary + detail
    // Must be separate from the CREATE TABLE above because SQLite's execute_batch
    // stops on certain DDL errors if the virtual table already exists, so we guard
    // the creation in Rust instead.
    let fts_exists: bool = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='session_events_fts'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;

    if !fts_exists {
        conn.execute_batch("
            CREATE VIRTUAL TABLE session_events_fts USING fts5(
                summary,
                detail,
                content='session_events',
                content_rowid='rowid',
                tokenize='porter ascii'
            );

            -- Keep FTS index in sync automatically
            CREATE TRIGGER events_ai AFTER INSERT ON session_events BEGIN
                INSERT INTO session_events_fts(rowid, summary, detail)
                VALUES (new.rowid, new.summary, new.detail);
            END;

            CREATE TRIGGER events_ad AFTER DELETE ON session_events BEGIN
                INSERT INTO session_events_fts(session_events_fts, rowid, summary, detail)
                VALUES ('delete', old.rowid, old.summary, old.detail);
            END;
        ")?;
    }

    // ── Bus messages — persisted pub/sub history for late-join catchup ────
    //
    // Every message published to the Agent Bus is written here. Agents that
    // join a RunBox late can query this table to catch up on what happened.
    //
    // Indexed on (runbox_id, timestamp DESC) so catchup queries are fast.
    // Optionally filter by topic for targeted catchup (e.g. only "task.done").
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS bus_messages (
            id             TEXT PRIMARY KEY,
            runbox_id      TEXT NOT NULL,
            from_agent     TEXT NOT NULL,
            topic          TEXT NOT NULL,
            payload        TEXT NOT NULL,
            timestamp      INTEGER NOT NULL,
            correlation_id TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_bus_runbox_ts    ON bus_messages(runbox_id, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_bus_runbox_topic ON bus_messages(runbox_id, topic);
    ")?;

    Ok(())
}

// ── Helpers ───────────────────────────────────────────────────────────────

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}




pub fn runbox_set_branch(db: &Db, id: &str, branch: Option<&str>) -> Result<()> {
    let conn = db.read();
    conn.execute(
        "UPDATE runboxes SET branch=?1, updated_at=?2 WHERE id=?3",
        params![branch, now_ms(), id],
    )?;
    Ok(())
}

pub fn runbox_set_worktree(db: &Db, id: &str, worktree_path: Option<&str>) -> Result<()> {
    let conn = db.read();
    conn.execute(
        "UPDATE runboxes SET worktree_path=?1, updated_at=?2 WHERE id=?3",
        params![worktree_path, now_ms(), id],
    )?;
    Ok(())
}

pub fn runbox_delete(db: &Db, id: &str) -> Result<()> {
    let conn = db.read();
    conn.execute("DELETE FROM runboxes WHERE id=?1", params![id])?;
    Ok(())
}

// ── Session CRUD ──────────────────────────────────────────────────────────

pub fn session_start(db: &Db, id: &str, runbox_id: &str, pane_id: &str, agent: &str, cwd: &str) -> Result<()> {
    let (id, runbox_id, pane_id, agent, cwd) = (id.to_string(), runbox_id.to_string(), pane_id.to_string(), agent.to_string(), cwd.to_string());
    let ts = now_ms();
    db.write_async(move |conn| {
        let _ = conn.execute(
            "INSERT OR REPLACE INTO sessions (id, runbox_id, pane_id, agent, cwd, started_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, runbox_id, pane_id, agent, cwd, ts],
        );
    });
    Ok(())
}

pub fn session_end(db: &Db, id: &str, exit_code: Option<i32>, log_path: Option<&str>) -> Result<()> {
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
         FROM sessions WHERE runbox_id=?1 ORDER BY started_at DESC"
    )?;
    let rows = stmt.query_map(params![runbox_id], |r| Ok(Session {
        id:         r.get(0)?,
        runbox_id:  r.get(1)?,
        pane_id:    r.get(2)?,
        agent:      r.get(3)?,
        cwd:        r.get(4)?,
        started_at: r.get(5)?,
        ended_at:   r.get(6)?,
        exit_code:  r.get(7)?,
        log_path:   r.get(8)?,
    }))?;
    rows.collect()
}

// ── Pane layout ───────────────────────────────────────────────────────────

pub fn layout_save(db: &Db, runbox_id: &str, layout_json: &str, active_pane: &str) -> Result<()> {
    let conn = db.read();
    conn.execute(
        "INSERT INTO pane_layouts (runbox_id, layout_json, active_pane, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(runbox_id) DO UPDATE SET
           layout_json=excluded.layout_json,
           active_pane=excluded.active_pane,
           updated_at=excluded.updated_at",
        params![runbox_id, layout_json, active_pane, now_ms()],
    )?;
    Ok(())
}

pub fn layout_get(db: &Db, runbox_id: &str) -> Result<Option<PaneLayout>> {
    let conn = db.read();
    let mut stmt = conn.prepare(
        "SELECT runbox_id, layout_json, active_pane, updated_at
         FROM pane_layouts WHERE runbox_id=?1"
    )?;
    let mut rows = stmt.query_map(params![runbox_id], |r| Ok(PaneLayout {
        runbox_id:   r.get(0)?,
        layout_json: r.get(1)?,
        active_pane: r.get(2)?,
        updated_at:  r.get(3)?,
    }))?;
    Ok(rows.next().transpose()?)
}

// ── Session events CRUD ───────────────────────────────────────────────────

/// Insert one event and update the FTS5 index automatically via trigger.
pub fn event_insert(
    db:         &Db,
    runbox_id:  &str,
    session_id: &str,
    event_type: &str,
    summary:    &str,
    detail:     Option<&str>,
) -> Result<()> {
    let id         = uuid::Uuid::new_v4().to_string();
    let runbox_id  = runbox_id.to_string();
    let session_id = session_id.to_string();
    let event_type = event_type.to_string();
    let summary    = summary.to_string();
    let detail     = detail.map(str::to_string);
    let ts         = now_ms();
    db.write_async(move |conn| {
        let _ = conn.execute(
            "INSERT INTO session_events (id, runbox_id, session_id, event_type, summary, detail, timestamp)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, runbox_id, session_id, event_type, summary, detail, ts],
        );
    });
    Ok(())
}

/// BM25 full-text search over events for a runbox.
/// Falls back to `events_recent` when the query is empty or produces no hits.
pub fn events_search(db: &Db, runbox_id: &str, query: &str, limit: usize) -> Result<Vec<SessionEvent>> {
    if query.trim().is_empty() {
        return events_recent(db, runbox_id, limit);
    }

    // Sanitise the FTS5 query: strip special chars that would cause parse errors
    let safe_query = query
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace() || matches!(c, '-' | '/' | '.' | '_'))
        .collect::<String>();

    if safe_query.trim().is_empty() {
        return events_recent(db, runbox_id, limit);
    }

    // Scope conn + stmt so they drop before the fallback call below.
    let results: Vec<SessionEvent> = {
        let conn = db.read();
        let mut stmt = conn.prepare(
            "SELECT e.id, e.runbox_id, e.session_id, e.event_type, e.summary, e.detail, e.timestamp
             FROM session_events e
             JOIN session_events_fts fts ON e.rowid = fts.rowid
             WHERE e.runbox_id = ?1
               AND session_events_fts MATCH ?2
             ORDER BY bm25(session_events_fts)
             LIMIT ?3"
        )?;
        let rows = stmt.query_map(
            params![runbox_id, safe_query, limit as i64],
            event_from_row,
        )?;
        rows.filter_map(|r| r.ok()).collect()
    }; // conn and stmt drop here, releasing the mutex lock

    // If BM25 returned nothing (rare with porter tokeniser), fall back to recents
    if results.is_empty() {
        return events_recent(db, runbox_id, limit);
    }

    Ok(results)
}

/// Most-recent N events for a runbox — used as fallback when FTS has no query.
pub fn events_recent(db: &Db, runbox_id: &str, limit: usize) -> Result<Vec<SessionEvent>> {
    let conn = db.read();
    let mut stmt = conn.prepare(
        "SELECT id, runbox_id, session_id, event_type, summary, detail, timestamp
         FROM session_events
         WHERE runbox_id = ?1
         ORDER BY timestamp DESC
         LIMIT ?2"
    )?;
    let rows = stmt.query_map(params![runbox_id, limit as i64], event_from_row)?;
    rows.collect()
}

/// All events for a session (used for session-end summaries).
pub fn events_for_session(db: &Db, session_id: &str, limit: usize) -> Result<Vec<SessionEvent>> {
    let conn = db.read();
    let mut stmt = conn.prepare(
        "SELECT id, runbox_id, session_id, event_type, summary, detail, timestamp
         FROM session_events
         WHERE session_id = ?1
         ORDER BY timestamp DESC
         LIMIT ?2"
    )?;
    let rows = stmt.query_map(params![session_id, limit as i64], event_from_row)?;
    rows.collect()
}

fn event_from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<SessionEvent> {
    Ok(SessionEvent {
        id:         r.get(0)?,
        runbox_id:  r.get(1)?,
        session_id: r.get(2)?,
        event_type: r.get(3)?,
        summary:    r.get(4)?,
        detail:     r.get(5)?,
        timestamp:  r.get(6)?,
    })
}

// ── Bus messages CRUD ─────────────────────────────────────────────────────

/// Persist a bus message for late-join catchup.
/// Called on every successful publish — cheap (single INSERT, WAL mode).
pub fn bus_message_insert(db: &Db, msg: &crate::bus::BusMessage, runbox_id: &str) -> Result<()> {
    let id             = msg.id.clone();
    let runbox_id_s    = runbox_id.to_string();
    let from_agent     = msg.from.clone();
    let topic          = msg.topic.clone();
    let payload        = msg.payload.clone();
    let timestamp      = msg.timestamp as i64;
    let correlation_id = msg.correlation_id.clone();
    db.write_async(move |conn| {
        let _ = conn.execute(
            "INSERT OR IGNORE INTO bus_messages
                 (id, runbox_id, from_agent, topic, payload, timestamp, correlation_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, runbox_id_s, from_agent, topic, payload, timestamp, correlation_id],
        );
    });
    Ok(())
}

/// Fetch recent bus messages for a RunBox, optionally filtered by topic.
/// Used by joining agents to catch up on what they missed.
///
/// Returns messages in descending timestamp order (newest first).
pub fn bus_messages_for_runbox(
    db:           &Db,
    runbox_id:    &str,
    limit:        usize,
    topic_filter: Option<&str>,
) -> Result<Vec<BusMessageRow>> {
    let conn = db.read();

    if let Some(topic) = topic_filter {
        let mut stmt = conn.prepare(
            "SELECT id, runbox_id, from_agent, topic, payload, timestamp, correlation_id
             FROM bus_messages
             WHERE runbox_id = ?1 AND topic = ?2
             ORDER BY timestamp DESC
             LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![runbox_id, topic, limit as i64], bus_msg_from_row)?;
        rows.collect()
    } else {
        let mut stmt = conn.prepare(
            "SELECT id, runbox_id, from_agent, topic, payload, timestamp, correlation_id
             FROM bus_messages
             WHERE runbox_id = ?1
             ORDER BY timestamp DESC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![runbox_id, limit as i64], bus_msg_from_row)?;
        rows.collect()
    }
}

/// Prune old bus messages — keep only the most recent `keep` messages per runbox.
/// Call this periodically or on runbox delete to prevent unbounded growth.
pub fn bus_messages_prune(db: &Db, runbox_id: &str, keep: usize) {
    let runbox_id = runbox_id.to_string();
    let keep = keep as i64;
    db.write_async(move |conn| {
        let _ = conn.execute(
            "DELETE FROM bus_messages WHERE runbox_id = ?1
             AND id NOT IN (
                 SELECT id FROM bus_messages WHERE runbox_id = ?1
                 ORDER BY timestamp DESC LIMIT ?2
             )",
            params![runbox_id, keep],
        );
    });
}

/// Delete all bus messages for a runbox (on runbox delete).
pub fn bus_messages_delete_for_runbox(db: &Db, runbox_id: &str) {
    let runbox_id = runbox_id.to_string();
    db.write_async(move |conn| {
        let _ = conn.execute("DELETE FROM bus_messages WHERE runbox_id = ?1", params![runbox_id]);
    });
}

/// Fetch bus messages since a given timestamp (inclusive).
/// Useful for clients that reconnect and want to replay missed messages.
pub fn bus_messages_since(
    db:        &Db,
    runbox_id: &str,
    since_ms:  i64,
    limit:     usize,
) -> Result<Vec<BusMessageRow>> {
    let conn = db.read();
    let mut stmt = conn.prepare(
        "SELECT id, runbox_id, from_agent, topic, payload, timestamp, correlation_id
         FROM bus_messages
         WHERE runbox_id = ?1 AND timestamp >= ?2
         ORDER BY timestamp ASC
         LIMIT ?3",
    )?;
    let rows = stmt.query_map(params![runbox_id, since_ms, limit as i64], bus_msg_from_row)?;
    rows.collect()
}

fn bus_msg_from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<BusMessageRow> {
    Ok(BusMessageRow {
        id:             r.get(0)?,
        runbox_id:      r.get(1)?,
        from_agent:     r.get(2)?,
        topic:          r.get(3)?,
        payload:        r.get(4)?,
        timestamp:      r.get(5)?,
        correlation_id: r.get(6)?,
    })
}