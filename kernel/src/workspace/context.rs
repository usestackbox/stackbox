// src/workspace/persistent.rs
//
// Persistent agent memory — everything lives in AppData / home.
// NOTHING is written to the user's repo.
//
// Layout:
//   AppData:  <appdata>/calus/<hash>/
//               WORKSPACE.md   ← Calus registry: all branches + worktrees
//               GRAPH.md       ← agents write: cross-agent connections
//               MEMORY.md      ← cross-agent memory index (first 200 lines loaded)
//               memory/        ← topic files written by agents on demand
//                 debugging.md
//                 patterns.md
//                 commands.md
//                 <any>.md
//               agents/
//                 <runbox_id>/
//                   CONTEXT.md ← kernel writes at spawn
//
//   Worktrees (OUTSIDE repo):  <appdata>/calus/<hash>/.worktrees/<agent_kind>-<slug>/
//                                 STATE.md   ← agent writes (strict key:value)
//                                 LOG.md     ← agent appends one line/action
//
// Hash is FNV of the full cwd path — stable even when user renames
// the workspace display name in the frontend.

use std::path::{Path, PathBuf};

// ── Memory constants ──────────────────────────────────────────────────────────

/// Maximum number of lines loaded from MEMORY.md into context per session.
/// Matches Claude Code's behaviour — keeps the context footprint predictable.
pub const MEMORY_LINE_LIMIT: usize = 200;
/// Maximum bytes loaded from MEMORY.md regardless of line count.
pub const MEMORY_BYTE_LIMIT: usize = 25 * 1024;

// ── Directory helpers ─────────────────────────────────────────────────────────

/// AppData dir: <appdata>/calus/
fn calus_appdata() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("calus")
}

/// Home worktrees dir: ~/calus/
fn calus_home() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("calus")
}

/// FNV-1a hash of cwd — used as the unique project key.
fn repo_hash(cwd: &str) -> String {
    let h: u32 = cwd.bytes().fold(2166136261u32, |acc, b| {
        acc.wrapping_mul(16777619) ^ (b as u32)
    });
    format!("{h:08x}")
}

/// AppData project dir: <appdata>/calus/<hash>/
pub fn project_dir(cwd: &str) -> PathBuf {
    calus_appdata().join(repo_hash(cwd))
}

/// Worktrees base: <appdata>/calus/<hash>/.worktrees/
pub fn worktrees_base(cwd: &str) -> PathBuf {
    calus_appdata().join(repo_hash(cwd)).join(".worktrees")
}

/// Agent context dir — CONTEXT.md written here by kernel at spawn.
pub fn agent_dir(cwd: &str, runbox_id: &str) -> PathBuf {
    project_dir(cwd).join("agents").join(runbox_id)
}

/// STATE.md lives inside the worktree dir.
pub fn state_path(cwd: &str, wt_name: &str) -> PathBuf {
    worktrees_base(cwd).join(wt_name).join("STATE.md")
}

/// LOG.md lives inside the worktree dir.
pub fn log_path(cwd: &str, wt_name: &str) -> PathBuf {
    worktrees_base(cwd).join(wt_name).join("LOG.md")
}

pub fn workspace_md_path(cwd: &str) -> PathBuf {
    project_dir(cwd).join("WORKSPACE.md")
}

pub fn graph_md_path(cwd: &str) -> PathBuf {
    project_dir(cwd).join("GRAPH.md")
}

// ── Memory paths ──────────────────────────────────────────────────────────────

/// MEMORY.md — cross-agent shared index.
/// First MEMORY_LINE_LIMIT lines (or MEMORY_BYTE_LIMIT bytes) are injected
/// into every agent session automatically.
pub fn memory_md_path(cwd: &str) -> PathBuf {
    project_dir(cwd).join("MEMORY.md")
}

/// memory/ directory — topic files live here, loaded on demand by agents.
pub fn memory_dir(cwd: &str) -> PathBuf {
    project_dir(cwd).join("memory")
}

/// Path for a named topic file: memory/<name>.md
/// Sanitises the name to prevent path traversal.
pub fn memory_topic_path(cwd: &str, name: &str) -> PathBuf {
    let safe = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>();
    let safe = safe.trim_matches('-').to_string();
    memory_dir(cwd).join(format!("{safe}.md"))
}

/// Extract the worktree dir name from its full path.
pub fn wt_name_from_path(wt_path: &str) -> String {
    Path::new(wt_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(wt_path)
        .to_string()
}

// ── Init ──────────────────────────────────────────────────────────────────────

pub fn init_project(cwd: &str) -> Result<(), String> {
    let proj = project_dir(cwd);

    std::fs::create_dir_all(proj.join("agents"))
        .map_err(|e| format!("persistent::init agents: {e}"))?;

    std::fs::create_dir_all(worktrees_base(cwd))
        .map_err(|e| format!("persistent::init .worktrees: {e}"))?;

    std::fs::create_dir_all(memory_dir(cwd))
        .map_err(|e| format!("persistent::init memory/: {e}"))?;

    let ws = workspace_md_path(cwd);
    if !ws.exists() {
        let hash = repo_hash(cwd);
        let now = now_iso();
        let content = format!(
            "# workspace\nhash: {hash}\npath: {cwd}\ncreated: {now}\n\n## branches\nwt_name | branch | agent | status | wt_path | updated\n---\n"
        );
        std::fs::write(&ws, content).map_err(|e| format!("write WORKSPACE.md: {e}"))?;
    }

    let gp = graph_md_path(cwd);
    if !gp.exists() {
        let hash = repo_hash(cwd);
        let content = format!("# graph\nhash: {hash}\n\n## agents\n## links\n");
        std::fs::write(&gp, content).map_err(|e| format!("write GRAPH.md: {e}"))?;
    }

    init_memory(cwd)?;

    eprintln!("[persistent] ready: {}", proj.display());
    Ok(())
}

/// Create MEMORY.md with a starter template if it doesn't exist.
pub fn init_memory(cwd: &str) -> Result<(), String> {
    let mp = memory_md_path(cwd);
    if !mp.exists() {
        let now = now_iso();
        let content = format!(
            "# Calus Memory\n\
             <!-- cross-agent: all agents read and write this file -->\n\
             <!-- first {MEMORY_LINE_LIMIT} lines are injected into every session -->\n\
             updated: {now}\n\
             \n\
             ## commands\n\
             <!-- add build/test/run commands here as agents discover them -->\n\
             \n\
             ## learnings\n\
             <!-- format: - [<agent> <date>] <insight> -->\n\
             \n\
             ## topics\n\
             <!-- topic files in memory/ are loaded on demand, not at session start -->\n\
             <!-- add entries like: - debugging → memory/debugging.md -->\n"
        );
        std::fs::write(&mp, content).map_err(|e| format!("write MEMORY.md: {e}"))?;
    }
    Ok(())
}

// ── Memory read / write ───────────────────────────────────────────────────────

/// Read the first MEMORY_LINE_LIMIT lines (or MEMORY_BYTE_LIMIT bytes) of
/// MEMORY.md for injection into agent context.
pub fn read_memory_index(cwd: &str) -> String {
    let raw = match std::fs::read_to_string(memory_md_path(cwd)) {
        Ok(s) => s,
        Err(_) => return String::new(),
    };

    // Apply both limits — whichever is hit first.
    let mut byte_count = 0usize;
    let mut lines_taken = 0usize;
    let mut out = String::new();

    for line in raw.lines() {
        let line_bytes = line.len() + 1; // +1 for newline
        if lines_taken >= MEMORY_LINE_LIMIT || byte_count + line_bytes > MEMORY_BYTE_LIMIT {
            out.push_str(&format!(
                "\n<!-- memory truncated at {lines_taken} lines / {byte_count} bytes -->"
            ));
            break;
        }
        out.push_str(line);
        out.push('\n');
        byte_count += line_bytes;
        lines_taken += 1;
    }

    out
}

/// Append a single learning entry to the `## learnings` section of MEMORY.md.
/// Entry is attributed with the agent kind and the current timestamp.
/// Automatically trims MEMORY.md if it would exceed MEMORY_LINE_LIMIT * 2.
pub fn append_memory_learning(cwd: &str, agent_kind: &str, learning: &str) -> Result<(), String> {
    let mp = memory_md_path(cwd);
    let raw = std::fs::read_to_string(&mp).unwrap_or_default();
    let now = now_date();

    // Sanitise: strip newlines from the learning itself
    let clean = learning.lines().next().unwrap_or("").trim().to_string();
    if clean.is_empty() {
        return Ok(());
    }
    let entry = format!("- [{agent_kind} {now}] {clean}");

    // Insert after the `## learnings` header
    let updated = if let Some(idx) = raw.find("## learnings") {
        let after = &raw[idx..];
        if let Some(newline) = after.find('\n') {
            let insert_pos = idx + newline + 1;
            format!("{}{}\n{}", &raw[..insert_pos], entry, &raw[insert_pos..])
        } else {
            format!("{raw}\n{entry}\n")
        }
    } else {
        format!("{raw}\n## learnings\n{entry}\n")
    };

    // Update the `updated:` timestamp
    let updated = update_memory_timestamp(&updated);

    // Trim if the file is getting too long (> 2x the line limit)
    let updated = trim_memory_learnings(&updated, MEMORY_LINE_LIMIT * 2);

    std::fs::write(&mp, updated).map_err(|e| format!("append MEMORY.md: {e}"))
}

/// Set or replace a key→value entry in the `## commands` section.
/// Useful for agents to record discovered build/test/lint commands.
pub fn set_memory_command(cwd: &str, key: &str, value: &str) -> Result<(), String> {
    let mp = memory_md_path(cwd);
    let raw = std::fs::read_to_string(&mp).unwrap_or_default();

    let entry = format!("- {key}: `{value}`");

    // Remove any existing line with this key under ## commands
    let lines: Vec<&str> = raw.lines().collect();
    let mut in_commands = false;
    let mut replaced = false;
    let mut out_lines: Vec<String> = Vec::with_capacity(lines.len() + 1);

    for line in &lines {
        if *line == "## commands" {
            in_commands = true;
            out_lines.push(line.to_string());
            continue;
        }
        if in_commands && line.starts_with("## ") {
            // End of commands section — insert if not replaced yet
            if !replaced {
                out_lines.push(entry.clone());
                replaced = true;
            }
            in_commands = false;
        }
        if in_commands && line.starts_with(&format!("- {key}:")) {
            out_lines.push(entry.clone());
            replaced = true;
            continue;
        }
        out_lines.push(line.to_string());
    }

    if !replaced {
        // Append to end
        out_lines.push(format!("\n## commands\n{entry}"));
    }

    let updated = update_memory_timestamp(&out_lines.join("\n"));
    std::fs::write(&mp, updated).map_err(|e| format!("set_memory_command: {e}"))
}

/// Read a topic file from memory/ by name (without .md extension).
/// Returns None if the file doesn't exist.
pub fn read_memory_topic(cwd: &str, name: &str) -> Option<String> {
    std::fs::read_to_string(memory_topic_path(cwd, name)).ok()
}

/// Write (create or replace) a topic file in memory/.
pub fn write_memory_topic(cwd: &str, name: &str, content: &str) -> Result<(), String> {
    let _ = std::fs::create_dir_all(memory_dir(cwd));
    let path = memory_topic_path(cwd, name);
    std::fs::write(&path, content).map_err(|e| format!("write memory topic {name}: {e}"))
}

/// Append content to a topic file, creating it if needed.
pub fn append_memory_topic(cwd: &str, name: &str, content: &str) -> Result<(), String> {
    let _ = std::fs::create_dir_all(memory_dir(cwd));
    let path = memory_topic_path(cwd, name);
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let updated = if existing.is_empty() {
        content.to_string()
    } else {
        format!("{existing}\n{content}")
    };
    std::fs::write(&path, updated).map_err(|e| format!("append memory topic {name}: {e}"))
}

/// List all topic files in memory/ (names without .md extension).
pub fn list_memory_topics(cwd: &str) -> Vec<String> {
    let dir = memory_dir(cwd);
    std::fs::read_dir(&dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if name.ends_with(".md") {
                Some(name.trim_end_matches(".md").to_string())
            } else {
                None
            }
        })
        .collect()
}

/// Auto-feed from a session summary: extract learnings and append them to MEMORY.md.
/// Called after `calus_session_summary` so every session's insights persist cross-agent.
pub fn feed_session_to_memory(
    cwd: &str,
    agent_kind: &str,
    goal: &str,
    done: &str,
    blocked: &str,
) -> Result<(), String> {
    // Append the goal as a learning if meaningful
    if !goal.trim().is_empty() && goal.trim() != "-" {
        append_memory_learning(cwd, agent_kind, &format!("completed: {goal}"))?;
    }
    // Append blockers so other agents know about them
    if !blocked.trim().is_empty() && blocked.trim() != "-" && blocked.trim() != "none" {
        append_memory_learning(cwd, agent_kind, &format!("blocker: {blocked}"))?;
    }
    // Append done items (first one, to keep it concise)
    if !done.trim().is_empty() && done.trim() != "-" {
        let first_done = done.split(',').next().unwrap_or(done).trim();
        if !first_done.is_empty() {
            append_memory_learning(cwd, agent_kind, &format!("done: {first_done}"))?;
        }
    }
    Ok(())
}

// ── Memory helpers ─────────────────────────────────────────────────────────────

fn update_memory_timestamp(content: &str) -> String {
    let now = now_iso();
    let lines: Vec<String> = content
        .lines()
        .map(|l| {
            if l.starts_with("updated:") {
                format!("updated: {now}")
            } else {
                l.to_string()
            }
        })
        .collect();
    lines.join("\n") + "\n"
}

/// Trim the `## learnings` section to keep only the most recent `max_lines`
/// total lines in the file. Oldest learnings (lowest in the list) are removed.
fn trim_memory_learnings(content: &str, max_lines: usize) -> String {
    let lines: Vec<&str> = content.lines().collect();
    if lines.len() <= max_lines {
        return content.to_string();
    }

    // Find the learnings section range
    let learn_start = lines.iter().position(|l| *l == "## learnings");
    let Some(ls) = learn_start else {
        return content.to_string();
    };

    // Find end of learnings section
    let learn_end = lines[ls + 1..]
        .iter()
        .position(|l| l.starts_with("## "))
        .map(|i| ls + 1 + i)
        .unwrap_or(lines.len());

    let excess = lines.len().saturating_sub(max_lines);
    // Remove `excess` entries from the bottom of the learnings section
    let entries_start = ls + 1;
    let entries: Vec<&str> = lines[entries_start..learn_end]
        .iter()
        .filter(|l| l.starts_with("- ["))
        .copied()
        .collect();

    let keep = entries.len().saturating_sub(excess);
    let kept_entries: Vec<&str> = entries[entries.len() - keep..].to_vec();

    let mut out: Vec<&str> = Vec::new();
    out.extend_from_slice(&lines[..entries_start]);
    out.extend_from_slice(&kept_entries);
    out.extend_from_slice(&lines[learn_end..]);
    out.join("\n") + "\n"
}

// ── Agent registration ────────────────────────────────────────────────────────

pub fn register_agent(
    cwd: &str,
    wt_name: &str,
    branch: &str,
    agent_kind: &str,
    wt_path: &str,
) -> Result<(), String> {
    let sp = state_path(cwd, wt_name);
    if let Some(parent) = sp.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir worktree dir: {e}"))?;
    }
    if !sp.exists() {
        let now = now_iso();
        let content = format!(
            "# state\n\
             agent: {agent_kind}\n\
             branch: {branch}\n\
             worktree: {wt_path}\n\
             status: in-progress\n\
             updated: {now}\n\
             \n\
             ## doing\n\
             - \n\
             \n\
             ## next\n\
             - \n\
             \n\
             ## blocked\n\
             - \n\
             \n\
             ## done\n\
             - \n\
             \n\
             ## notes\n\
             Free-form observations go here only — not above.\n"
        );
        std::fs::write(&sp, content).map_err(|e| format!("write STATE.md: {e}"))?;
    }

    let lp = log_path(cwd, wt_name);
    if !lp.exists() {
        std::fs::write(&lp, "").map_err(|e| format!("write LOG.md: {e}"))?;
    }

    update_workspace_md(cwd, wt_name, branch, agent_kind, wt_path, "in-progress")
}

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

    let new_row = format!("{wt_name} | {branch} | {agent_kind} | {status} | {wt_path} | {now}");

    let (header, rows_raw) = if let Some(sep) = existing.find("---\n") {
        (&existing[..sep + 4], &existing[sep + 4..])
    } else {
        (existing.as_str(), "")
    };

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

    let updated = format!("{}{}\\n", header, rows.join("\n"));
    std::fs::write(&ws, updated).map_err(|e| format!("update WORKSPACE.md: {e}"))
}

pub fn update_agent_status(cwd: &str, wt_name: &str, status: &str) {
    let ws = workspace_md_path(cwd);
    if let Ok(content) = std::fs::read_to_string(&ws) {
        let now = now_iso();
        let updated = content
            .lines()
            .map(|line| {
                if line.starts_with(wt_name) {
                    let parts: Vec<&str> = line.splitn(6, " | ").collect();
                    if parts.len() >= 6 {
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

pub fn read_agent_state(cwd: &str, wt_name: &str) -> Option<String> {
    std::fs::read_to_string(state_path(cwd, wt_name)).ok()
}

pub fn read_workspace(cwd: &str) -> String {
    std::fs::read_to_string(workspace_md_path(cwd)).unwrap_or_default()
}

// ── Agent/Branch list ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AgentEntry {
    pub wt_name: String,
    pub branch: String,
    pub agent_kind: String,
    pub status: String,
    pub wt_path: String,
    pub updated: String,
}

pub fn list_active_agents(cwd: &str) -> Vec<AgentEntry> {
    parse_workspace_rows(cwd)
        .into_iter()
        .filter(|e| e.status != "done")
        .collect()
}

pub fn list_all_agents(cwd: &str) -> Vec<AgentEntry> {
    parse_workspace_rows(cwd)
}

fn parse_workspace_rows(cwd: &str) -> Vec<AgentEntry> {
    let content = read_workspace(cwd);
    let rows_raw = content
        .find("---\n")
        .map(|p| &content[p + 4..])
        .unwrap_or("");
    rows_raw
        .lines()
        .filter(|l| !l.is_empty())
        .filter_map(|line| {
            let p: Vec<&str> = line.splitn(6, " | ").collect();
            if p.len() < 6 {
                return None;
            }
            Some(AgentEntry {
                wt_name: p[0].trim().to_string(),
                branch: p[1].trim().to_string(),
                agent_kind: p[2].trim().to_string(),
                status: p[3].trim().to_string(),
                wt_path: p[4].trim().to_string(),
                updated: p[5].trim().to_string(),
            })
        })
        .collect()
}

// ── Skill builder ─────────────────────────────────────────────────────────────

pub fn build_skill(cwd: &str, wt_name: &str, wt_path: &str, branch: &str) -> String {
    let sp = state_path(cwd, wt_name);
    let lp = log_path(cwd, wt_name);
    let gp = graph_md_path(cwd);
    let wp = workspace_md_path(cwd);
    let mp = memory_md_path(cwd);

    let state_signal = read_agent_state(cwd, wt_name)
        .map(|s| crate::agent::injector::extract_state_signal(&s))
        .unwrap_or_default();

    let state_block = if !state_signal.is_empty() {
        format!("\n## Last State\n{state_signal}\n")
    } else {
        String::new()
    };

    format!(
        "## Calus Persistent Memory\n\
         \n\
         worktree: {wt_path}\n\
         branch:   {branch}\n\
         \n\
         state:     {st}\n\
         log:       {lg}\n\
         memory:    {mem}\n\
         graph:     {gph}\n\
         workspace: {ws}\n\
         {state_block}\n\
         ## Rules\n\
         - ON START: read state file — resume from it if exists\n\
         - STATE FORMAT: keep status/doing/next/blocked as single key: value lines\n\
         - DURING WORK: update state after each action; append one line to log\n\
         - LOG FORMAT: `- [timestamp] action — reason`\n\
         - SESSION SUMMARY: goal: X / done: Y / blocked: Z / next: W\n\
         - ON FINISH: set `status: done` in state\n\
         - MEMORY: use calus_memory_append to record learnings; calus_memory_read to recall\n\
         - NEVER write these files into the user repo\n\
         - NEVER create a new worktree if yours exists — read state and resume\n",
        st = sp.display(),
        lg = lp.display(),
        mem = mp.display(),
        gph = gp.display(),
        ws = wp.display(),
    )
}

// ── Global session registry ───────────────────────────────────────────────────

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

static SESSION_REGISTRY: OnceLock<Mutex<HashMap<String, (String, String)>>> = OnceLock::new();

fn session_registry() -> &'static Mutex<HashMap<String, (String, String)>> {
    SESSION_REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn register_session(runbox_id: &str, cwd: &str, wt_name: &str) {
    if let Ok(mut map) = session_registry().lock() {
        map.insert(
            runbox_id.to_string(),
            (cwd.to_string(), wt_name.to_string()),
        );
    }
}

pub fn deregister_session(runbox_id: &str) {
    if let Ok(mut map) = session_registry().lock() {
        map.remove(runbox_id);
    }
}

pub fn get_session_info(runbox_id: &str) -> Option<(String, String)> {
    session_registry()
        .lock()
        .ok()
        .and_then(|map| map.get(runbox_id).cloned())
}

pub fn build_skill_for_runbox(runbox_id: &str, wt_path: &str, branch: &str) -> String {
    let Some((cwd, wt_name)) = get_session_info(runbox_id) else {
        return String::new();
    };
    build_skill(&cwd, &wt_name, wt_path, branch)
}

// ── Auto-resume ───────────────────────────────────────────────────────────────

pub fn agents_to_resume(cwd: &str) -> Vec<AgentEntry> {
    list_active_agents(cwd)
        .into_iter()
        .filter(|a| Path::new(&a.wt_path).exists())
        .collect()
}

// ── Utility ───────────────────────────────────────────────────────────────────

fn now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format_secs(secs, true)
}

fn now_date() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format_secs(secs, false)
}

fn format_secs(secs: u64, with_time: bool) -> String {
    let s = secs % 60;
    let m = (secs / 60) % 60;
    let h = (secs / 3600) % 24;
    let mut days = secs / 86400;
    let mut year = 1970u32;
    loop {
        let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
        let dy = if leap { 366 } else { 365 };
        if days < dy {
            break;
        }
        days -= dy;
        year += 1;
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let month_days = [
        31u64,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    let mut month = 1u32;
    for &md in &month_days {
        if days < md {
            break;
        }
        days -= md;
        month += 1;
    }
    let day = days + 1;
    if with_time {
        format!("{year}-{month:02}-{day:02}T{h:02}:{m:02}:{s:02}Z")
    } else {
        format!("{year}-{month:02}-{day:02}")
    }
}
