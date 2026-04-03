// src/state.rs
//
// Shared application state injected into all Tauri commands and the
// webhook handler.

use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::sync::{Arc, Mutex};

use crate::{agent::kind::AgentKind, db::Db, pty::writer::PtyWriter};

// ── PtySession ─────────────────────────────────────────────────────────────────

pub struct PtySession {
    pub writer:        Box<dyn Write + Send>,
    pub _master:       Box<dyn portable_pty::MasterPty + Send>,
    pub _child:        Box<dyn portable_pty::Child + Send + Sync>,
    pub input_buf:     String,
    pub runbox_id:     String,
    pub cwd:           String,
    pub agent_kind:    AgentKind,
    pub worktree_path: Option<String>,
    pub docker:        bool,
}

// ── Type aliases ───────────────────────────────────────────────────────────────

pub type SessionMap  = Arc<Mutex<HashMap<String, PtySession>>>;
pub type WatcherMap  = Arc<Mutex<HashMap<String, notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>>>>;
pub type DebounceMap = Arc<Mutex<HashMap<String, u64>>>;

// ── AppState ───────────────────────────────────────────────────────────────────

pub struct AppState {
    // ── Core DB ──────────────────────────────────────────────────────────────
    pub db: Db,

    // ── PTY sessions ─────────────────────────────────────────────────────────
    pub sessions: SessionMap,

    // ── File watchers ─────────────────────────────────────────────────────────
    pub watchers:          WatcherMap,
    pub watched_runboxes:  Arc<Mutex<HashSet<String>>>,
    pub reinject_debounce: DebounceMap,

    // ── GitHub webhook / PR feedback ──────────────────────────────────────────
    /// Routes webhook feedback to the correct agent's PTY.
    /// Register after PTY spawn; unregister on PTY exit.
    pub pty_writer: PtyWriter,

    /// GitHub personal access token for API calls (review comments, CI logs).
    /// Sourced from GITHUB_TOKEN env var at startup.
    pub github_token: String,
}