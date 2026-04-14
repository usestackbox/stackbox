// src/workspace/persistent.rs
//
// Persistent agent memory — everything lives in AppData/local, never in the repo.
//
// Platform paths:
//   Windows : %LOCALAPPDATA%\calus\<hash>\
//   macOS   : ~/Library/Application Support/calus/<hash>/
//   Linux   : ~/.local/share/calus/<hash>/
//   Fallback: ~/.calus/<hash>/   (containers, CI, no XDG)
//
// Layout:
//   <appdata>/calus/<hash>/
//     WORKSPACE.md          — Calus registry: all branches + worktrees
//     GRAPH.md              — agents write: cross-agent connections
//     agents/<runbox_id>/
//       CONTEXT.md          — kernel writes at spawn
//
//   Worktrees (OUTSIDE repo, OUTSIDE appdata):
//   <appdata>/calus/<hash>/.worktrees/<agent_kind>-<slug>/
//     STATE.md              — agent writes (strict key:value)
//     LOG.md                — agent appends one line per action
//
// Hash is FNV-1a of the full cwd path — stable even if user renames
// the workspace display name in the frontend.

use std::io::Write;
use std::path::{Path, PathBuf};

// ── Directory helpers ─────────────────────────────────────────────────────────

/// Base Calus AppData dir.
///
/// Resolution order:
///   1. dirs::data_local_dir()  — standard per-platform AppData/local
///   2. dirs::home_dir()/.calus — fallback for containers / minimal Linux
///   3. std::env::temp_dir()/calus — last resort so we never return "."
fn calus_appdata() -> PathBuf {
    // Reject the "." fallback that dirs returns on headless/container systems.
    let from_dirs = dirs::data_local_dir().filter(|p| p != &PathBuf::from("."));

    let base = from_dirs
        .or_else(|| dirs::home_dir().map(|h| h.join(".calus-data")))
        .unwrap_or_else(|| std::env::temp_dir().join("calus-data"));

    base.join("calus")
}

/// FNV-1a hash of cwd — used as the unique project key.
fn repo_hash(cwd: &str) -> String {
    let h: u32 = cwd
        .bytes()
        .fold(2_166_136_261u32, |acc, b| acc.wrapping_mul(16_777_619) ^ b as u32);
    format!("{h:08x}")
}

/// AppData project dir: <appdata>/calus/<hash>/
pub fn project_dir(cwd: &str) -> PathBuf {
    calus_appdata().join(repo_hash(cwd))
}

/// Worktrees base: <appdata>/calus/<hash>/.worktrees/
///
/// Kept inside AppData (not ~/calus) so it is always disjoint from any
/// user workspace, even when the workspace lives inside the home directory.
pub fn worktrees_base(cwd: &str) -> PathBuf {
    project_dir(cwd).join(".worktrees")
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

    let ws = workspace_md_path(cwd);
    if !ws.exists() {
        let hash = repo_hash(cwd);
        let now  = now_iso();
        let content = format!(
            "# workspace\nhash: {hash}\npath: {cwd}\ncreated: {now}\n\n\
             ## branches\nwt_name | branch | agent | status | wt_path | updated\n---\n"
        );
        std::fs::write(&ws, content).map_err(|e| format!("write WORKSPACE.md: {e}"))?;
    }

    let gp = graph_md_path(cwd);
    if !gp.exists() {
        let hash    = repo_hash(cwd);
        let content = format!("# graph\nhash: {hash}\n\n## agents\n## links\n");
        std::fs::write(&gp, content).map_err(|e| format!("write GRAPH.md: {e}"))?;
    }

    // Keep Calus / Codex runtime folders out of git history.
    update_gitignore(cwd);

    eprintln!("[persistent] ready: {}", proj.display());
    Ok(())
}

/// Append Calus-specific entries to <cwd>/.gitignore if not already present.
/// Prevents .codex/, .agents/, AGENTS.md from being committed to the repo.
fn update_gitignore(cwd: &str) {
    let gitignore_path = Path::new(cwd).join(".gitignore");

    let existing = std::fs::read_to_string(&gitignore_path).unwrap_or_default();

    let entries: &[&str] = &[
        "# Calus agent runtime — do not commit",
        ".codex/",
        ".agents/",
        "AGENTS.md",
        ".calus/",
        "calus-state",
    ];

    let to_add: Vec<&str> = entries
        .iter()
        .filter(|&&e| !existing.contains(e))
        .copied()
        .collect();

    if to_add.is_empty() {
        return;
    }

    // Ensure blank separator before our block if the file has content.
    let prefix = if !existing.is_empty() && !existing.ends_with('\n') {
        "\n"
    } else {
        ""
    };

    let block = format!("{}{}\n", prefix, to_add.join("\n"));

    match std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&gitignore_path)
        .and_then(|mut f| f.write_all(block.as_bytes()))
    {
        Ok(_)  => eprintln!("[persistent] updated .gitignore: {}", gitignore_path.display()),
        Err(e) => eprintln!("[persistent] could not update .gitignore: {e}"),
    }
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
        let now     = now_iso();
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
    let ws      = workspace_md_path(cwd);
    let existing = std::fs::read_to_string(&ws).unwrap_or_default();
    let now     = now_iso();

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

    match rows.iter().position(|r| r.starts_with(wt_name)) {
        Some(idx) => rows[idx] = new_row,
        None      => rows.push(new_row),
    }

    let updated = format!("{}{}\n", header, rows.join("\n"));
    std::fs::write(&ws, updated).map_err(|e| format!("update WORKSPACE.md: {e}"))
}

pub fn update_agent_status(cwd: &str, wt_name: &str, status: &str) {
    let ws = workspace_md_path(cwd);
    if let Ok(content) = std::fs::read_to_string(&ws) {
        let now     = now_iso();
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
        let now     = now_iso();
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

// ── Agent / Branch list ───────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AgentEntry {
    pub wt_name:    String,
    pub branch:     String,
    pub agent_kind: String,
    pub status:     String,
    pub wt_path:    String,
    pub updated:    String,
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
    let content  = read_workspace(cwd);
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
                wt_name:    p[0].trim().to_string(),
                branch:     p[1].trim().to_string(),
                agent_kind: p[2].trim().to_string(),
                status:     p[3].trim().to_string(),
                wt_path:    p[4].trim().to_string(),
                updated:    p[5].trim().to_string(),
            })
        })
        .collect()
}

// ── Skill builder ─────────────────────────────────────────────────────────────

pub fn build_skill(cwd: &str, wt_name: &str, wt_path: &str, branch: &str) -> String {
    let sp  = state_path(cwd, wt_name);
    let lp  = log_path(cwd, wt_name);
    let gp  = graph_md_path(cwd);
    let wp  = workspace_md_path(cwd);

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
         - NEVER write these files into the user repo\n\
         - NEVER create a new worktree if yours exists — read state and resume\n\
         - NEVER run git commands directly — use MCP tools only\n",
        st  = sp.display(),
        lg  = lp.display(),
        gph = gp.display(),
        ws  = wp.display(),
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

    let s        = secs % 60;
    let m        = (secs / 60) % 60;
    let h        = (secs / 3_600) % 24;
    let mut days = secs / 86_400;
    let mut year = 1970u32;

    loop {
        let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
        let dy   = if leap { 366 } else { 365 };
        if days < dy { break; }
        days -= dy;
        year += 1;
    }

    let leap       = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let month_days = [31u64, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut month  = 1u32;

    for &md in &month_days {
        if days < md { break; }
        days  -= md;
        month += 1;
    }

    let day = days + 1;
    format!("{year}-{month:02}-{day:02}T{h:02}:{m:02}:{s:02}Z")
}