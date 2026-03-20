// src-tauri/src/agent/globals.rs
//
// Global singletons that need to be accessible from anywhere without
// passing AppHandle through every call chain.
//
// Set once during app setup. Read from any thread.

use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

pub fn set_app_handle(handle: AppHandle) {
    APP_HANDLE.set(handle).ok();
}

pub fn emit_memory_added(runbox_id: &str) {
    if let Some(handle) = APP_HANDLE.get() {
        let _ = handle.emit("memory-added", serde_json::json!({ "runbox_id": runbox_id }));
    }
}

pub fn emit_event(event: &str, payload: serde_json::Value) {
    if let Some(handle) = APP_HANDLE.get() {
        let _ = handle.emit(event, payload);
    }
}
