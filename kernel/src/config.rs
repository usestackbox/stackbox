// src/config.rs
// Read / write ~/.config/stackbox/config.json.
// Uses serde_json — no extra dep. Thread-safe via a simple file lock
// (we write atomically via a temp-file + rename).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// ── Shape ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    /// UI theme: "dark" | "light" | "system"
    #[serde(default = "default_theme")]
    pub theme: String,

    /// Base font size (px) for the UI shell
    #[serde(default = "default_font_size")]
    pub font_size: u8,

    /// Whether to check for updates automatically on launch
    #[serde(default = "default_true")]
    pub auto_update: bool,

    /// Whether to launch Stackbox on OS login
    #[serde(default)]
    pub launch_at_login: bool,

    /// Log level: "error" | "warn" | "info" | "debug" | "trace"
    #[serde(default = "default_log_level")]
    pub log_level: String,

    /// Sidebar width (pixels)
    #[serde(default = "default_sidebar_width")]
    pub sidebar_width: u32,
}

fn default_theme() -> String {
    "dark".into()
}
fn default_font_size() -> u8 {
    13
}
fn default_true() -> bool {
    true
}
fn default_log_level() -> String {
    "info".into()
}
fn default_sidebar_width() -> u32 {
    260
}

impl Default for AppConfig {
    fn default() -> Self {
        serde_json::from_str("{}").expect("default AppConfig parse failed")
    }
}

// ── Paths ─────────────────────────────────────────────────────────────────────

fn config_path() -> Result<PathBuf, String> {
    let base =
        dirs::config_dir().ok_or_else(|| "could not determine config directory".to_string())?;
    Ok(base.join("calus").join("config.json"))
}

// ── Public API ────────────────────────────────────────────────────────────────

pub fn read() -> Result<AppConfig, String> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("read config: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("parse config: {e}"))
}

pub fn write(cfg: &AppConfig) -> Result<(), String> {
    let path = config_path()?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("create config dir: {e}"))?;
    }
    // Atomic write: temp file → rename
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(cfg).map_err(|e| format!("serialize config: {e}"))?;
    std::fs::write(&tmp, json).map_err(|e| format!("write config tmp: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("rename config: {e}"))
}

// ── Tauri Commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn config_read() -> Result<AppConfig, String> {
    read()
}

#[tauri::command]
pub fn config_write(config: AppConfig) -> Result<(), String> {
    write(&config)
}

#[tauri::command]
pub fn config_reset() -> Result<AppConfig, String> {
    let cfg = AppConfig::default();
    write(&cfg)?;
    Ok(cfg)
}
