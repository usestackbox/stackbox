// src/commands/notification.rs
// Wrapper around tauri-plugin-notification for native OS notifications.

use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

#[tauri::command]
pub fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(&title)
        .body(&body)
        .show()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn notify_with_icon(
    app: AppHandle,
    title: String,
    body: String,
    icon: Option<String>,
) -> Result<(), String> {
    let mut builder = app.notification().builder().title(&title).body(&body);
    if let Some(icon_path) = icon {
        builder = builder.icon(icon_path);
    }
    builder.show().map_err(|e| e.to_string())
}
