// src/conflict/mod.rs
//
// File Conflict Prevention — 4 layers
//
// FIX (conflict-name): `waiting` now stores (agent_id, session_id, agent_name)
//   so that when a lock is transferred the new holder's display name is set
//   correctly. Previously locked_by_name was overwritten with the agent_id
//   string (e.g. a UUID) rather than the human-readable display name.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;

pub type ConflictRegistry = Arc<Mutex<HashMap<String, FileConflictState>>>;

fn registry_key(path: &str) -> String {
    PathBuf::from(path)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(path))
        .to_string_lossy()
        .to_string()
}

#[derive(Debug, Clone)]
pub struct OwnedLines {
    pub agent_id: String,
    pub agent_name: String,
    pub diff: String,
    pub ranges: Vec<(usize, usize)>,
}

#[derive(Debug, Clone)]
pub struct FileConflictState {
    pub file: String,
    pub locked_by: String,      // agent_id
    pub locked_by_name: String, // display name
    pub locked_at: Instant,
    pub session_id: String,
    /// (agent_id, session_id, agent_name)
    pub waiting: Vec<(String, String, String)>,
    pub ownership: Vec<OwnedLines>,
    pub failed_attempts: u8,
}

impl FileConflictState {
    fn new(file: &str, agent_id: &str, agent_name: &str, session_id: &str) -> Self {
        Self {
            file: file.to_string(),
            locked_by: agent_id.to_string(),
            locked_by_name: agent_name.to_string(),
            locked_at: Instant::now(),
            session_id: session_id.to_string(),
            waiting: Vec::new(),
            ownership: Vec::new(),
            failed_attempts: 0,
        }
    }
}

pub fn new_registry() -> ConflictRegistry {
    Arc::new(Mutex::new(HashMap::new()))
}

// ── Layer 2: Write Locking ────────────────────────────────────────────────────

#[derive(Debug, serde::Serialize)]
#[serde(tag = "status")]
pub enum LockResult {
    #[serde(rename = "granted")]
    Granted,
    #[serde(rename = "queued")]
    Queued {
        locked_by: String,
        queue_pos: usize,
        context: String,
    },
}

pub fn request_lock(
    registry: &ConflictRegistry,
    file: &str,
    agent_id: &str,
    agent_name: &str,
    session_id: &str,
) -> LockResult {
    let key = registry_key(file);
    let mut reg = registry.lock().unwrap();

    if let Some(state) = reg.get_mut(&key) {
        if state.locked_by != agent_id {
            let already_waiting = state.waiting.iter().any(|(id, _, _)| id == agent_id);
            if !already_waiting {
                state.waiting.push((
                    agent_id.to_string(),
                    session_id.to_string(),
                    agent_name.to_string(),
                ));
            }
            let pos = state
                .waiting
                .iter()
                .position(|(id, _, _)| id == agent_id)
                .unwrap_or(0)
                + 1;
            let context = build_context_for_waiter(state);
            return LockResult::Queued {
                locked_by: state.locked_by_name.clone(),
                queue_pos: pos,
                context,
            };
        }
        return LockResult::Granted;
    }

    reg.insert(
        key,
        FileConflictState::new(file, agent_id, agent_name, session_id),
    );
    LockResult::Granted
}

pub fn release_lock(
    registry: &ConflictRegistry,
    file: &str,
    agent_id: &str,
    cwd: &str,
) -> Option<(String, String, String)> {
    let key = registry_key(file);
    let mut reg = registry.lock().unwrap();

    let state = match reg.get_mut(&key) {
        Some(s) if s.locked_by == agent_id => s,
        _ => return None,
    };

    let diff = capture_git_diff(cwd, file);
    if !diff.is_empty() {
        let ranges = parse_hunk_ranges(&diff);
        state.ownership.push(OwnedLines {
            agent_id: agent_id.to_string(),
            agent_name: state.locked_by_name.clone(),
            diff: diff.clone(),
            ranges,
        });
    }

    if state.waiting.is_empty() {
        reg.remove(&key);
        return None;
    }

    // FIX: destructure all three fields so locked_by_name gets the real display name
    let (next_agent, next_session, next_name) = state.waiting.remove(0);
    let context = build_context_for_waiter(state);

    state.locked_by = next_agent.clone();
    state.locked_by_name = next_name; // ← was: next_agent.clone() (wrong!)
    state.session_id = next_session.clone();
    state.locked_at = Instant::now();

    Some((next_agent, next_session, context))
}

pub fn force_release_on_process_exit(
    registry: &ConflictRegistry,
    session_id: &str,
    cwd: &str,
) -> Vec<(String, String, String, String)> {
    let mut results = Vec::new();
    let mut reg = registry.lock().unwrap();

    let locked_files: Vec<String> = reg
        .values()
        .filter(|s| s.session_id == session_id)
        .map(|s| s.file.clone())
        .collect();

    for file in locked_files {
        let key = registry_key(&file);
        if let Some(state) = reg.get_mut(&key) {
            let agent_id = state.locked_by.clone();
            let diff = capture_git_diff(cwd, &file);
            if !diff.is_empty() {
                let ranges = parse_hunk_ranges(&diff);
                state.ownership.push(OwnedLines {
                    agent_id: agent_id.clone(),
                    agent_name: state.locked_by_name.clone(),
                    diff,
                    ranges,
                });
            }

            if state.waiting.is_empty() {
                reg.remove(&key);
                continue;
            }

            let (next_agent, next_session, next_name) = state.waiting.remove(0);
            let context = build_context_for_waiter(state);
            state.locked_by = next_agent.clone();
            state.locked_by_name = next_name;
            state.session_id = next_session.clone();
            state.locked_at = Instant::now();
            results.push((file, next_agent, next_session, context));
        }
    }
    results
}

// ── Layer 3: Diff Merge / Verification ───────────────────────────────────────

#[derive(Debug, serde::Serialize)]
pub enum VerifyResult {
    Pass,
    Fail {
        overlap: Vec<(usize, usize)>,
        owner: String,
    },
}

pub fn verify_write(
    registry: &ConflictRegistry,
    file: &str,
    agent_id: &str,
    cwd: &str,
) -> VerifyResult {
    let key = registry_key(file);
    let mut reg = registry.lock().unwrap();

    let state = match reg.get(&key) {
        Some(s) => s.clone(),
        None => return VerifyResult::Pass,
    };

    let new_diff = capture_git_diff(cwd, file);
    let new_ranges = parse_hunk_ranges(&new_diff);

    for owned in &state.ownership {
        if owned.agent_id == agent_id {
            continue;
        }
        let overlap = find_overlap(&owned.ranges, &new_ranges);
        if !overlap.is_empty() {
            if let Some(s) = reg.get_mut(&key) {
                s.failed_attempts = s.failed_attempts.saturating_add(1);
            }
            return VerifyResult::Fail {
                overlap,
                owner: owned.agent_name.clone(),
            };
        }
    }

    VerifyResult::Pass
}

fn should_escalate(registry: &ConflictRegistry, file: &str) -> bool {
    let key = registry_key(file);
    registry
        .lock()
        .unwrap()
        .get(&key)
        .map(|s| s.failed_attempts >= 3)
        .unwrap_or(false)
}

fn build_conflict_trace(registry: &ConflictRegistry, file: &str) -> serde_json::Value {
    let key = registry_key(file);
    let reg = registry.lock().unwrap();
    let state = match reg.get(&key) {
        Some(s) => s,
        None => return serde_json::json!({ "error": "no conflict state" }),
    };

    let ownership: Vec<_> = state.ownership.iter().map(|o| {
        serde_json::json!({
            "agent_id":   o.agent_id,
            "agent_name": o.agent_name,
            "ranges":     o.ranges.iter().map(|(s, e)| serde_json::json!([s, e])).collect::<Vec<_>>(),
            "diff":       &o.diff[..o.diff.len().min(2000)],
        })
    }).collect();

    serde_json::json!({
        "file":            &state.file,
        "locked_by":       &state.locked_by_name,
        "failed_attempts": state.failed_attempts,
        "waiting":         state.waiting.iter().map(|(id, _, _)| id).collect::<Vec<_>>(),
        "ownership":       ownership,
    })
}

pub fn clear_conflict(registry: &ConflictRegistry, file: &str) {
    let key = registry_key(file);
    registry.lock().unwrap().remove(&key);
}

fn capture_git_diff(cwd: &str, file: &str) -> String {
    if cwd.is_empty() {
        return String::new();
    }
    let rel = PathBuf::from(file)
        .strip_prefix(cwd)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| file.to_string());

    std::process::Command::new("git")
        .args(["diff", "HEAD", "--", &rel])
        .current_dir(cwd)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default()
}

fn parse_hunk_ranges(diff: &str) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    for line in diff.lines() {
        if line.starts_with("@@") {
            if let Some(plus) = line.find('+') {
                let rest = &line[plus + 1..];
                let end = rest
                    .find(|c: char| !c.is_ascii_digit() && c != ',')
                    .unwrap_or(rest.len());
                let part = &rest[..end];
                let mut it = part.splitn(2, ',');
                if let (Some(start_s), len_s) = (it.next(), it.next()) {
                    let start: usize = start_s.parse().unwrap_or(0);
                    let len: usize = len_s.and_then(|s| s.parse().ok()).unwrap_or(1);
                    if start > 0 {
                        ranges.push((start, start + len.saturating_sub(1)));
                    }
                }
            }
        }
    }
    ranges
}

fn find_overlap(a: &[(usize, usize)], b: &[(usize, usize)]) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    for &(as_, ae) in a {
        for &(bs, be) in b {
            let lo = as_.max(bs);
            let hi = ae.min(be);
            if lo <= hi {
                out.push((lo, hi));
            }
        }
    }
    out
}

fn build_context_for_waiter(state: &FileConflictState) -> String {
    if state.ownership.is_empty() {
        return format!(
            "{} is locked by {}. Stand by.",
            state.file, state.locked_by_name
        );
    }

    let mut ctx = format!(
        "{file} was updated.\n\nDo not touch the following ranges:\n",
        file = state.file
    );

    for owned in &state.ownership {
        ctx.push_str(&format!(
            "\n— {} changed lines: {}\n",
            owned.agent_name,
            owned
                .ranges
                .iter()
                .map(|(s, e)| format!("{s}-{e}"))
                .collect::<Vec<_>>()
                .join(", ")
        ));
        if !owned.diff.is_empty() {
            let preview = &owned.diff[..owned.diff.len().min(800)];
            ctx.push_str(&format!("\nDiff preview:\n```diff\n{preview}\n```\n"));
        }
    }

    ctx.push_str("\nWrite only in your assigned scope. Do not touch what other agents wrote.");
    ctx
}

use crate::state::AppState;

#[tauri::command]
pub fn conflict_request_lock(
    file: String,
    agent_id: String,
    agent_name: String,
    session_id: String,
    state: tauri::State<'_, AppState>,
) -> serde_json::Value {
    let result = request_lock(
        &state.conflict_registry,
        &file,
        &agent_id,
        &agent_name,
        &session_id,
    );
    serde_json::to_value(result).unwrap_or_default()
}

#[tauri::command]
pub fn conflict_release_lock(
    file: String,
    agent_id: String,
    cwd: String,
    state: tauri::State<'_, AppState>,
) -> serde_json::Value {
    let next = release_lock(&state.conflict_registry, &file, &agent_id, &cwd);

    if let Some((next_agent, next_session, context)) = next {
        crate::agent::globals::emit_event(
            "conflict-next-writer",
            serde_json::json!({
                "file":         &file,
                "next_agent":   &next_agent,
                "next_session": &next_session,
                "context":      &context,
            }),
        );
        serde_json::json!({ "status": "released", "next_agent": next_agent })
    } else {
        serde_json::json!({ "status": "released", "next_agent": null })
    }
}

#[tauri::command]
pub fn conflict_verify_write(
    file: String,
    agent_id: String,
    cwd: String,
    state: tauri::State<'_, AppState>,
) -> serde_json::Value {
    let result = verify_write(&state.conflict_registry, &file, &agent_id, &cwd);

    if should_escalate(&state.conflict_registry, &file) {
        let trace = build_conflict_trace(&state.conflict_registry, &file);
        crate::agent::globals::emit_event(
            "conflict-escalate",
            serde_json::json!({
                "file":  &file,
                "trace": trace,
            }),
        );
    }

    serde_json::to_value(result).unwrap_or_default()
}

#[tauri::command]
pub fn conflict_get_state(file: String, state: tauri::State<'_, AppState>) -> serde_json::Value {
    build_conflict_trace(&state.conflict_registry, &file)
}

#[tauri::command]
pub fn conflict_clear(file: String, state: tauri::State<'_, AppState>) {
    clear_conflict(&state.conflict_registry, &file);
}

pub fn on_session_exit(registry: &ConflictRegistry, session_id: &str, cwd: &str) {
    let notifications = force_release_on_process_exit(registry, session_id, cwd);
    for (file, next_agent, next_session, context) in notifications {
        crate::agent::globals::emit_event(
            "conflict-next-writer",
            serde_json::json!({
                "file":         file,
                "next_agent":   next_agent,
                "next_session": next_session,
                "context":      context,
                "reason":       "process-exit",
            }),
        );
    }
}
