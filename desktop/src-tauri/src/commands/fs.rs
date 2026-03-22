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

#[tauri::command]
pub fn fs_rename(from: String, to: String) -> Result<(), String> {
    std::fs::rename(&from, &to).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_delete(path: String, is_dir: bool) -> Result<(), String> {
    if is_dir { std::fs::remove_dir_all(&path) } else { std::fs::remove_file(&path) }
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_create_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_create_file(path: String) -> Result<(), String> {
    std::fs::File::create(&path).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn copy_to_clipboard(text: String) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e: arboard::Error| e.to_string())?;
    clipboard.set_text(text).map_err(|e: arboard::Error| e.to_string())
}

#[derive(serde::Serialize)]
pub struct FileNode {
    name:     String,
    path:     String,
    is_dir:   bool,
    children: Option<Vec<FileNode>>,
}

#[tauri::command]
pub fn fs_list_dir(path: String) -> Result<Vec<FileNode>, String> {
    let mut entries: Vec<FileNode> = std::fs::read_dir(&path)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| {
            // hide hidden files and node_modules/target
            let name = e.file_name().to_string_lossy().to_string();
            !name.starts_with('.') && name != "node_modules" && name != "target"
        })
        .map(|e| {
            let name   = e.file_name().to_string_lossy().to_string();
            let path   = e.path().to_string_lossy().to_string();
            let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            let children = if is_dir {
                std::fs::read_dir(&path).ok().map(|rd| {
                    rd.filter_map(|e| e.ok())
                      .filter(|e| {
                          let n = e.file_name().to_string_lossy().to_string();
                          !n.starts_with('.') && n != "node_modules" && n != "target"
                      })
                      .map(|e| FileNode {
                          name:     e.file_name().to_string_lossy().to_string(),
                          path:     e.path().to_string_lossy().to_string(),
                          is_dir:   e.file_type().map(|t| t.is_dir()).unwrap_or(false),
                          children: None,
                      })
                      .collect()
                })
            } else { None };
            FileNode { name, path, is_dir, children }
        })
        .collect();

    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    Ok(entries)
}