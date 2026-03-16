// src-tauri/src/commands/fs.rs

#[tauri::command]
pub async fn open_directory_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    Ok(app.dialog().file().blocking_pick_folder().map(|p| p.to_string()))
}

#[tauri::command]
pub fn open_in_editor(path: String, editor: String) {
    let cmd = match editor.as_str() { "cursor" => "cursor", _ => "code" };
    std::process::Command::new(cmd).arg(&path).spawn().ok();
}

#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}
