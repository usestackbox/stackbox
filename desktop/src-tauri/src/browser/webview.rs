// src-tauri/src/browser/webview.rs

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager, WebviewBuilder, WebviewUrl, LogicalPosition, LogicalSize};

static BROWSERS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

fn browsers() -> &'static Mutex<HashMap<String, String>> {
    BROWSERS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn label(id: &str) -> String {
    format!("browser-{}", id.replace([':', '.', ' '], "-"))
}

#[tauri::command]
pub async fn browser_create(
    app: AppHandle, id: String, url: String,
    x: f64, y: f64, width: f64, height: f64,
) -> Result<(), String> {
    let lbl = label(&id);
    if let Some(wv) = app.get_webview(&lbl) { let _ = wv.close(); }

    let main_window = app.get_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    let webview = WebviewBuilder::new(
        &lbl,
        WebviewUrl::External(url.parse().map_err(|e: url::ParseError| e.to_string())?),
    ).auto_resize();

    main_window
        .add_child(webview, LogicalPosition::new(x, y), LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;

    browsers().lock().unwrap().insert(id.clone(), lbl.clone());

    // Injection thread — URL tracking + link interception
    let app2 = app.clone();
    let id2  = id.clone();
    let lbl2 = lbl.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(800));
        loop {
            let wv = match app2.get_webview(&lbl2) {
                Some(w) => w,
                None    => break,
            };
            let script = format!(r#"(function(){{
                if (!window._sbxTracking) {{
                    window._sbxTracking = true;
                    let _last = '';
                    setInterval(function(){{
                        if (location.href !== _last) {{
                            _last = location.href;
                            fetch('http://127.0.0.1:7547/url-changed?id={id}&url=' + encodeURIComponent(location.href)).catch(function(){{}});
                        }}
                    }}, 600);
                }}
                if (!window._sbxLinks) {{
                    window._sbxLinks = true;
                    document.addEventListener('click', function(e) {{
                        const a = e.target.closest('a');
                        if (!a) return;
                        const href = a.getAttribute('href');
                        if (!href || href.startsWith('#') || href.startsWith('javascript')) return;
                        if (a.target === '_blank' || a.target === '_new' || a.target === '_top') {{
                            e.preventDefault(); e.stopPropagation();
                            window.location.href = a.href;
                        }}
                    }}, true);
                    window.open = function(url) {{
                        if (url && url !== 'about:blank') window.location.href = url;
                        return null;
                    }};
                }}
            }})();"#, id = id2);
            let _ = wv.eval(&script);
            std::thread::sleep(std::time::Duration::from_millis(600));
        }
    });

    Ok(())
}

#[tauri::command]
pub fn browser_destroy(app: AppHandle, id: String) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&label(&id)) {
        wv.close().map_err(|e| e.to_string())?;
    }
    browsers().lock().unwrap().remove(&id);
    Ok(())
}

#[tauri::command]
pub fn browser_navigate(app: AppHandle, id: String, url: String) -> Result<(), String> {
    app.get_webview(&label(&id)).ok_or("webview not found")?
        .navigate(url.parse::<tauri::Url>().map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browser_set_bounds(
    app: AppHandle, id: String, x: f64, y: f64, width: f64, height: f64,
) -> Result<(), String> {
    let wv = app.get_webview(&label(&id)).ok_or("webview not found")?;
    wv.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    wv.set_size(LogicalSize::new(width, height)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browser_go_back(app: AppHandle, id: String) -> Result<(), String> {
    app.get_webview(&label(&id)).ok_or("webview not found")?
        .eval("window.history.back()").map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browser_go_forward(app: AppHandle, id: String) -> Result<(), String> {
    app.get_webview(&label(&id)).ok_or("webview not found")?
        .eval("window.history.forward()").map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browser_reload(app: AppHandle, id: String) -> Result<(), String> {
    app.get_webview(&label(&id)).ok_or("webview not found")?
        .eval("window.location.reload()").map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browser_show(
    app: AppHandle, id: String, x: f64, y: f64, width: f64, height: f64,
) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&label(&id)) {
        let _ = wv.set_position(LogicalPosition::new(x, y));
        let _ = wv.set_size(LogicalSize::new(width, height));
        let _ = wv.set_focus();
    }
    Ok(())
}

#[tauri::command]
pub fn browser_hide(app: AppHandle, id: String) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&label(&id)) {
        let _ = wv.set_position(LogicalPosition::new(-10000.0, -10000.0));
        let _ = wv.set_size(LogicalSize::new(1.0, 1.0));
    }
    Ok(())
}
