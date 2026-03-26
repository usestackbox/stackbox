use std::io::Write;

fn main() {
    let raw = match std::env::args().nth(1) {
        Some(a) if !a.is_empty() => a,
        _ => return,
    };

    let url = normalize_to_url(&raw);

    // ── 1. POST to the embedded server → triggers "browser-open-url" Tauri event
    let port = 7547u16;
    let body  = url.as_bytes();
    let req   = format!(
        "POST /open-url HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\nContent-Length: {}\r\nContent-Type: text/plain\r\n\r\n{}",
        body.len(),
        &url,
    );

    if let Ok(mut stream) = std::net::TcpStream::connect(format!("127.0.0.1:{port}")) {
        let _ = stream.write_all(req.as_bytes());
        let mut buf = [0u8; 256];
        let _ = std::io::Read::read(&mut stream, &mut buf);
    }

    // ── 2. Print to stdout — PTY reader picks it up as fallback
    println!("{}", url);
}

/// Convert anything the shell might pass as BROWSER argument into a URL.
fn normalize_to_url(raw: &str) -> String {
    if raw.starts_with("http://") || raw.starts_with("https://") || raw.starts_with("file://") {
        return raw.to_string();
    }

    // Absolute Windows path: C:\... or C:/...
    if raw.len() >= 2 && raw.chars().nth(1) == Some(':') {
        let normalised = raw.replace('\\', "/");
        return format!("file:///{normalised}");
    }

    let looks_like_path = raw.starts_with('.')
        || raw.starts_with('/')
        || raw.starts_with('\\')
        || has_web_extension(raw);

    if looks_like_path {
        let base = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
        let path = base.join(raw);

        if let Ok(canonical) = path.canonicalize() {
            if let Ok(url) = url::Url::from_file_path(&canonical) {
                return url.to_string();
            }
            let s = canonical.to_string_lossy().replace('\\', "/");
            return format!("file:///{}", s.trim_start_matches('/'));
        }

        // File doesn't exist yet — build URL anyway
        let s = path.to_string_lossy().replace('\\', "/");
        return format!("file:///{}", s.trim_start_matches('/'));
    }

    format!("https://{raw}")
}

fn has_web_extension(s: &str) -> bool {
    let lower = s.to_lowercase();
    lower.ends_with(".html") || lower.ends_with(".htm")
        || lower.ends_with(".svg") || lower.ends_with(".pdf") || lower.ends_with(".xhtml")
}