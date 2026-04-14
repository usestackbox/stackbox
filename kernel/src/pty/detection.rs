// src-tauri/src/pty/detection.rs
// Supercontext V3 — OutputClassifier, ResponseCapture, and MemoryKind removed.
// Agents write memory intentionally via remember()/session_log()/session_summary().
// Auto-classification from stdout was the primary source of noise.
//
// Kept:
//   strip_ansi          — used by URL detection in pty/mod.rs
//   on_command_entered  — records commands to workspace events
//   on_command_result   — records command exit codes
//   is_completion_signal — detects agent completion phrases

use crate::{
    db::Db,
    workspace::events::{record_command_executed, record_command_result},
};

pub fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            match chars.peek() {
                Some('[') => {
                    chars.next();
                    for c2 in chars.by_ref() {
                        if c2.is_ascii_alphabetic() {
                            break;
                        }
                    }
                }
                Some(']') | Some('P') | Some('X') | Some('^') | Some('_') => {
                    chars.next();
                    loop {
                        match chars.next() {
                            None | Some('\x07') | Some('\u{9C}') => break,
                            Some('\x1b') => {
                                chars.next();
                                break;
                            }
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

pub fn on_command_entered(db: &Db, runbox_id: &str, session_id: &str, cwd: &str, line: &str) {
    let t = line.trim();
    if t.is_empty() || t.len() < 2 {
        return;
    }
    let lower = t.to_lowercase();
    if lower == "ls" || lower == "pwd" || lower == "clear" || lower == "cls" {
        return;
    }
    record_command_executed(db, runbox_id, session_id, t, cwd);
}

pub fn on_command_result(
    db: &Db,
    runbox_id: &str,
    session_id: &str,
    exit_code: i32,
    duration_ms: i64,
) {
    record_command_result(db, runbox_id, session_id, exit_code, duration_ms);
}

pub fn is_completion_signal(line: &str) -> bool {
    let t = strip_ansi(line).trim().to_string();
    t.contains("Worked for ") && (t.contains('s') || t.contains('m'))
}

/// Extract OSC 133 shell-integration marker payloads from a raw PTY chunk.
///
/// OSC 133 is the "semantic prompt" protocol used by Warp, iTerm2, kitty, etc.
/// Sequences look like:  ESC ] 133 ; PAYLOAD BEL
///                   or  ESC ] 133 ; PAYLOAD ESC \  (ST)
///
/// Known payloads:
///   "A"      — prompt start (shell is showing the prompt → previous command done)
///   "B"      — prompt end   (user started typing)
///   "C"      — command output start (command began executing)
///   "D"      — command finished (no exit code)
///   "D;N"    — command finished with exit code N
///
/// Tmux wraps passthrough sequences as:  ESC P tmux ; ESC ESC ] 133 ; PAYLOAD BEL ESC \
/// This parser handles both the raw form and the tmux DCS passthrough form.
pub fn extract_osc133(raw: &str) -> Vec<String> {
    let bytes = raw.as_bytes();
    let mut results = Vec::new();
    let mut i = 0;

    while i < bytes.len() {
        // ── Tmux DCS passthrough: ESC P tmux ; ESC ESC ] 1 3 3 ; ────────────
        // Pattern: 0x1b 0x50 't' 'm' 'u' 'x' ';' 0x1b 0x1b ']' '1' '3' '3' ';'
        if i + 13 < bytes.len()
            && bytes[i] == 0x1b
            && bytes[i + 1] == b'P'
            && bytes[i + 2] == b't'
            && bytes[i + 3] == b'm'
            && bytes[i + 4] == b'u'
            && bytes[i + 5] == b'x'
            && bytes[i + 6] == b';'
            && bytes[i + 7] == 0x1b
            && bytes[i + 8] == 0x1b
            && bytes[i + 9] == b']'
            && bytes[i + 10] == b'1'
            && bytes[i + 11] == b'3'
            && bytes[i + 12] == b'3'
            && bytes[i + 13] == b';'
        {
            i += 14;
            let start = i;
            while i < bytes.len() && bytes[i] != 0x07 && bytes[i] != 0x1b {
                i += 1;
            }
            if let Ok(payload) = std::str::from_utf8(&bytes[start..i]) {
                if !payload.is_empty() {
                    results.push(payload.to_string());
                }
            }
            // skip BEL / ESC \ (ST) / tmux DCS terminator ESC \
            if i < bytes.len() {
                if bytes[i] == 0x1b {
                    i += 1; // skip ESC
                    if i < bytes.len() && (bytes[i] == b'\\' || bytes[i] == b'\\') {
                        i += 1;
                    }
                } else {
                    i += 1; // skip BEL
                }
            }
            continue;
        }

        // ── Plain OSC: ESC ] 1 3 3 ; ─────────────────────────────────────────
        if i + 5 < bytes.len()
            && bytes[i] == 0x1b
            && bytes[i + 1] == b']'
            && bytes[i + 2] == b'1'
            && bytes[i + 3] == b'3'
            && bytes[i + 4] == b'3'
            && bytes[i + 5] == b';'
        {
            i += 6;
            let start = i;
            while i < bytes.len() && bytes[i] != 0x07 && bytes[i] != 0x1b {
                i += 1;
            }
            if let Ok(payload) = std::str::from_utf8(&bytes[start..i]) {
                if !payload.is_empty() {
                    results.push(payload.to_string());
                }
            }
            if i < bytes.len() {
                if bytes[i] == 0x1b && i + 1 < bytes.len() && bytes[i + 1] == b'\\' {
                    i += 2;
                } else {
                    i += 1;
                }
            }
            continue;
        }

        i += 1;
    }

    results
}