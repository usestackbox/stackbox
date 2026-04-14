// src/commands/updater.rs
//
// Three Tauri commands the frontend calls via invoke():
//
//   check_update     → Option<UpdateInfo>  — null if already up to date
//   install_update   → ()                  — downloads, installs, restarts
//   get_app_version  → AppVersionInfo      — { version, platform }
//
// Events emitted to the frontend window during install_update:
//   "update-download-progress"  payload: { chunkLength: number, contentLength: number | null }
//   "update-download-finished"  payload: (none)

use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

// ── Payloads ─────────────────────────────────────────────────────────────────

/// Returned when a newer release is found at the configured endpoint.
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    /// SemVer string of the new release, e.g. "1.2.0"
    pub version: String,
    /// RFC-3339 publish date from the update manifest, if present
    pub date: Option<String>,
    /// Release notes / changelog, if present
    pub body: Option<String>,
}

/// Returned by get_app_version — consumed by useVersion.ts and UpdatesTab.tsx.
#[derive(serde::Serialize, Clone)]
pub struct AppVersionInfo {
    /// Current installed version string, e.g. "0.1.0"
    pub version: String,
    /// OS identifier: "windows", "macos", "linux", "android", "ios"
    pub platform: String,
}

// ── Commands ─────────────────────────────────────────────────────────────────

/// Check whether a newer version is available at the configured endpoint.
/// Returns the update metadata if one exists, or null if already up to date.
/// Called automatically 3 s after launch and every hour by useUpdater.ts,
/// and also manually when the user clicks "Check Now" in Settings → Updates.
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;

    match updater.check().await.map_err(|e| e.to_string())? {
        Some(u) => Ok(Some(UpdateInfo {
            version: u.version.clone(),
            date:    u.date.map(|d| d.to_string()),
            body:    u.body.clone(),
        })),
        None => Ok(None),
    }
}

/// Download and install the pending update, then restart the app.
/// Emits "update-download-progress" events while downloading so the frontend
/// can animate the progress bar. On Windows the OS installer forces an exit
/// before app.restart() — that is expected behaviour.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;

    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no update available".to_string())?;

    let progress_handle = app.clone();
    let finished_handle = app.clone();

    update
        .download_and_install(
            // chunk_len   : bytes received in this chunk
            // content_len : total file size if server sent Content-Length
            move |chunk_len, content_len| {
                let _ = progress_handle.emit(
                    "update-download-progress",
                    serde_json::json!({
                        "chunkLength":   chunk_len,
                        "contentLength": content_len,
                    }),
                );
            },
            // Called once the full download completes and before install begins
            move || {
                let _ = finished_handle.emit("update-download-finished", ());
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    // Restart to apply the update.
    // On Windows this line is unreachable — the installer exits the process.
    app.restart();
}

/// Return the current installed app version and OS platform.
/// Used by useVersion.ts (AboutTab, WinControls) and UpdatesTab "Installed" row.
/// Returns { version: "0.1.0", platform: "windows" | "macos" | "linux" | ... }
#[tauri::command]
pub fn get_app_version(app: AppHandle) -> AppVersionInfo {
    AppVersionInfo {
        version:  app.package_info().version.to_string(),
        platform: std::env::consts::OS.to_string(),
    }
}
