#[tauri::command]
pub async fn open_directory_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    Ok(app
        .dialog()
        .file()
        .blocking_pick_folder()
        .map(|p| p.to_string()))
}

#[tauri::command]
pub fn open_in_editor(path: String, editor: String) {
    let cmd = match editor.as_str() {
        "cursor" => "cursor",
        _ => "code",
    };
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
    if is_dir {
        std::fs::remove_dir_all(&path)
    } else {
        std::fs::remove_file(&path)
    }
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_create_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_create_file(path: String) -> Result<(), String> {
    std::fs::File::create(&path)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn copy_to_clipboard(text: String) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e: arboard::Error| e.to_string())?;
    clipboard
        .set_text(text)
        .map_err(|e: arboard::Error| e.to_string())
}

#[derive(serde::Serialize)]
pub struct FileNode {
    name: String,
    path: String,
    is_dir: bool,
    children: Option<Vec<FileNode>>,
}

#[tauri::command]
pub fn fs_list_dir(path: String) -> Result<Vec<FileNode>, String> {
    let mut entries: Vec<FileNode> = std::fs::read_dir(&path)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            !name.starts_with('.') && name != "node_modules" && name != "target"
        })
        .map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let path = e.path().to_string_lossy().to_string();
            let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            let children = if is_dir {
                std::fs::read_dir(&path).ok().map(|rd| {
                    rd.filter_map(|e| e.ok())
                        .filter(|e| {
                            let n = e.file_name().to_string_lossy().to_string();
                            !n.starts_with('.') && n != "node_modules" && n != "target"
                        })
                        .map(|e| FileNode {
                            name: e.file_name().to_string_lossy().to_string(),
                            path: e.path().to_string_lossy().to_string(),
                            is_dir: e.file_type().map(|t| t.is_dir()).unwrap_or(false),
                            children: None,
                        })
                        .collect()
                })
            } else {
                None
            };
            FileNode {
                name,
                path,
                is_dir,
                children,
            }
        })
        .collect();

    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    Ok(entries)
}

// ── NEW: write file ───────────────────────────────────────────────────────────
#[tauri::command]
pub fn fs_write_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

// ── NEW: search in files ──────────────────────────────────────────────────────
#[derive(serde::Serialize, Clone)]
pub struct SearchMatch {
    pub path: String,
    pub line: usize,
    pub col_start: usize,
    pub col_end: usize,
    pub text: String,
}

#[tauri::command]
pub fn fs_search_in_files(
    root: String,
    query: String,
    case_sensitive: bool,
    use_regex: bool,
    include_exts: Vec<String>, // e.g. ["ts","rs"] — empty = all
    exclude_dirs: Vec<String>, // e.g. ["node_modules",".git","target"]
) -> Result<Vec<SearchMatch>, String> {
    use std::io::{BufRead, BufReader};

    if query.is_empty() {
        return Ok(vec![]);
    }

    // Build regex or plain pattern
    let pattern: Box<dyn Fn(&str) -> Option<(usize, usize)> + Send> = if use_regex {
        let flags = if case_sensitive { "" } else { "(?i)" };
        let re = regex::Regex::new(&format!("{}{}", flags, &query)).map_err(|e| e.to_string())?;
        Box::new(move |line: &str| re.find(line).map(|m| (m.start(), m.end())))
    } else {
        let needle = if case_sensitive {
            query.clone()
        } else {
            query.to_lowercase()
        };
        Box::new(move |line: &str| {
            let hay = if case_sensitive {
                line.to_string()
            } else {
                line.to_lowercase()
            };
            hay.find(&needle).map(|s| (s, s + needle.len()))
        })
    };

    let default_excludes = ["node_modules", ".git", "target", "dist", ".next", "out"];
    let mut results: Vec<SearchMatch> = Vec::new();

    for entry in walkdir::WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            // skip hidden
            if name.starts_with('.') {
                return false;
            }
            // skip default + user-supplied exclude dirs
            if e.file_type().is_dir() {
                if default_excludes.contains(&name.as_ref()) {
                    return false;
                }
                if exclude_dirs.iter().any(|x| x == name.as_ref()) {
                    return false;
                }
            }
            true
        })
    {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        if entry.file_type().is_dir() {
            continue;
        }

        let path_str = entry.path().to_string_lossy().to_string();

        // extension filter
        if !include_exts.is_empty() {
            let ext = entry
                .path()
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            if !include_exts.iter().any(|x| x.to_lowercase() == ext) {
                continue;
            }
        }

        // skip large files (> 2 MB)
        if entry.metadata().map(|m| m.len()).unwrap_or(0) > 2_097_152 {
            continue;
        }

        let file = match std::fs::File::open(entry.path()) {
            Ok(f) => f,
            Err(_) => continue,
        };

        for (i, line) in BufReader::new(file).lines().enumerate() {
            let line = match line {
                Ok(l) => l,
                Err(_) => break,
            };
            if let Some((cs, ce)) = pattern(&line) {
                results.push(SearchMatch {
                    path: path_str.clone(),
                    line: i + 1,
                    col_start: cs,
                    col_end: ce,
                    text: line.trim_end().to_string(),
                });
                if results.len() >= 2000 {
                    return Ok(results);
                }
            }
        }
    }

    Ok(results)
}
