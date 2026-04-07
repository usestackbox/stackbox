// src-tauri/src/proxy.rs
//
// Custom "proxy://" URI scheme for the embedded browser pane.
// Routes external HTTP fetches through Rust so the webview can load
// arbitrary pages without CORS restrictions.
//
// FIX (Bug #8):  Corrected "Access-Control-Allown-Origin" typo.
// FIX (Bug #12): Removed block_on() inside async context; use single-use runtime.
// FIX (proxy-sq): rewrite_urls now handles both double- and single-quoted attrs.
// FIX (proxy-rel): resolve_url normalises ../ relative paths correctly.

use tauri::http::{Request, Response};

const PROXY_BASE: &str = "proxy://localhost/fetch?url=";

pub fn handle(request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let uri = request.uri().to_string();
    let url = if let Some(pos) = uri.find("?url=") {
        urlencoding::decode(&uri[pos + 5..])
            .unwrap_or_default()
            .into_owned()
    } else {
        return Response::builder()
            .status(400)
            .body(b"missing url param".to_vec())
            .unwrap();
    };

    let rt = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(r) => r,
        Err(e) => {
            return Response::builder()
                .status(500)
                .body(format!("runtime error: {e}").into_bytes())
                .unwrap();
        }
    };

    rt.block_on(async move {
        let is_local = url.contains("localhost")
            || url.contains("127.0.0.1")
            || url.contains("0.0.0.0")
            || url.starts_with("file://");

        let client = reqwest::Client::builder()
            .danger_accept_invalid_certs(is_local)
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
                    .unwrap()
            }
        };

        let status = resp.status().as_u16();
        let mut is_html = false;
        let mut ct = "application/octet-stream".to_string();

        for (k, v) in resp.headers() {
            if k.as_str().to_lowercase() == "content-type" {
                ct = v.to_str().unwrap_or("").to_string();
                if ct.contains("text/html") {
                    is_html = true;
                }
            }
        }

        let bytes = resp.bytes().await.unwrap_or_default();
        let final_body = if is_html {
            rewrite_urls(&String::from_utf8_lossy(&bytes), &url).into_bytes()
        } else {
            bytes.to_vec()
        };

        Response::builder()
            .status(status)
            .header("Content-Type", ct)
            .header("Access-Control-Allow-Origin", "*")
            .body(final_body)
            .unwrap()
    })
}

/// Rewrite `src`, `href`, and `action` attributes (both double- and single-quoted)
/// so all URLs are routed through the proxy.
fn rewrite_urls(body: &str, base_url: &str) -> String {
    let mut out = body.to_string();

    for attr in &["src", "href", "action"] {
        // Handle double-quoted and single-quoted variants in two passes.
        for quote in &['"', '\''] {
            let mut result = String::new();
            let mut remaining = out.as_str();
            let pattern = format!("{}={}", attr, quote);

            while let Some(start) = remaining.find(&pattern) {
                result.push_str(&remaining[..start + pattern.len()]);
                remaining = &remaining[start + pattern.len()..];

                if let Some(end) = remaining.find(*quote) {
                    let original = &remaining[..end];
                    if original.starts_with('#')
                        || original.starts_with("data:")
                        || original.starts_with("javascript:")
                        || original.is_empty()
                    {
                        result.push_str(original);
                    } else {
                        let resolved = resolve_url(base_url, original);
                        result.push_str(&format!(
                            "{}{}",
                            PROXY_BASE,
                            urlencoding::encode(&resolved)
                        ));
                    }
                    remaining = &remaining[end..];
                }
            }
            result.push_str(remaining);
            out = result;
        }
    }

    let base_tag = format!(
        "<base href=\"{}{}\">",
        PROXY_BASE,
        urlencoding::encode(base_url)
    );
    let form_shim = format!(
        r#"<script>
(function(){{
    const P={:?};
    document.addEventListener('submit',function(e){{
        const f=e.target;
        if(!f||f.method.toUpperCase()!=='GET')return;
        e.preventDefault();
        const qs=new URLSearchParams(new FormData(f)).toString();
        window.location.href=P+encodeURIComponent((f.action||location.href).split('?')[0]+'?'+qs);
    }},true);
}})();
</script>"#,
        PROXY_BASE
    );

    if let Some(pos) = out.find("</head>") {
        out.insert_str(pos, &(base_tag + &form_shim));
    }
    out
}

/// Resolve a potentially relative URL against a base URL.
///
/// Handles:
///   - Absolute URLs (http://, https://)          → returned as-is
///   - Protocol-relative (//host/path)             → scheme prepended
///   - Root-relative (/path)                       → origin prepended
///   - Relative with ../ components                → normalised
///   - Plain relative (file.html, ../foo/bar.css)  → resolved against base dir
fn resolve_url(base: &str, href: &str) -> String {
    if href.starts_with("http://") || href.starts_with("https://") {
        return href.to_string();
    }
    if href.starts_with("//") {
        let scheme = if base.starts_with("https") {
            "https:"
        } else {
            "http:"
        };
        return format!("{}{}", scheme, href);
    }

    // Extract origin and base-directory from `base`.
    if let Some(idx) = base.find("://") {
        let after = &base[idx + 3..];
        let origin_end = after.find('/').map(|i| idx + 3 + i).unwrap_or(base.len());
        let origin = &base[..origin_end];

        if href.starts_with('/') {
            return format!("{}{}", origin, href);
        }

        // Build the base directory (everything up to the last '/')
        let base_dir = &base[..base.rfind('/').unwrap_or(base.len())];
        let raw = format!("{}/{}", base_dir, href);

        // Normalise path segments: collapse . and ..
        return normalise_url_path(&raw);
    }

    href.to_string()
}

/// Walk through URL path segments and collapse `.` and `..` components.
/// Preserves the scheme+authority prefix unchanged.
fn normalise_url_path(url: &str) -> String {
    // Split at the first '/' after the authority (after "://host")
    let path_start = url
        .find("://")
        .and_then(|i| url[i + 3..].find('/').map(|j| i + 3 + j))
        .unwrap_or(0);

    let (prefix, path) = url.split_at(path_start);

    let mut segments: Vec<&str> = Vec::new();
    for seg in path.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                segments.pop();
            }
            s => segments.push(s),
        }
    }

    format!("{}/{}", prefix, segments.join("/"))
}
