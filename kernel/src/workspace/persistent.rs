// src/workspace/persistent.rs
//
// Persistent agent memory — everything lives in ~/.stackbox/projects/<repo>/
// NOTHING is written to the user's repo.
//
// Layout:
//   ~/.stackbox/projects/<repo>/
//     WORKSPACE.md          ← Stackbox owns: all agents + worktrees
//     GRAPH.md              ← agents write: connections between agents
//     agents/
//       <wt-name>/
//         STATE.md          ← agent writes: task state (resume on reopen)
//         LOG.md            ← agent appends: one line per decision
//
// Rules:
//   - Stackbox writes WORKSPACE.md
//   - Agents write STATE.md, LOG.md, GRAPH.md (via skill instructions)
//   - wt-name == last path segment of git worktree path
//   - STATUS: "in-progress" | "paused" | "done"

use std::path::{Path, PathBuf};

// ── Directory helpers ─────────────────────────────────────────────────────────

/// Root: ~/.stackbox/projects/
fn stackbox_projects_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("stackbox")
        .join("projects")
}

/// Repo name from cwd — includes a short hash of the full path to prevent
/// collision between two repos that share the same folder name.
/// e.g. ~/a/myapp and ~/b/myapp → "myapp-a1b2c3d4" vs "myapp-e5f6a7b8"
fn repo_name(cwd: &str) -> String {
    let base = Path::new(cwd)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    // FNV-1a 32-bit hash of the full path — no dep needed
    let hash: u32 = cwd.bytes().fold(2166136261u32, |acc, b| {
        acc.wrapping_mul(16777619) ^ (b as u32)
    });
    format!("{base}-{hash:08x}")
}

/// Project root: ~/.stackbox/projects/<repo-name>/
pub fn project_dir(cwd: &str) -> PathBuf {
    stackbox_projects_dir().join(repo_name(cwd))
}

/// Agent dir: ~/.stackbox/projects/<repo>/agents/<wt-name>/
pub fn agent_dir(cwd: &str, wt_name: &str) -> PathBuf {
    project_dir(cwd).join("agents").join(wt_name)
}

/// STATE.md path for an agent.
pub fn state_path(cwd: &str, wt_name: &str) -> PathBuf {
    agent_dir(cwd, wt_name).join("STATE.md")
}

/// LOG.md path for an agent.
pub fn log_path(cwd: &str, wt_name: &str) -> PathBuf {
    agent_dir(cwd, wt_name).join("LOG.md")
}

/// WORKSPACE.md path.
pub fn workspace_md_path(cwd: &str) -> PathBuf {
    project_dir(cwd).join("WORKSPACE.md")
}

/// GRAPH.md path.
pub fn graph_md_path(cwd: &str) -> PathBuf {
    project_dir(cwd).join("GRAPH.md")
}

// ── Worktree name from path ───────────────────────────────────────────────────

/// Extract the worktree folder name from its full path.
/// e.g. "/repo/.worktrees/stackbox-wt-abc-def-codex" → "stackbox-wt-abc-def-codex"
pub fn wt_name_from_path(wt_path: &str) -> String {
    Path::new(wt_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(wt_path)
        .to_string()
}

// ── Init ──────────────────────────────────────────────────────────────────────

/// Create the project directory structure.
/// Idempotent — safe to call on every workspace open.
pub fn init_project(cwd: &str) -> Result<(), String> {
    let proj = project_dir(cwd);
    std::fs::create_dir_all(proj.join("agents"))
        .map_err(|e| format!("persistent::init_project: {e}"))?;

    // Create WORKSPACE.md if missing
    let ws = workspace_md_path(cwd);
    if !ws.exists() {
        let repo = repo_name(cwd);
        let now = now_iso();
        let content = format!(
            "# workspace\nrepo: {repo}\npath: {cwd}\ncreated: {now}\n\n## agents\nwt_name | branch | agent | status | wt_path | updated\n---\n"
        );
        std::fs::write(&ws, content).map_err(|e| format!("write WORKSPACE.md: {e}"))?;
    }

    // Create GRAPH.md if missing
    let gp = graph_md_path(cwd);
    if !gp.exists() {
        let repo = repo_name(cwd);
        let content = format!(
            "# graph\nrepo: {repo}\n\n## agents\n## links\n"
        );
        std::fs::write(&gp, content).map_err(|e| format!("write GRAPH.md: {e}"))?;
    }

    eprintln!("[persistent] project dir ready: {}", proj.display());
    Ok(())
}

// ── Agent registration ────────────────────────────────────────────────────────

/// Register (or update) an agent in WORKSPACE.md.
/// Creates the agent's dir, writes initial STATE.md if not yet present.
pub fn register_agent(
    cwd: &str,
    wt_name: &str,
    branch: &str,
    agent_kind: &str,
    wt_path: &str,
) -> Result<(), String> {
    // Ensure agent dir exists
    let adir = agent_dir(cwd, wt_name);
    std::fs::create_dir_all(&adir)
        .map_err(|e| format!("mkdir agent_dir: {e}"))?;

    // Write initial STATE.md if not present (agent will fill it in)
    let sp = state_path(cwd, wt_name);
    if !sp.exists() {
        let now = now_iso();
        let content = format!(
            "# state\nagent: {agent_kind}\nbranch: {branch}\nworktree: {wt_path}\nstatus: in-progress\nupdated: {now}\n\n## doing\n-\n\n## done\n-\n\n## blocked\n-\n"
        );
        std::fs::write(&sp, content).map_err(|e| format!("write STATE.md: {e}"))?;
    }

    // Write initial LOG.md if not present
    let lp = log_path(cwd, wt_name);
    if !lp.exists() {
        std::fs::write(&lp, "").map_err(|e| format!("write LOG.md: {e}"))?;
    }

    // Update WORKSPACE.md
    update_workspace_md(cwd, wt_name, branch, agent_kind, wt_path, "in-progress")
}

/// Update WORKSPACE.md — add or update the agent's row.
fn update_workspace_md(
    cwd: &str,
    wt_name: &str,
    branch: &str,
    agent_kind: &str,
    wt_path: &str,
    status: &str,
) -> Result<(), String> {
    let ws = workspace_md_path(cwd);
    let existing = std::fs::read_to_string(&ws).unwrap_or_default();
    let now = now_iso();

    let new_row = format!(
        "{wt_name} | {branch} | {agent_kind} | {status} | {wt_path} | {now}"
    );

    // Split at separator line
    let (header, rows_raw) = if let Some(sep) = existing.find("---\n") {
        (&existing[..sep + 4], &existing[sep + 4..])
    } else {
        (existing.as_str(), "")
    };

    // Replace existing row for this wt_name or append
    let mut rows: Vec<String> = rows_raw
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| l.to_string())
        .collect();

    let existing_idx = rows.iter().position(|r| r.starts_with(wt_name));
    if let Some(idx) = existing_idx {
        rows[idx] = new_row;
    } else {
        rows.push(new_row);
    }

    let updated = format!("{}{}\n", header, rows.join("\n"));
    std::fs::write(&ws, updated).map_err(|e| format!("update WORKSPACE.md: {e}"))
}

/// Update the status of an agent in WORKSPACE.md + STATE.md.
/// Called when PTY ends (→ "paused") or explicitly done (→ "done").
pub fn update_agent_status(cwd: &str, wt_name: &str, status: &str) {
    // Update WORKSPACE.md row status field
    let ws = workspace_md_path(cwd);
    if let Ok(content) = std::fs::read_to_string(&ws) {
        let updated = content
            .lines()
            .map(|line| {
                if line.starts_with(wt_name) {
                    // Replace 4th pipe-separated field (status)
                    let parts: Vec<&str> = line.splitn(6, " | ").collect();
                    if parts.len() >= 6 {
                        let now = now_iso();
                        format!(
                            "{} | {} | {} | {} | {} | {}",
                            parts[0], parts[1], parts[2], status, parts[4], now
                        )
                    } else {
                        line.to_string()
                    }
                } else {
                    line.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join("\n")
            + "\n";
        let _ = std::fs::write(&ws, updated);
    }

    // Update STATE.md status line
    let sp = state_path(cwd, wt_name);
    if let Ok(content) = std::fs::read_to_string(&sp) {
        let now = now_iso();
        let updated = content
            .lines()
            .map(|line| {
                if line.starts_with("status:") {
                    format!("status: {status}")
                } else if line.starts_with("updated:") {
                    format!("updated: {now}")
                } else {
                    line.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join("\n")
            + "\n";
        let _ = std::fs::write(&sp, updated);
    }
}

// ── Read helpers ──────────────────────────────────────────────────────────────

/// Read STATE.md for an agent. Returns None if not found.
pub fn read_agent_state(cwd: &str, wt_name: &str) -> Option<String> {
    std::fs::read_to_string(state_path(cwd, wt_name)).ok()
}

/// Read WORKSPACE.md.
pub fn read_workspace(cwd: &str) -> String {
    std::fs::read_to_string(workspace_md_path(cwd)).unwrap_or_default()
}

// ── Active agent list ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AgentEntry {
    pub wt_name: String,
    pub branch: String,
    pub agent_kind: String,
    pub status: String,
    pub wt_path: String,
    pub updated: String,
}

/// List all agents with status "in-progress" or "paused" from WORKSPACE.md.
pub fn list_active_agents(cwd: &str) -> Vec<AgentEntry> {
    let content = read_workspace(cwd);
    let sep_pos = content.find("---\n");
    let rows_raw = sep_pos
        .map(|p| &content[p + 4..])
        .unwrap_or("");

    rows_raw
        .lines()
        .filter(|l| !l.is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(6, " | ").collect();
            if parts.len() < 6 {
                return None;
            }
            let status = parts[3].trim().to_string();
            if status == "done" {
                return None;
            }
            Some(AgentEntry {
                wt_name: parts[0].trim().to_string(),
                branch: parts[1].trim().to_string(),
                agent_kind: parts[2].trim().to_string(),
                status,
                wt_path: parts[4].trim().to_string(),
                updated: parts[5].trim().to_string(),
            })
        })
        .collect()
}

/// Same as list_active_agents but returns ALL agents including done.
pub fn list_all_agents(cwd: &str) -> Vec<AgentEntry> {
    let content = read_workspace(cwd);
    let sep_pos = content.find("---\n");
    let rows_raw = sep_pos
        .map(|p| &content[p + 4..])
        .unwrap_or("");

    rows_raw
        .lines()
        .filter(|l| !l.is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(6, " | ").collect();
            if parts.len() < 6 {
                return None;
            }
            Some(AgentEntry {
                wt_name: parts[0].trim().to_string(),
                branch: parts[1].trim().to_string(),
                agent_kind: parts[2].trim().to_string(),
                status: parts[3].trim().to_string(),
                wt_path: parts[4].trim().to_string(),
                updated: parts[5].trim().to_string(),
            })
        })
        .collect()
}

// ── Skill builder ─────────────────────────────────────────────────────────────
//
// The skill is injected into every agent session via the per-agent context file.
// It is intentionally short — every line costs tokens on every resume.
// Target: ~80 tokens total.

pub fn build_skill(cwd: &str, wt_name: &str, wt_path: &str, branch: &str) -> String {
    let sp = state_path(cwd, wt_name);
    let lp = log_path(cwd, wt_name);
    let gp = graph_md_path(cwd);
    let wp = workspace_md_path(cwd);

    // Read existing STATE.md if present (resume context, ~15 lines max)
    let state_block = if let Some(state) = read_agent_state(cwd, wt_name) {
        let trimmed: String = state
            .lines()
            .take(20)
            .collect::<Vec<_>>()
            .join("\n");
        format!("\n## Last State\n```\n{trimmed}\n```\n")
    } else {
        String::new()
    };

    format!(
        "## Stackbox Persistent Memory\n\
         \n\
         worktree: {wt_path}\n\
         branch:   {branch}\n\
         \n\
         state: {state_display}\n\
         log:   {log_display}\n\
         graph: {graph_display}\n\
         workspace: {ws_display}\n\
         {state_block}\n\
         ## Rules\n\
         - ON START: read state file — if exists resume from it, else create it\n\
         - DURING WORK: update state after each action; append one line to log per decision\n\
         - LOG FORMAT: `- [timestamp] action — reason`\n\
         - ON FINISH: set `status: done` in state\n\
         - NEVER write these files into the user repo\n\
         - NEVER create a new worktree if yours exists — read state and resume\n\
         - Update graph if you detect overlap with another agent\n",
        state_display = sp.display(),
        log_display = lp.display(),
        graph_display = gp.display(),
        ws_display = wp.display(),
    )
}

// ── Global session registry ───────────────────────────────────────────────────
//
// Maps runbox_id → (cwd, wt_name) so the injector can look up skill context.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

static SESSION_REGISTRY: OnceLock<Mutex<HashMap<String, (String, String)>>> = OnceLock::new();

fn session_registry() -> &'static Mutex<HashMap<String, (String, String)>> {
    SESSION_REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Register runbox_id → (cwd, wt_name). Called from pty_spawn after worktree creation.
pub fn register_session(runbox_id: &str, cwd: &str, wt_name: &str) {
    if let Ok(mut map) = session_registry().lock() {
        map.insert(
            runbox_id.to_string(),
            (cwd.to_string(), wt_name.to_string()),
        );
    }
}

/// Deregister a session on PTY kill.
pub fn deregister_session(runbox_id: &str) {
    if let Ok(mut map) = session_registry().lock() {
        map.remove(runbox_id);
    }
}

/// Get (cwd, wt_name) for a runbox. Returns None if not registered.
pub fn get_session_info(runbox_id: &str) -> Option<(String, String)> {
    session_registry()
        .lock()
        .ok()
        .and_then(|map| map.get(runbox_id).cloned())
}

/// Build the skill section for injection into agent context.
/// Returns empty string if this runbox has no registered worktree.
pub fn build_skill_for_runbox(runbox_id: &str, wt_path: &str, branch: &str) -> String {
    let info = match get_session_info(runbox_id) {
        Some(i) => i,
        None => return String::new(),
    };
    let (cwd, wt_name) = info;
    build_skill(&cwd, &wt_name, wt_path, branch)
}

// ── Auto-resume on workspace open ─────────────────────────────────────────────

/// Returns agents that were in-progress and whose worktree still exists on disk.
/// Stackbox calls this on workspace open to auto-resume agents.
pub fn agents_to_resume(cwd: &str) -> Vec<AgentEntry> {
    list_active_agents(cwd)
        .into_iter()
        .filter(|a| {
            // Only resume if worktree actually exists on disk
            Path::new(&a.wt_path).exists()
        })
        .collect()
}

// ── Utility ───────────────────────────────────────────────────────────────────

fn now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    // Manual Gregorian calendar from Unix epoch — no chrono needed.
    // Accurate for dates 1970–2100.
    let s = secs % 60;
    let m = (secs / 60) % 60;
    let h = (secs / 3600) % 24;
    let mut days = secs / 86400;

    let mut year = 1970u32;
    loop {
        let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
        let days_in_year = if leap { 366 } else { 365 };
        if days < days_in_year {
            break;
        }
        days -= days_in_year;
        year += 1;
    }

    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let month_days = [31u64, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut month = 1u32;
    for &md in &month_days {
        if days < md {
            break;
        }
        days -= md;
        month += 1;
    }
    let day = days + 1;

    format!("{year}-{month:02}-{day:02}T{h:02}:{m:02}:{s:02}Z")
}