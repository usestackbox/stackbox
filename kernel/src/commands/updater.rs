// src/commands/updater.rs
// Tauri v2 updater commands surfaced to the frontend.

use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version:  String,
    pub date:     Option<String>,
    pub body:     Option<String>,
}

/// Check for a new release. Returns Some(UpdateInfo) if an update is available,
/// None if the app is already up to date.
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await.map_err(|e| e.to_string())? {
        Some(update) => Ok(Some(UpdateInfo {
            version: update.version.clone(),
            date:    update.date.map(|d| d.to_string()),
            body:    update.body.clone(),
        })),
        None => Ok(None),
    }
}

/// Download and install the pending update.
/// The app will restart automatically after install.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no update available".to_string())?;

    let handle = app.clone();
    update
        .download_and_install(
            |chunk_len, content_len| {
                handle.emit("update-download-progress", serde_json::json!({
                    "chunkLength":   chunk_len,
                    "contentLength": content_len,
                })).ok();
            },
            || {
                handle.emit("update-download-finished", ()).ok();
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    // Restart to apply
    app.restart();
}
