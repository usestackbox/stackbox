

use std::io::Write;

fn main() {
    let url = match std::env::args().nth(1) {
        Some(u) if u.starts_with("http://") || u.starts_with("https://") => u,
        // Some tools pass the URL as-is without a scheme — prepend https
        Some(u) if !u.is_empty() => format!("https://{}", u),
        _ => return,
    };

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
        // Read/discard the response so the server doesn't get a broken-pipe error
        let mut buf = [0u8; 256];
        let _ = std::io::Read::read(&mut stream, &mut buf);
    }

    // ── 2. Print to stdout so the URL also appears in the terminal output.
    //       The PTY reader will pick it up as a fallback if the HTTP post fails.
    println!("{}", url);
}