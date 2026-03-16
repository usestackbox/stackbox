// src-tauri/src/pty/detection.rs
//
// PTY output analysis — detects workspace events from terminal I/O.
//
// Detects:
//   CommandExecuted  ← from PTY input (pty_write)
//   CommandResult    ← from process exit code
//
// Does NOT detect:
//   FileChanged      ← handled by watcher.rs
//   WorkspaceSnapshot ← handled by git hooks / session end
//   AgentSpawned     ← handled directly in pty/mod.rs

use crate::{
    db::Db,
    workspace::events::{record_command_executed, record_command_result},
};

// ── ANSI escape stripper ──────────────────────────────────────────────────────
pub fn strip_ansi(s: &str) -> String {
    let mut out   = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            match chars.peek() {
                Some('[') => {
                    chars.next();
                    for c2 in chars.by_ref() {
                        if c2.is_ascii_alphabetic() { break; }
                    }
                }
                Some(']') | Some('P') | Some('X') | Some('^') | Some('_') => {
                    chars.next();
                    loop {
                        match chars.next() {
                            None | Some('\x07') | Some('\u{9C}') => break,
                            Some('\x1b') => { chars.next(); break; }
                            _ => {}
                        }
                    }
                }
                _ => {}
            }
        } else {
            out.push(c);
        }
    }
    out
}

// ── Command input detector ────────────────────────────────────────────────────
// Called from pty_write when the user presses Enter.
// Detects meaningful commands (ignores single-char inputs, cd, ls, etc.)
pub fn on_command_entered(
    db:         &Db,
    runbox_id:  &str,
    session_id: &str,
    cwd:        &str,
    line:       &str,
) {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.len() < 2 { return; }

    // Skip navigation noise
    let lower = trimmed.to_lowercase();
    if lower == "ls" || lower == "pwd" || lower == "clear" || lower == "cls" { return; }

    record_command_executed(db, runbox_id, session_id, trimmed, cwd);
    eprintln!("[detection] CommandExecuted: {trimmed}");
}

// ── Command result recorder ───────────────────────────────────────────────────
// Called from the PTY reader thread when the child process exits.
pub fn on_command_result(
    db:          &Db,
    runbox_id:   &str,
    session_id:  &str,
    exit_code:   i32,
    duration_ms: i64,
) {
    record_command_result(db, runbox_id, session_id, exit_code, duration_ms);
    eprintln!("[detection] CommandResult: exit={exit_code} duration={duration_ms}ms");
}

// ── Completion signal ─────────────────────────────────────────────────────────
// Detects when an agent has finished a task. Used for memory auto-capture.
pub fn is_completion_signal(trimmed: &str) -> bool {
    let lower = trimmed.to_lowercase();
    (lower.contains("worked for ") && (lower.contains('s') || lower.contains('m')))
        || trimmed.starts_with('✓')
        || trimmed.starts_with('✔')
        || lower == "done."
        || lower.starts_with("task complete")
}

// ── Response buffer flush ─────────────────────────────────────────────────────
// Accumulates agent output. On completion signal, flushes to memory.
pub fn capture_response(
    text:         &str,
    response_buf: &std::sync::Mutex<String>,
) -> Option<String> {
    for line in text.lines() {
        let stripped = strip_ansi(line);
        let trimmed  = stripped.trim();
        if trimmed.is_empty() { continue; }

        // Skip terminal UI chrome
        let is_noise = trimmed.chars().all(|c| !c.is_alphabetic())
            || trimmed.contains("─────")
            || trimmed.contains("│")
            || trimmed.starts_with("model:")
            || trimmed.starts_with("directory:")
            || trimmed.starts_with('›')
            || trimmed.starts_with('❯')
            || trimmed.starts_with("> ")
            || trimmed.len() < 8;
        if is_noise { continue; }

        if let Ok(mut buf) = response_buf.try_lock() {
            if buf.len() < 4000 {
                buf.push_str(trimmed);
                buf.push('\n');
            }
        }
    }

    // Check for completion signal
    let done = text.lines().any(|l| is_completion_signal(strip_ansi(l).trim()));
    if !done { return None; }

    let Ok(mut buf) = response_buf.try_lock() else { return None; };
    if buf.trim().len() < 20 { buf.clear(); return None; }
    let content = buf.trim().chars().take(600).collect::<String>();
    buf.clear();
    Some(content)
}
