// src-tauri/src/db/mod.rs

pub mod events;
pub mod layout;
pub mod runboxes;
pub mod schema;
pub mod sessions;

use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

// ── Public handle ─────────────────────────────────────────────────────────────
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
    /// Blocks until the writer thread has executed the closure.
    pub fn write_sync<F, T>(&self, f: F) -> rusqlite::Result<T>
    where
        F: FnOnce(&Connection) -> rusqlite::Result<T> + Send + 'static,
        T: Send + 'static,
    {
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let task: Box<dyn FnOnce(&Connection) + Send> = Box::new(move |conn| {
            let _ = tx.send(f(conn));
        });
        self.writer.send(task).map_err(|e| rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error { code: rusqlite::ffi::ErrorCode::InternalMalfunction, extended_code: 0 },
            Some(e.to_string()),
        ))?;
        rx.recv().map_err(|e| rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error { code: rusqlite::ffi::ErrorCode::InternalMalfunction, extended_code: 0 },
            Some(e.to_string()),
        ))?
    }

    /// Fire-and-forget write. Does not wait for execution.
    pub fn write_async(&self, f: impl FnOnce(&Connection) + Send + 'static) {
        let task: Box<dyn FnOnce(&Connection) + Send> = Box::new(f);
        let _ = self.writer.send(task);
    }
}

// ── Row types (shared across submodules) ─────────────────────────────────────
use serde::{Deserialize, Serialize};

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

/// Workspace event row — the core primitive of the system.
/// Append-only. Never update rows.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspaceEvent {
    pub id:           String,
    pub runbox_id:    String,
    pub session_id:   String,
    pub event_type:   String,   // AgentSpawned | CommandExecuted | CommandResult | FileChanged | WorkspaceSnapshot
    pub source:       String,   // "pty" | "watcher" | "git" | "user"
    pub payload_json: String,   // flat JSON, no nesting
    pub timestamp:    i64,
}

// ── Open ──────────────────────────────────────────────────────────────────────
pub fn db_path() -> PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("stackbox").join("stackbox.db")
}

pub fn open() -> rusqlite::Result<Db> {
    let path = db_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }

    let writer_conn = Connection::open(&path)?;
    writer_conn.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;",
    )?;
    schema::migrate(&writer_conn)?;

    let reader_conn = Connection::open(&path)?;
    reader_conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA query_only=ON;")?;

    let (tx, rx) = std::sync::mpsc::sync_channel::<Box<dyn FnOnce(&Connection) + Send>>(4096);
    std::thread::Builder::new()
        .name("stackbox-db-writer".into())
        .spawn(move || {
            while let Ok(f) = rx.recv() { f(&writer_conn); }
        })
        .expect("failed to spawn db writer thread");

    Ok(Arc::new(DbInner { reader: Mutex::new(reader_conn), writer: tx }))
}

// ── Shared time helper ────────────────────────────────────────────────────────
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
