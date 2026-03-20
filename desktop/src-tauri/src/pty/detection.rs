// src-tauri/src/pty/detection.rs

use crate::{
    db::Db,
    workspace::events::{record_command_executed, record_command_result},
};

// ── ANSI escape stripper ───────────────────────────────────────────────────────
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

// ── Command input detector ─────────────────────────────────────────────────────
pub fn on_command_entered(
    db:         &Db,
    runbox_id:  &str,
    session_id: &str,
    cwd:        &str,
    line:       &str,
) {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.len() < 2 { return; }
    let lower = trimmed.to_lowercase();
    if lower == "ls" || lower == "pwd" || lower == "clear" || lower == "cls" { return; }
    record_command_executed(db, runbox_id, session_id, trimmed, cwd);
}

// ── Command result recorder ────────────────────────────────────────────────────
pub fn on_command_result(
    db:          &Db,
    runbox_id:   &str,
    session_id:  &str,
    exit_code:   i32,
    duration_ms: i64,
) {
    record_command_result(db, runbox_id, session_id, exit_code, duration_ms);
}

// ── Completion signal ──────────────────────────────────────────────────────────
// Codex prints "─ Worked for Xm Xs ─" or "─ Worked for Xs ─" at end of task.
pub fn is_completion_signal(line: &str) -> bool {
    let t = strip_ansi(line);
    let t = t.trim();
    // "─ Worked for 3m 31s ───" or "─ Worked for 45s ───"
    t.contains("Worked for ") && (t.contains('s') || t.contains('m'))
}

// ── Response buffer ────────────────────────────────────────────────────────────
// Strategy: Codex always writes a clean prose summary AFTER "─ Worked for X ─".
// We only capture text that appears in that final summary block.
// Everything before it (plan steps, errors, spinner output) is ignored.

pub struct ResponseCapture {
    // Are we currently in the post-completion summary block?
    in_summary:   bool,
    // Accumulated summary lines
    buf:          String,
    // Have we already emitted a summary this session?
    emitted:      bool,
}

impl ResponseCapture {
    pub fn new() -> Self {
        Self { in_summary: false, buf: String::new(), emitted: false }
    }

    /// Feed a chunk of PTY output. Returns Some(summary) when ready.
    pub fn feed(&mut self, text: &str) -> Option<String> {
        if self.emitted { return None; }

        for line in text.lines() {
            let stripped = strip_ansi(line);
            let t        = stripped.trim();

            // "─ Worked for X ─" marks the start of the summary block
            if is_completion_signal(t) {
                self.in_summary = true;
                continue;
            }

            if !self.in_summary { continue; }

            // Stop collecting at the next prompt line or empty-then-prompt
            if t.contains("Nodebook>") { break; }
            if t.contains("% left ·")  { break; }
            if t.starts_with('›')       { break; }

            // Skip noise lines even inside summary block
            if t.is_empty() { continue; }
            if t.starts_with('•')       { continue; } // spinner
            if t.starts_with("Tests:")  { continue; } // "Tests: Not run"
            if t.starts_with("Memory:") { continue; } // "Memory: tool isn't available"
            if t.starts_with("Next steps:") { break; } // stop before next steps
            if t.starts_with("1.") || t.starts_with("2.") { break; } // numbered next steps
            if t.len() < 10            { continue; }

            // Only keep lines with enough alphabetic content
            let alpha = t.chars().filter(|c| c.is_alphabetic()).count();
            if alpha < 8 { continue; }

            if self.buf.len() < 600 {
                self.buf.push_str(t);
                self.buf.push('\n');
            }
        }

        // Emit once we have content and have seen the completion signal
        if self.in_summary && !self.buf.trim().is_empty() && !self.emitted {
            // Wait until we've accumulated at least 2 lines or 80 chars
            if self.buf.len() >= 80 || self.buf.lines().count() >= 2 {
                self.emitted = true;
                let out = self.buf.trim().to_string();
                self.buf.clear();
                return Some(out);
            }
        }

        None
    }

    pub fn already_emitted(&self) -> bool { self.emitted }
}

// ── Legacy shim for pty/mod.rs ────────────────────────────────────────────────
// pty/mod.rs uses capture_response(text, buf_mutex) — keep that signature
// working by wrapping ResponseCapture in the mutex approach.
// But we now expose ResponseCapture directly so pty/mod.rs can own it cleanly.
pub fn capture_response(
    text:         &str,
    response_buf: &std::sync::Mutex<String>,
) -> Option<String> {
    // This legacy path is no longer used — pty/mod.rs should use ResponseCapture directly.
    // Kept to avoid compile errors if anything still calls it.
    None
}