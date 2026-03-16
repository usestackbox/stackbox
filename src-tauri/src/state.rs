// src-tauri/src/state.rs
//
// Shared application state passed into every Tauri command.
// No bus. No message passing. Just workspace state.

use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::sync::{Arc, Mutex};

use crate::{agent::kind::AgentKind, db::Db};

// ── PtySession ────────────────────────────────────────────────────────────────
pub struct PtySession {
    pub writer:         Box<dyn Write + Send>,
    pub _master:        Box<dyn portable_pty::MasterPty + Send>,
    pub _child:         Box<dyn portable_pty::Child + Send + Sync>,
    pub input_buf:      String,
    pub runbox_id:      String,
    pub cwd:            String,
    pub headless:       bool,
    pub parent_session: Option<String>,
    pub agent_kind:     AgentKind,
    pub worktree_path:  Option<String>,
}

// ── Type aliases ──────────────────────────────────────────────────────────────
pub type SessionMap  = Arc<Mutex<HashMap<String, PtySession>>>;
pub type WatcherMap  = Arc<Mutex<HashMap<String, notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>>>>;
pub type DebounceMap = Arc<Mutex<HashMap<String, u64>>>;

// ── AppState ──────────────────────────────────────────────────────────────────
pub struct AppState {
    pub sessions:          SessionMap,
    pub db:                Db,
    pub watchers:          WatcherMap,
    /// Prevents duplicate file watchers when multiple agents share a runbox.
    pub watched_runboxes:  Arc<Mutex<HashSet<String>>>,
    /// Debounce map for context re-injection — prevents storms on rapid events.
    pub reinject_debounce: DebounceMap,
}
