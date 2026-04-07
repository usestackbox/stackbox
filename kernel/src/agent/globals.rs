// src-tauri/src/agent/globals.rs
//
// Global singletons accessible from anywhere without passing AppHandle
// through every call chain.
//
// Set once during app setup. Read from any thread.
//
// GCC+Letta addition: runbox_cwd_registry
//   Maps runbox_id → cwd so that injector.rs and store.rs can find the
//   /memory/ directory for filesystem sync without changing every function
//   signature. Registered on every pty::spawn() call.

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

// ── App handle ────────────────────────────────────────────────────────────────

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

pub fn set_app_handle(handle: AppHandle) {
    APP_HANDLE.set(handle).ok();
}

pub fn emit_memory_added(runbox_id: &str) {
    if let Some(handle) = APP_HANDLE.get() {
        let _ = handle.emit(
            "memory-added",
            serde_json::json!({ "runbox_id": runbox_id }),
        );
    }
}

pub fn emit_event(event: &str, payload: serde_json::Value) {
    if let Some(handle) = APP_HANDLE.get() {
        let _ = handle.emit(event, payload);
    }
}

// ── Runbox CWD registry ───────────────────────────────────────────────────────
//
// Maps runbox_id → effective_cwd (after worktree resolution).
// Used by:
//   - memory::store::remember()   — to find /memory/ for FS sync
//   - agent::injector              — to read main.md + metadata.yaml
//   - memory::sleep                — to find /memory/ for sleep-time jobs
//
// Registered in pty::spawn() after effective_cwd is resolved.
// Deregistered on session end (optional — last value stays valid for fallback).

static CWD_REGISTRY: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

fn cwd_registry() -> &'static Mutex<HashMap<String, String>> {
    CWD_REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Register the effective CWD for a runbox. Call once per pty::spawn().
/// Safe to call multiple times — last value wins.
pub fn register_runbox_cwd(runbox_id: &str, cwd: &str) {
    if let Ok(mut map) = cwd_registry().lock() {
        map.insert(runbox_id.to_string(), cwd.to_string());
    }
}

/// Look up the CWD for a runbox. Returns empty string if not registered.
/// Callers should treat empty string as "FS sync not available".
pub fn get_runbox_cwd(runbox_id: &str) -> String {
    cwd_registry()
        .lock()
        .ok()
        .and_then(|map| map.get(runbox_id).cloned())
        .unwrap_or_default()
}

/// Remove a runbox from the registry (on runbox delete or cleanup).
pub fn deregister_runbox_cwd(runbox_id: &str) {
    if let Ok(mut map) = cwd_registry().lock() {
        map.remove(runbox_id);
    }
}
