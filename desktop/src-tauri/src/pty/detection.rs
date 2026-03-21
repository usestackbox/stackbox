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

// ── Output Classifier ─────────────────────────────────────────────────────────
// Scans agent PTY output in real-time and classifies chunks into memory types.
// Decision / Failure / Preference — saved automatically, zero user action.

#[derive(Debug, Clone, PartialEq)]
pub enum MemoryKind {
    Decision,
    Failure,
    Preference,
}

pub struct OutputClassifier {
    buf:      String,
    emitted:  std::collections::HashSet<String>,
}

impl OutputClassifier {
    pub fn new() -> Self {
        Self { buf: String::new(), emitted: std::collections::HashSet::new() }
    }

    /// Feed a PTY chunk. Returns a list of (kind, content) to save as memories.
    pub fn feed(&mut self, text: &str) -> Vec<(MemoryKind, String)> {
        let stripped = strip_ansi(text);
        self.buf.push_str(&stripped);

        // Keep buffer bounded — only last 4KB matters for context
        if self.buf.len() > 4096 {
            let trim_at = self.buf.len() - 4096;
            let safe = (trim_at..=self.buf.len())
                .find(|&i| self.buf.is_char_boundary(i))
                .unwrap_or(self.buf.len());
            self.buf = self.buf[safe..].to_string();
        }

        let mut results = Vec::new();

        // Collect all lines so we can grab context window around matches
        let all_lines: Vec<&str> = stripped.lines().collect();

        for (idx, line) in all_lines.iter().enumerate() {
            let t = line.trim();
            if t.len() < 4 { continue; }

            let lower = t.to_lowercase();

            // ── Failure patterns ──────────────────────────────────────────────
            let is_failure = lower.contains("error:") ||
                lower.contains("parsererror") ||
                lower.contains("failed to") ||
                lower.contains("cannot find") ||
                lower.contains("could not find") ||
                lower.contains("permission denied") ||
                lower.contains("port already in use") ||
                lower.contains("address already in use") ||
                lower.contains("enoent") ||
                lower.contains("panicked at") ||
                lower.contains("no such file") ||
                (lower.contains("error[") && lower.contains("]")) ||
                lower.contains("compilation failed") ||
                lower.contains("build failed") ||
                lower.contains("fullyqualifiederrorid") ||
                lower.contains("exception") && lower.contains("thrown") ||
                lower.contains("is not recognized as the name") ||
                lower.contains("is not recognized as an internal") ||
                lower.contains("command not found") ||
                lower.contains("commandnotfoundexception") ||
                lower.contains("access is denied") ||
                lower.contains("syntax error") ||
                lower.contains("typeerror:") ||
                lower.contains("referenceerror:") ||
                lower.contains("uncaught ") && lower.contains("error");

            // ── Decision patterns ─────────────────────────────────────────────
            // Keep patterns specific — require subject + verb to avoid false positives.
            // e.g. "instead of a gradient" (CSS description) must NOT match.
            let is_decision = lower.contains("i'll use") ||
                lower.contains("i will use") ||
                lower.contains("i've decided") ||
                lower.contains("i'm switching to") ||
                lower.contains("switching from") ||
                (lower.contains("instead of") && (lower.contains("i'll") || lower.contains("we'll") || lower.contains("i've") || lower.contains("decided") || lower.contains("chose"))) ||
                lower.contains("i chose") ||
                lower.contains("i'm going with") ||
                lower.contains("the approach will be") ||
                lower.contains("we're using") ||
                (lower.contains("using ") && lower.contains(" because") && lower.contains("i")) ||
                lower.contains("opted for") ||
                lower.contains("decided to use");

            // ── Preference patterns ───────────────────────────────────────────
            let is_pref = lower.contains("i prefer") ||
                lower.contains("best practice") ||
                lower.contains("always use") ||
                lower.contains("never use") ||
                lower.contains("should always") ||
                lower.contains("should never") ||
                lower.contains("recommend using") ||
                lower.contains("the convention is");

            let kind = if is_failure {
                Some(MemoryKind::Failure)
            } else if is_decision {
                Some(MemoryKind::Decision)
            } else if is_pref {
                Some(MemoryKind::Preference)
            } else {
                None
            };

            if let Some(k) = kind {
                // Deduplicate by first line key
                let key: String = t.chars().take(80).collect();
                if !self.emitted.contains(&key) {
                    self.emitted.insert(key);

                    // For failures: grab context window (2 lines before + 4 lines after)
                    // so we capture the full error block, not just the matching line.
                    let content: String = if k == MemoryKind::Failure {
                        let start = idx.saturating_sub(2);
                        let end   = (idx + 5).min(all_lines.len());
                        let block: Vec<&str> = all_lines[start..end]
                            .iter()
                            .map(|l| l.trim())
                            .filter(|l| !l.is_empty())
                            .collect();
                        let joined = block.join("\n");
                        // Clean residual control chars
                        joined.chars().filter(|c| *c >= ' ' || *c == '\t' || *c == '\n').collect()
                    } else {
                        // Decisions / preferences: just the single clean line
                        t.chars().filter(|c| *c >= ' ' || *c == '\t').collect()
                    };

                    if content.len() >= 8 {
                        results.push((k, content));
                    }
                }
            }
        }

        results
    }
}