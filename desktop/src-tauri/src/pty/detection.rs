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
                Some('[') => { chars.next(); for c2 in chars.by_ref() { if c2.is_ascii_alphabetic() { break; } } }
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
        } else { out.push(c); }
    }
    out
}

pub fn on_command_entered(db: &Db, runbox_id: &str, session_id: &str, cwd: &str, line: &str) {
    let t = line.trim();
    if t.is_empty() || t.len() < 2 { return; }
    let lower = t.to_lowercase();
    if lower == "ls" || lower == "pwd" || lower == "clear" || lower == "cls" { return; }
    record_command_executed(db, runbox_id, session_id, t, cwd);
}

pub fn on_command_result(db: &Db, runbox_id: &str, session_id: &str, exit_code: i32, duration_ms: i64) {
    record_command_result(db, runbox_id, session_id, exit_code, duration_ms);
}

pub fn is_completion_signal(line: &str) -> bool {
    let t = strip_ansi(line).trim().to_string();
    t.contains("Worked for ") && (t.contains('s') || t.contains('m'))
}

pub struct ResponseCapture {
    in_summary: bool,
    buf:        String,
    emitted:    bool,
}

impl ResponseCapture {
    pub fn new() -> Self { Self { in_summary: false, buf: String::new(), emitted: false } }

    pub fn feed(&mut self, text: &str) -> Option<String> {
        if self.emitted { return None; }
        for line in text.lines() {
            let stripped = strip_ansi(line);
            let t = stripped.trim();
            if is_completion_signal(t) { self.in_summary = true; continue; }
            if !self.in_summary { continue; }
            if t.contains("Nodebook>") || t.contains("% left ·") || t.starts_with('›') { break; }
            if t.is_empty() || t.starts_with('•') || t.starts_with("Tests:") || t.starts_with("Memory:")
                || t.starts_with("Next steps:") || t.starts_with("1.") { continue; }
            if t.len() < 10 { continue; }
            let alpha = t.chars().filter(|c| c.is_alphabetic()).count();
            if alpha < 8 { continue; }
            if self.buf.len() < 600 { self.buf.push_str(t); self.buf.push('\n'); }
        }
        if self.in_summary && !self.buf.trim().is_empty() && !self.emitted {
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

pub fn capture_response(_text: &str, _buf: &std::sync::Mutex<String>) -> Option<String> { None }

// ── Memory type (V2 — 6 types) ────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub enum MemoryKind {
    Failure,
    Blocker,
    Environment,
    Codebase,
    Goal,
    Session,
}

pub struct OutputClassifier {
    buf:     String,
    emitted: std::collections::HashSet<String>,
}

impl OutputClassifier {
    pub fn new() -> Self { Self { buf: String::new(), emitted: std::collections::HashSet::new() } }

    pub fn feed(&mut self, text: &str) -> Vec<(MemoryKind, String)> {
        let stripped = strip_ansi(text);
        self.buf.push_str(&stripped);
        if self.buf.len() > 8192 {
            let trim_at = self.buf.len() - 8192;
            let safe = (trim_at..=self.buf.len())
                .find(|&i| self.buf.is_char_boundary(i)).unwrap_or(self.buf.len());
            self.buf = self.buf[safe..].to_string();
        }

        let mut results = Vec::new();
        let all_lines: Vec<&str> = stripped.lines().collect();
        let mut in_code = false;

        for (idx, line) in all_lines.iter().enumerate() {
            let fence = line.trim();
            if fence.starts_with("```") || fence.starts_with("~~~") { in_code = !in_code; continue; }
            if in_code { continue; }
            let t = line.trim();
            if t.len() < 4 { continue; }
            let lower = t.to_lowercase();

            // ── Goal patterns ─────────────────────────────────────────────────
            let is_goal = (lower.contains("the goal is") || lower.contains("we are building")
                || lower.contains("task is to") || lower.contains("objective:"))
                && lower.len() > 20 && lower.len() < 400;

            // ── Environment patterns ──────────────────────────────────────────
            // Must look like key=value declarations
            let is_env = {
                let eq_count = t.matches('=').count();
                let has_env_word = lower.contains("using port") || lower.contains("port =")
                    || lower.contains("running on") || lower.contains("node is")
                    || lower.contains("python is") || lower.contains("not found")
                    || lower.contains("command not") || lower.contains("use node")
                    || lower.contains("instead of python") || lower.contains("instead of py");
                (eq_count >= 1 && t.len() < 200 && !lower.contains("error")) || has_env_word
            };

            // ── Codebase patterns ─────────────────────────────────────────────
            let is_codebase = {
                let has_path = t.contains('/') || t.contains('\\') || t.contains(".ts")
                    || t.contains(".rs") || t.contains(".py") || t.contains(".js");
                let has_colon = t.contains(':');
                has_path && has_colon && t.len() > 15 && t.len() < 300
                    && !lower.contains("error") && !lower.contains("failed")
            };

            // ── Blocker patterns ──────────────────────────────────────────────
            let is_blocker = (lower.contains("cannot") || lower.contains("unable to")
                || lower.contains("stuck on") || lower.contains("blocked by")
                || lower.contains("tried:") || lower.contains("already tried")
                || lower.contains("does not work") || lower.contains("won't work"))
                && lower.len() > 20;

            // ── Failure patterns ──────────────────────────────────────────────
            let is_failure = lower.contains("error:") || lower.contains("failed to")
                || lower.contains("cannot find") || lower.contains("permission denied")
                || lower.contains("port already in use") || lower.contains("enoent")
                || lower.contains("panicked at") || lower.contains("build failed")
                || lower.contains("fullyqualifiederrorid")
                || lower.contains("commandnotfoundexception")
                || lower.contains("is not recognized as the name")
                || lower.contains("access is denied") || lower.contains("typeerror:")
                || lower.contains("referenceerror:");

            // Priority: goal > env > codebase > blocker > failure
            let kind = if is_goal           { Some(MemoryKind::Goal) }
                else if is_env && !is_failure { Some(MemoryKind::Environment) }
                else if is_codebase          { Some(MemoryKind::Codebase) }
                else if is_blocker           { Some(MemoryKind::Blocker) }
                else if is_failure           { Some(MemoryKind::Failure) }
                else                         { None };

            if let Some(k) = kind {
                let key: String = t.chars().take(80).collect();
                if !self.emitted.contains(&key) {
                    self.emitted.insert(key);

                    let content: String = if k == MemoryKind::Failure || k == MemoryKind::Blocker {
                        let start = idx.saturating_sub(2);
                        let end   = (idx + 5).min(all_lines.len());
                        let block: Vec<&str> = all_lines[start..end].iter()
                            .map(|l| l.trim()).filter(|l| !l.is_empty()).collect();
                        block.join("\n").chars().filter(|c| *c >= ' ' || *c == '\t' || *c == '\n').collect()
                    } else {
                        t.chars().filter(|c| *c >= ' ' || *c == '\t').collect()
                    };

                    if content.len() >= 8 { results.push((k, content)); }
                }
            }
        }
        results
    }
}