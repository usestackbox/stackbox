// src/conflict/mod.rs
//
// File Conflict Prevention — 4 layers
//
// Layer 1 — Section Ownership:  after any write, git diff is captured and
//                                registered as "owned" lines for that agent.
// Layer 2 — Write Locking:      MCP tool `file_write_request` serialises access.
//                                Lock tied to PTY process — released on idle/exit.
// Layer 3 — Diff Merge:         after lock release, waiting agents receive
//                                context injection with full diff before they write.
// Layer 4 — Orchestrator:       3 failed verifications → emit conflict-escalate
//                                event for the frontend DiffViewer panel.
//
// No timeout. Lock lifecycle = PTY process lifecycle.
// State created on collision. Destroyed after resolution.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;

// ── Types ─────────────────────────────────────────────────────────────────────

pub type ConflictRegistry = Arc<Mutex<HashMap<String, FileConflictState>>>;

/// Key into the registry. Canonical path string.
fn registry_key(path: &str) -> String {
    PathBuf::from(path)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(path))
        .to_string_lossy()
        .to_string()
}

// ── FileConflictState ─────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct OwnedLines {
    pub agent_id:   String,
    pub agent_name: String,
    /// Raw unified diff lines (from `git diff HEAD <file>`)
    pub diff:       String,
    /// Hunk line ranges extracted from the diff: Vec<(start, end)>
    pub ranges:     Vec<(usize, usize)>,
}

#[derive(Debug, Clone)]
pub struct FileConflictState {
    pub file:            String,
    pub locked_by:       String,          // agent_id
    pub locked_by_name:  String,          // display name
    pub locked_at:       Instant,
    pub session_id:      String,          // session that holds the lock
    pub waiting:         Vec<(String, String)>, // (agent_id, session_id)
    pub ownership:       Vec<OwnedLines>, // grows as agents write
    pub failed_attempts: u8,
}

impl FileConflictState {
    fn new(file: &str, agent_id: &str, agent_name: &str, session_id: &str) -> Self {
        Self {
            file:           file.to_string(),
            locked_by:      agent_id.to_string(),
            locked_by_name: agent_name.to_string(),
            locked_at:      Instant::now(),
            session_id:     session_id.to_string(),
            waiting:        Vec::new(),
            ownership:      Vec::new(),
            failed_attempts: 0,
        }
    }
}

// ── Registry ──────────────────────────────────────────────────────────────────

pub fn new_registry() -> ConflictRegistry {
    Arc::new(Mutex::new(HashMap::new()))
}

// ── Layer 2: Write Locking ────────────────────────────────────────────────────

#[derive(Debug, serde::Serialize)]
#[serde(tag = "status")]
pub enum LockResult {
    /// Caller now holds the lock. Proceed with write.
    #[serde(rename = "granted")]
    Granted,
    /// File is locked by another agent. Caller is queued.
    #[serde(rename = "queued")]
    Queued {
        locked_by:   String,
        queue_pos:   usize,
        context:     String,  // injected diff context for the waiter
    },
}

/// Called via MCP tool `file_write_request`.
/// Returns Granted or Queued.
pub fn request_lock(
    registry:   &ConflictRegistry,
    file:       &str,
    agent_id:   &str,
    agent_name: &str,
    session_id: &str,
) -> LockResult {
    let key = registry_key(file);
    let mut reg = registry.lock().unwrap();

    if let Some(state) = reg.get_mut(&key) {
        // Already locked by someone else
        if state.locked_by != agent_id {
            let already_waiting = state.waiting.iter().any(|(id, _)| id == agent_id);
            if !already_waiting {
                state.waiting.push((agent_id.to_string(), session_id.to_string()));
            }
            let pos     = state.waiting.iter().position(|(id, _)| id == agent_id).unwrap_or(0) + 1;
            let context = build_context_for_waiter(state);
            return LockResult::Queued {
                locked_by: state.locked_by_name.clone(),
                queue_pos: pos,
                context,
            };
        }
        // Same agent re-requesting — idempotent grant
        return LockResult::Granted;
    }

    // No conflict yet — create state and grant
    reg.insert(key, FileConflictState::new(file, agent_id, agent_name, session_id));
    LockResult::Granted
}

/// Called via MCP tool `file_write_release` after the agent finishes writing.
/// Captures the git diff, updates ownership, notifies the next waiter.
/// Returns the (agent_id, session_id) of the next agent to notify, if any.
pub fn release_lock(
    registry:   &ConflictRegistry,
    file:       &str,
    agent_id:   &str,
    cwd:        &str,
) -> Option<(String, String, String)> {  // (next_agent_id, next_session_id, context)
    let key = registry_key(file);
    let mut reg = registry.lock().unwrap();

    let state = match reg.get_mut(&key) {
        Some(s) if s.locked_by == agent_id => s,
        _ => return None,
    };

    // Capture git diff for this file
    let diff = capture_git_diff(cwd, file);
    if !diff.is_empty() {
        let ranges = parse_hunk_ranges(&diff);
        state.ownership.push(OwnedLines {
            agent_id:   agent_id.to_string(),
            agent_name: state.locked_by_name.clone(),
            diff:       diff.clone(),
            ranges,
        });
    }

    // Pop the next waiter
    if state.waiting.is_empty() {
        // No one waiting — destroy state
        reg.remove(&key);
        return None;
    }

    let (next_agent, next_session) = state.waiting.remove(0);
    let context = build_context_for_waiter(state);

    // Transfer lock to next agent
    state.locked_by     = next_agent.clone();
    state.locked_by_name = next_agent.clone(); // display name updated by caller
    state.session_id    = next_session.clone();
    state.locked_at     = Instant::now();

    Some((next_agent, next_session, context))
}

/// Called by the PTY monitor when a process exits or goes idle.
/// Force-releases the lock for `session_id` without requiring MCP tool call.
pub fn force_release_on_process_exit(
    registry:   &ConflictRegistry,
    session_id: &str,
    cwd:        &str,
) -> Vec<(String, String, String, String)> {  // Vec<(file, next_agent, next_session, context)>
    let mut results = Vec::new();
    let mut reg = registry.lock().unwrap();

    let locked_files: Vec<String> = reg.values()
        .filter(|s| s.session_id == session_id)
        .map(|s| s.file.clone())
        .collect();

    for file in locked_files {
        let key = registry_key(&file);
        if let Some(state) = reg.get_mut(&key) {
            let agent_id = state.locked_by.clone();
            let diff     = capture_git_diff(cwd, &file);
            if !diff.is_empty() {
                let ranges = parse_hunk_ranges(&diff);
                state.ownership.push(OwnedLines {
                    agent_id:   agent_id.clone(),
                    agent_name: state.locked_by_name.clone(),
                    diff,
                    ranges,
                });
            }

            if state.waiting.is_empty() {
                reg.remove(&key);
                continue;
            }

            let (next_agent, next_session) = state.waiting.remove(0);
            let context = build_context_for_waiter(state);
            state.locked_by   = next_agent.clone();
            state.session_id  = next_session.clone();
            state.locked_at   = Instant::now();
            results.push((file, next_agent, next_session, context));
        }
    }
    results
}

// ── Layer 3: Diff Merge / Verification ───────────────────────────────────────

#[derive(Debug, serde::Serialize)]
pub enum VerifyResult {
    Pass,
    Fail { overlap: Vec<(usize, usize)>, owner: String },
}

/// After an agent writes, verify it didn't touch another agent's owned lines.
/// Called via MCP tool `file_write_verify`.
pub fn verify_write(
    registry: &ConflictRegistry,
    file:     &str,
    agent_id: &str,
    cwd:      &str,
) -> VerifyResult {
    let key = registry_key(file);
    let mut reg = registry.lock().unwrap();

    let state = match reg.get(&key) {
        Some(s) => s.clone(),
        None    => return VerifyResult::Pass,  // no conflict state → pass
    };

    let new_diff   = capture_git_diff(cwd, file);
    let new_ranges = parse_hunk_ranges(&new_diff);

    for owned in &state.ownership {
        if owned.agent_id == agent_id { continue; }
        let overlap = find_overlap(&new_ranges, &owned.ranges);
        if !overlap.is_empty() {
            // Increment failure counter
            if let Some(s) = reg.get_mut(&key) {
                s.failed_attempts += 1;
            }
            return VerifyResult::Fail {
                overlap,
                owner: owned.agent_name.clone(),
            };
        }
    }

    VerifyResult::Pass
}

// ── Layer 4: Orchestrator escalation ─────────────────────────────────────────

pub const MAX_FAILURES: u8 = 3;

/// Returns true if this file has hit the escalation threshold.
pub fn should_escalate(registry: &ConflictRegistry, file: &str) -> bool {
    let key = registry_key(file);
    registry.lock().unwrap()
        .get(&key)
        .map(|s| s.failed_attempts >= MAX_FAILURES)
        .unwrap_or(false)
}

/// Build the full conflict trace for the DiffViewer panel.
pub fn build_conflict_trace(registry: &ConflictRegistry, file: &str) -> serde_json::Value {
    let key = registry_key(file);
    let reg = registry.lock().unwrap();
    let state = match reg.get(&key) {
        Some(s) => s,
        None    => return serde_json::json!({ "error": "no conflict state" }),
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
        "waiting":         state.waiting.iter().map(|(id, _)| id).collect::<Vec<_>>(),
        "ownership":       ownership,
    })
}

/// Clear conflict state for a file (user resolved manually).
pub fn clear_conflict(registry: &ConflictRegistry, file: &str) {
    let key = registry_key(file);
    registry.lock().unwrap().remove(&key);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

fn capture_git_diff(cwd: &str, file: &str) -> String {
    if cwd.is_empty() { return String::new(); }
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

/// Parse unified diff hunks → Vec<(start_line, end_line)> for changed lines.
fn parse_hunk_ranges(diff: &str) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    for line in diff.lines() {
        // @@ -l,s +l,s @@ format
        if line.starts_with("@@") {
            if let Some(plus) = line.find('+') {
                let rest = &line[plus + 1..];
                let end  = rest.find(|c: char| !c.is_ascii_digit() && c != ',').unwrap_or(rest.len());
                let part = &rest[..end];
                let mut it = part.splitn(2, ',');
                if let (Some(start_s), len_s) = (it.next(), it.next()) {
                    let start: usize = start_s.parse().unwrap_or(0);
                    let len:   usize = len_s.and_then(|s| s.parse().ok()).unwrap_or(1);
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
            if lo <= hi { out.push((lo, hi)); }
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
            owned.ranges.iter()
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

// ── Tauri commands ────────────────────────────────────────────────────────────

use crate::state::AppState;

/// MCP-exposed: request write lock on a file.
#[tauri::command]
pub fn conflict_request_lock(
    file:       String,
    agent_id:   String,
    agent_name: String,
    session_id: String,
    state:      tauri::State<'_, AppState>,
) -> serde_json::Value {
    let result = request_lock(
        &state.conflict_registry,
        &file, &agent_id, &agent_name, &session_id,
    );
    serde_json::to_value(result).unwrap_or_default()
}

/// MCP-exposed: release write lock and capture diff.
#[tauri::command]
pub fn conflict_release_lock(
    file:       String,
    agent_id:   String,
    cwd:        String,
    state:      tauri::State<'_, AppState>,
) -> serde_json::Value {
    let next = release_lock(&state.conflict_registry, &file, &agent_id, &cwd);

    if let Some((next_agent, next_session, context)) = next {
        // Emit SSE event so the frontend knows to re-inject context for next agent
        crate::agent::globals::emit_event("conflict-next-writer", serde_json::json!({
            "file":         &file,
            "next_agent":   &next_agent,
            "next_session": &next_session,
            "context":      &context,
        }));
        serde_json::json!({ "status": "released", "next_agent": next_agent })
    } else {
        serde_json::json!({ "status": "released", "next_agent": null })
    }
}

/// MCP-exposed: verify a write didn't overlap other agents' lines.
#[tauri::command]
pub fn conflict_verify_write(
    file:     String,
    agent_id: String,
    cwd:      String,
    state:    tauri::State<'_, AppState>,
) -> serde_json::Value {
    let result = verify_write(&state.conflict_registry, &file, &agent_id, &cwd);

    if should_escalate(&state.conflict_registry, &file) {
        let trace = build_conflict_trace(&state.conflict_registry, &file);
        crate::agent::globals::emit_event("conflict-escalate", serde_json::json!({
            "file":  &file,
            "trace": trace,
        }));
    }

    serde_json::to_value(result).unwrap_or_default()
}

/// Frontend: get current conflict state for a file.
#[tauri::command]
pub fn conflict_get_state(
    file:  String,
    state: tauri::State<'_, AppState>,
) -> serde_json::Value {
    build_conflict_trace(&state.conflict_registry, &file)
}

/// Frontend: clear conflict state (user resolved manually).
#[tauri::command]
pub fn conflict_clear(
    file:  String,
    state: tauri::State<'_, AppState>,
) {
    clear_conflict(&state.conflict_registry, &file);
}

/// Called by PTY monitor on process exit — force releases all locks held by session.
pub fn on_session_exit(registry: &ConflictRegistry, session_id: &str, cwd: &str) {
    let notifications = force_release_on_process_exit(registry, session_id, cwd);
    for (file, next_agent, next_session, context) in notifications {
        crate::agent::globals::emit_event("conflict-next-writer", serde_json::json!({
            "file":         file,
            "next_agent":   next_agent,
            "next_session": next_session,
            "context":      context,
            "reason":       "process-exit",
        }));
    }
}