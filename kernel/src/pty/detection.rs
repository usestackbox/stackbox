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
