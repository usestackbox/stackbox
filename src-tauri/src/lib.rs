mod browser;
mod db;
mod memory;

use browser::{
    browser_create, browser_destroy, browser_navigate, browser_set_bounds,
    browser_go_back, browser_go_forward, browser_reload, browser_show, browser_hide,
};

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter};
use tauri::http::{Request, Response};

/// Expand `~` and `%USERPROFILE%` to the real home directory,
/// then normalise slashes so `cmd.cwd()` always gets an absolute path.
fn expand_cwd(raw: &str) -> String {
    let s = raw.trim();

    let expanded = if s == "~" || s.starts_with("~/") || s.starts_with("~\\") {
        if let Some(home) = dirs::home_dir() {
            let rest = &s[1..];
            let rest = rest.trim_start_matches('/').trim_start_matches('\\');
            if rest.is_empty() {
                home.to_string_lossy().to_string()
            } else {
                home.join(rest).to_string_lossy().to_string()
            }
        } else {
            s.to_string()
        }
    } else {
        s.to_string()
    };

    #[cfg(windows)]
    {
        if expanded.contains('%') {
            if let Ok(v) = std::env::var("USERPROFILE") {
                return expanded.replace("%USERPROFILE%", &v)
                               .replace("%userprofile%", &v);
            }
        }
    }

    expanded
}

const PROXY_BASE: &str = "proxy://localhost/fetch?url=";

struct PtySession {
    writer:  Box<dyn Write + Send>,
    _master: Box<dyn portable_pty::MasterPty + Send>,
    _child:  Box<dyn portable_pty::Child + Send + Sync>,
}

type SessionMap = Arc<Mutex<HashMap<String, PtySession>>>;

struct AppState {
    sessions: SessionMap,
    db:       db::Db,
}

 

fn resolve_url(base: &str, href: &str) -> String {
    if href.starts_with("http://") || href.starts_with("https://") {
        return href.to_string();
    }
    if href.starts_with("//") {
        let scheme = if base.starts_with("https") { "https:" } else { "http:" };
        return format!("{}{}", scheme, href);
    }
    if let Some(idx) = base.find("://") {
        let after = &base[idx + 3..];
        let origin_end = after.find('/').map(|i| idx + 3 + i).unwrap_or(base.len());
        let origin = &base[..origin_end];
        if href.starts_with('/') {
            return format!("{}{}", origin, href);
        } else {
            let path = &base[..base.rfind('/').unwrap_or(base.len())];
            return format!("{}/{}", path, href);
        }
    }
    href.to_string()
}

fn rewrite_urls(body: &str, base_url: &str) -> String {
    let mut out = body.to_string();

    for attr in &["src", "href", "action"] {
        let mut result = String::new();
        let mut remaining = out.as_str();
        let pattern = format!("{}=\"", attr);
        while let Some(start) = remaining.find(&pattern) {
            result.push_str(&remaining[..start + pattern.len()]);
            remaining = &remaining[start + pattern.len()..];
            if let Some(end) = remaining.find('"') {
                let original = &remaining[..end];
                if original.starts_with('#') || original.starts_with("data:") || original.is_empty() {
                    result.push_str(original);
                } else {
                    let resolved = resolve_url(base_url, original);
                    result.push_str(&format!("{}{}", PROXY_BASE, urlencoding::encode(&resolved)));
                }
                remaining = &remaining[end..];
            }
        }
        result.push_str(remaining);
        out = result;
    }

    let base_tag = format!("<base href=\"{}{}\">", PROXY_BASE, urlencoding::encode(base_url));

    let form_shim = format!(r#"<script>
    (function() {{
        const PROXY = {:?};
        document.addEventListener('submit', function(e) {{
            const f = e.target;
            if (!f || f.method.toUpperCase() !== 'GET') return;
            e.preventDefault();
            const fd = new FormData(f);
            const qs = new URLSearchParams(fd).toString();
            const base = f.action || window.location.href;
            window.location.href = PROXY + encodeURIComponent(base.split('?')[0] + '?' + qs);
        }}, true);
    }})();
    </script>"#, PROXY_BASE);

    if let Some(pos) = out.find("</head>") {
        out.insert_str(pos, &(base_tag + &form_shim));
    }
    out
}

fn handle_proxy_request(request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let uri = request.uri().to_string();
    let url = if let Some(pos) = uri.find("?url=") {
        let encoded = &uri[pos + 5..];
        urlencoding::decode(encoded).unwrap_or_default().into_owned()
    } else {
        return Response::builder()
            .status(400)
            .body(b"missing url param".to_vec())
            .unwrap();
    };

    tauri::async_runtime::block_on(async move {
        let client = reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .cookie_store(true)
            .build()
            .unwrap_or_default();

        let resp = match client.get(&url).send().await {
            Ok(r) => r,
            Err(e) => {
                return Response::builder()
                    .status(502)
                    .body(e.to_string().into_bytes())
                    .unwrap();
            }
        };

        let status = resp.status().as_u16();
        let mut is_html = false;
        let mut content_type = String::from("application/octet-stream");

        for (k, v) in resp.headers() {
            let key = k.as_str().to_lowercase();
            if key == "content-type" {
                let ct = v.to_str().unwrap_or("").to_string();
                if ct.contains("text/html") { is_html = true; }
                content_type = ct;
            }
        }

        let body_bytes = resp.bytes().await.unwrap_or_default();
        let final_body = if is_html {
            let text = String::from_utf8_lossy(&body_bytes).into_owned();
            rewrite_urls(&text, &url).into_bytes()
        } else {
            body_bytes.to_vec()
        };

        Response::builder()
            .status(status)
            .header("Content-Type", content_type)
            .header("Access-Control-Allow-Origin", "*")
            .body(final_body)
            .unwrap()
    })
}

// ── PTY commands ──────────────────────────────────────────────────────────────

#[tauri::command]
async fn pty_spawn(
    app: AppHandle,
    session_id: String,
    cwd: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let mut cmd = CommandBuilder::new(if cfg!(windows) { "powershell.exe" } else { "bash" });
    let resolved_cwd = expand_cwd(&cwd);
    cmd.cwd(&resolved_cwd);
    if cfg!(windows) {
        cmd.args(&[
            "-NoLogo",
            "-NoExit",
            "-Command",
            r#"function prompt { "~/" + (Get-Location | Split-Path -Leaf) + "> " }"#,
        ]);
    }
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    state.sessions.lock().unwrap().insert(
        session_id.clone(),
        PtySession { writer, _master: pair.master, _child: child },
    );
    let sid = session_id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 { break; }
            let _ = app.emit(
                &format!("pty://output/{}", sid),
                String::from_utf8_lossy(&buf[..n]).to_string(),
            );
        }
        let _ = app.emit(&format!("pty://ended/{}", sid), ());
    });
    Ok(())
}

#[tauri::command]
fn pty_write(
    session_id: String,
    data: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    if let Some(s) = state.sessions.lock().unwrap().get_mut(&session_id) {
        let _ = s.writer.write_all(data.as_bytes());
        let _ = s.writer.flush();
    }
    Ok(())
}

#[tauri::command]
fn pty_resize(
    session_id: String,
    cols: u16,
    rows: u16,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    if let Some(s) = state.sessions.lock().unwrap().get(&session_id) {
        s._master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn pty_kill(
    session_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state.sessions.lock().unwrap().remove(&session_id);
    Ok(())
}

// ── memory.rs commands ────────────────────────────────────────────────────────

#[tauri::command]
async fn memory_add(
    runbox_id:  String,
    session_id: String,
    agent:      String,
    content:    String,
) -> Result<memory::Memory, String> {
    memory::memory_add(&runbox_id, &session_id, &agent, &content).await
}

#[tauri::command]
async fn memory_list(runbox_id: String) -> Result<Vec<memory::Memory>, String> {
    memory::memories_for_runbox(&runbox_id).await
}

#[tauri::command]
async fn memory_delete(id: String) -> Result<(), String> {
    memory::memory_delete(&id).await
}

#[tauri::command]
async fn memory_pin(id: String, pinned: bool) -> Result<(), String> {
    memory::memory_pin(&id, pinned).await
}

// ── db.rs commands ────────────────────────────────────────────────────────────

#[tauri::command]
fn db_sessions_for_runbox(
    runbox_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<db::Session>, String> {
    db::sessions_for_runbox(&state.db, &runbox_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_file_changes_for_runbox(
    runbox_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<db::FileChange>, String> {
    db::file_changes_for_runbox(&state.db, &runbox_id).map_err(|e| e.to_string())
}

// ── worktree commands (referenced by RunboxManager) ───────────────────────────

#[tauri::command]
async fn worktree_create(
    repo_path:     String,
    worktree_path: String,
    branch:        String,
) -> Result<String, String> {
    let output = tokio::process::Command::new("git")
        .args(["worktree", "add", "-b", &branch, &worktree_path])
        .current_dir(&repo_path)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(worktree_path)
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
async fn worktree_remove(
    repo_path:     String,
    worktree_path: String,
) -> Result<(), String> {
    let output = tokio::process::Command::new("git")
        .args(["worktree", "remove", "--force", &worktree_path])
        .current_dir(&repo_path)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

// ── Entry point ───────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            db:       db::open().expect("failed to open stackbox db"),
        })
        .setup(|_app| {
            tauri::async_runtime::spawn(async {
                memory::init().await.expect("memory init failed");
            });
            Ok(())
        })
        .register_uri_scheme_protocol("proxy", |_ctx, req| handle_proxy_request(req))
        .invoke_handler(tauri::generate_handler![
            // pty
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            // memory
            memory_add,
            memory_list,
            memory_delete,
            memory_pin,
            // db
            db_sessions_for_runbox,
            db_file_changes_for_runbox,
            // worktree
            worktree_create,
            worktree_remove,
            // browser
            browser_create,
            browser_destroy,
            browser_navigate,
            browser_set_bounds,
            browser_go_back,
            browser_go_forward,
            browser_reload,
            browser_show,
            browser_hide,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}