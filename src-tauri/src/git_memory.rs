// src-tauri/src/git_memory.rs
//
// Context injection pipeline for Stackbox.
//
// How it works:
//   1. On pty_spawn → ensure git repo exists (init shadow repo if no .git)
//   2. On pty_write (user types agent cmd) → inject memories + git log + memory write instruction
//      (only writes files relevant to the detected agent kind — not all 8 every time)
//   3. Agent writes its own memories via: POST http://localhost:7547/memory
//   4. Files tab → git_diff_live() runs `git diff HEAD` on demand (no capturing)
//
// Context injection uses BM25 search (via session_events FTS5) to rank memories
// by relevance to the current task (last git commit message used as query),
// rather than a flat newest-N truncation. Pinned memories always appear first.

use crate::memory::memories_for_runbox;
use crate::db;
use std::sync::OnceLock;
use tauri::AppHandle;

// ── Memory server port (shared with lib.rs axum server) ──────────────────
pub const MEMORY_PORT: u16 = 7547;

// ── Global app handle ─────────────────────────────────────────────────────
static GLOBAL_APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

pub fn set_app_handle(handle: AppHandle) {
    GLOBAL_APP_HANDLE.set(handle).ok();
}

pub fn emit_memory_added(runbox_id: &str) {
    if let Some(handle) = GLOBAL_APP_HANDLE.get() {
        use tauri::Emitter;
        let _ = handle.emit("memory-added", serde_json::json!({ "runbox_id": runbox_id }));
    }
}

// ── Global DB handle ──────────────────────────────────────────────────────
static GLOBAL_DB: OnceLock<db::Db> = OnceLock::new();

pub fn set_global_db(db: db::Db) {
    GLOBAL_DB.set(db).ok();
}

fn get_db() -> Option<&'static db::Db> {
    GLOBAL_DB.get()
}

static GLOBAL_BUS_REGISTRY: OnceLock<std::sync::Arc<crate::bus::BusRegistry>> = OnceLock::new();

pub fn set_global_bus_registry(registry: std::sync::Arc<crate::bus::BusRegistry>) {
    GLOBAL_BUS_REGISTRY.set(registry).ok();
}

fn get_bus_registry() -> Option<&'static std::sync::Arc<crate::bus::BusRegistry>> {
    GLOBAL_BUS_REGISTRY.get()
}

// ── Agent kind ────────────────────────────────────────────────────────────
#[derive(Debug, Clone, PartialEq)]
pub enum AgentKind {
    ClaudeCode,
    Codex,
    CursorAgent,
    GeminiCli,
    GitHubCopilot,
    OpenCode,
    Shell,
}

impl AgentKind {
    pub fn detect(cmd: &str) -> Self {
        let c = cmd.trim().to_lowercase();
        if c.contains("claude")   { return Self::ClaudeCode; }
        if c.contains("codex")    { return Self::Codex; }
        if c == "agent" || c.ends_with("/agent") || c.ends_with("\\agent") { return Self::CursorAgent; }
        if c.contains("gemini")   { return Self::GeminiCli; }
        if c.contains("copilot")  { return Self::GitHubCopilot; }
        if c.contains("opencode") { return Self::OpenCode; }
        Self::Shell
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            Self::ClaudeCode    => "Claude Code",
            Self::Codex         => "OpenAI Codex CLI",
            Self::CursorAgent   => "Cursor Agent",
            Self::GeminiCli     => "Gemini CLI",
            Self::GitHubCopilot => "GitHub Copilot",
            Self::OpenCode      => "OpenCode",
            Self::Shell         => "Shell",
        }
    }

    pub fn launch_cmd_for(&self, ctx_file: &str) -> Option<String> {
        match self {
            Self::ClaudeCode    => Some(format!("claude --append-system-prompt-file {ctx_file}\n")),
            Self::GeminiCli     => Some("gemini\n".to_string()),
            Self::Codex         => Some("codex\n".to_string()),
            Self::OpenCode      => Some("opencode\n".to_string()),
            Self::CursorAgent   => Some("agent\n".to_string()),
            Self::GitHubCopilot => Some("gh copilot suggest\n".to_string()),
            Self::Shell         => None,
        }
    }
}

// ── Git helpers ───────────────────────────────────────────────────────────
fn git_dir_for(cwd: &str, runbox_id: &str) -> String {
    let dot_git = std::path::Path::new(cwd).join(".git");
    if dot_git.exists() {
        return dot_git.to_string_lossy().to_string();
    }
    let base = dirs::data_local_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    base.join("stackbox").join("git").join(runbox_id)
        .to_string_lossy()
        .to_string()
}

fn has_git(cwd: &str, runbox_id: &str) -> bool {
    let dot_git = std::path::Path::new(cwd).join(".git");
    if dot_git.exists() { return true; }
    let shadow = git_dir_for(cwd, runbox_id);
    std::path::Path::new(&shadow).exists()
}

fn git(args: &[&str], cwd: &str, git_dir: Option<&str>) -> Result<String, String> {
    let mut cmd = std::process::Command::new("git");
    if let Some(gd) = git_dir {
        let abs_gd  = std::fs::canonicalize(gd).unwrap_or_else(|_| std::path::PathBuf::from(gd));
        let abs_cwd = std::fs::canonicalize(cwd).unwrap_or_else(|_| std::path::PathBuf::from(cwd));
        cmd.arg("--git-dir").arg(&abs_gd);
        cmd.arg("--work-tree").arg(&abs_cwd);
        cmd.current_dir(&abs_cwd);
    } else {
        cmd.current_dir(cwd);
    }
    cmd.args(args);
    let out = cmd.output().map_err(|e| format!("git exec: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

pub fn ensure_git_repo(cwd: &str, runbox_id: &str) -> Result<String, String> {
    let dot_git = std::path::Path::new(cwd).join(".git");

    if dot_git.is_dir() {
        return Ok(dot_git.to_string_lossy().to_string());
    }

    if dot_git.is_file() { let _ = std::fs::remove_file(&dot_git); }

    let shadow = git_dir_for(cwd, runbox_id);
    let shadow_head = std::path::Path::new(&shadow).join("HEAD");

    if shadow_head.exists() {
        return Ok(shadow);
    }

    let shadow_path = std::path::Path::new(&shadow);
    if !shadow_path.exists() {
        std::fs::create_dir_all(&shadow)
            .map_err(|e| format!("mkdir shadow git: {e}"))?;
    }

    std::process::Command::new("git")
        .args(["init", "--bare"])
        .current_dir(&shadow)
        .output()
        .map_err(|e| format!("git init --bare: {e}"))?;

    std::process::Command::new("git")
        .args(["config", "core.worktree", cwd])
        .current_dir(&shadow)
        .output()
        .map_err(|e| format!("git config worktree: {e}"))?;

    git(&["add", "-A"], cwd, Some(&shadow)).ok();
    git(
        &["commit", "--allow-empty", "-m", "stackbox: initial snapshot"],
        cwd,
        Some(&shadow),
    ).ok();

    eprintln!("[git_memory] created shadow repo at {shadow} for {cwd}");
    Ok(shadow)
}

/// Auto-create a worktree for a runbox agent session.
/// Branch: stackbox/<runbox_id_short>
/// Path:   <parent-of-cwd>/stackbox-wt-<runbox_id_short>
/// Idempotent — returns existing path if already created.
/// Returns None if cwd has no real .git (shadow repos don't support worktrees).
pub fn ensure_worktree_for_runbox(cwd: &str, runbox_id: &str) -> Option<String> {
    let dot_git = std::path::Path::new(cwd).join(".git");
    if !dot_git.exists() { return None; }

    let short   = &runbox_id[..runbox_id.len().min(8)];
    let branch  = format!("stackbox/{short}");
    let parent  = std::path::Path::new(cwd).parent()?;
    let wt_path = parent.join(format!("stackbox-wt-{short}"));
    let wt_str  = wt_path.to_str()?.to_string();

    if wt_path.exists() {
        return Some(wt_str);
    }

    // Try create branch + worktree
    let out = std::process::Command::new("git")
        .args(["worktree", "add", "-b", &branch, &wt_str, "HEAD"])
        .current_dir(cwd)
        .output()
        .ok()?;

    if out.status.success() {
        eprintln!("[git_memory] worktree created: {wt_str} (branch: {branch})");
        return Some(wt_str);
    }

    // Branch may already exist — try without -b
    let out2 = std::process::Command::new("git")
        .args(["worktree", "add", &wt_str, &branch])
        .current_dir(cwd)
        .output()
        .ok()?;

    if out2.status.success() {
        Some(wt_str)
    } else {
        eprintln!("[git_memory] worktree add failed: {}",
            String::from_utf8_lossy(&out2.stderr).trim());
        None
    }
}

/// Remove worktree and prune stale refs. Safe to call even if already removed.
pub fn remove_worktree(wt_path: &str) {
    if !std::path::Path::new(wt_path).exists() { return; }
    let out = std::process::Command::new("git")
        .args(["worktree", "remove", "--force", wt_path])
        .output();
    if let Ok(o) = out {
        if !o.status.success() {
            eprintln!("[git_memory] worktree remove warn: {}",
                String::from_utf8_lossy(&o.stderr).trim());
        }
    }
    let _ = std::process::Command::new("git")
        .args(["worktree", "prune"])
        .output();
}

// ── Context injection ─────────────────────────────────────────────────────

const PINNED_LIMIT:  usize = 10;
const EVENTS_LIMIT:  usize = 10;
const CONTEXT_TOP_N: usize = 20;

pub async fn inject_context_for_agent(
    runbox_id:  &str,
    cwd:        &str,
    agent:      &AgentKind,
) -> Result<(), String> {
    inject_context_for_agent_with_session(runbox_id, cwd, agent, "unknown").await
}

pub async fn inject_context_for_agent_with_session(
    runbox_id:  &str,
    cwd:        &str,
    agent:      &AgentKind,
    session_id: &str,
) -> Result<(), String> {
    // ── 1. Load all memories for this runbox + global memories ────────────
    let mut memories = memories_for_runbox(runbox_id).await?;
    let mut globals  = memories_for_runbox("__global__").await.unwrap_or_default();
    memories.append(&mut globals);

    // ── 2. Separate pinned from unpinned ──────────────────────────────────
    let mut pinned: Vec<_>   = memories.iter().filter(|m|  m.pinned).cloned().collect();
    let mut unpinned: Vec<_> = memories.iter().filter(|m| !m.pinned).cloned().collect();
    pinned.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    unpinned.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    pinned.truncate(PINNED_LIMIT);

    // ── 3. BM25 search over session_events to rank unpinned memories ──────
    let git_dir = git_dir_for(cwd, runbox_id);
    let git_dir_opt: Option<&str> = if std::path::Path::new(cwd).join(".git").exists() {
        None
    } else if std::path::Path::new(&git_dir).exists() {
        Some(&git_dir)
    } else {
        None
    };

    let recent_commit = git(&["log", "--oneline", "-1"], cwd, git_dir_opt).unwrap_or_default();
    let search_query: String = recent_commit
        .split_whitespace()
        .skip(1)
        .collect::<Vec<_>>()
        .join(" ");

    let relevant_summaries: Vec<String> = if !search_query.is_empty() {
        if let Some(db) = get_db() {
            db::events_search(db, runbox_id, &search_query, EVENTS_LIMIT)
                .unwrap_or_default()
                .into_iter()
                .map(|e| e.summary)
                .collect()
        } else {
            vec![]
        }
    } else {
        vec![]
    };

    let relevant_words: std::collections::HashSet<String> = relevant_summaries
        .iter()
        .flat_map(|s| s.split_whitespace().map(|w| w.to_lowercase()))
        .filter(|w| w.len() > 3)
        .collect();

    if !relevant_words.is_empty() {
        unpinned.sort_by(|a, b| {
            let score_a = relevance_score(&a.content, &relevant_words);
            let score_b = relevance_score(&b.content, &relevant_words);
            score_b.cmp(&score_a)
                .then_with(|| b.timestamp.cmp(&a.timestamp))
        });
    }

    let unpinned_limit = CONTEXT_TOP_N.saturating_sub(pinned.len());
    unpinned.truncate(unpinned_limit);

    let mut final_memories = pinned;
    final_memories.extend(unpinned);

    // ── 4. Git log ────────────────────────────────────────────────────────
    let git_log = git(
        &["log", "--oneline", "--no-merges", "-30"],
        cwd,
        git_dir_opt,
    ).unwrap_or_default();

    // ── 5. Fetch live peer state ──────────────────────────────────────────
    let peer_activity = fetch_peer_activity(runbox_id, session_id);

    // ── 6. Build context markdown ─────────────────────────────────────────
    let base    = std::path::Path::new(cwd);
    let content = build_context_md(runbox_id, session_id, &final_memories, &git_log, &peer_activity, agent);

    // ── 7. Write files ────────────────────────────────────────────────────
    let base_targets: &[(&str, bool)] = &[
        (".stackbox-context.md", false),
    ];

    let agent_targets: Vec<(&str, bool)> = match agent {
        AgentKind::ClaudeCode => vec![
            ("CLAUDE.md",                        true),
            (".claude/skills/stackbox/SKILL.md", false),
        ],
        AgentKind::Codex => vec![
            ("AGENTS.md",                        true),
            (".codex/skills/stackbox/SKILL.md",  false),
        ],
        AgentKind::GeminiCli => vec![
            ("GEMINI.md",                        true),
            // Single skill path — .agents/ takes precedence in Gemini CLI,
            // .gemini/ removed to avoid "skill conflict" warning.
            (".agents/skills/stackbox/SKILL.md", false),
        ],
        AgentKind::OpenCode => vec![
            ("OPENCODE.md", true),
        ],
        AgentKind::CursorAgent => vec![
            (".agents/skills/stackbox/SKILL.md",  false),
            (".cursor/skills/stackbox/SKILL.md",  false),
        ],
        AgentKind::GitHubCopilot => vec![
            (".github/copilot-instructions.md",   true),
            (".github/skills/stackbox/SKILL.md",  false),
        ],
        AgentKind::Shell => vec![],
    };

    // Skill files get YAML frontmatter — name is unique per agent to avoid conflicts
    let skill_name = match agent {
        AgentKind::ClaudeCode    => "stackbox-context-claude",
        AgentKind::Codex         => "stackbox-context-codex",
        AgentKind::GeminiCli     => "stackbox-context-gemini",
        AgentKind::CursorAgent   => "stackbox-context-cursor",
        AgentKind::GitHubCopilot => "stackbox-context-copilot",
        AgentKind::OpenCode      => "stackbox-context-opencode",
        AgentKind::Shell         => "stackbox-context",
    };

    let skill_content = format!(
        "---\nname: {skill_name}\ndescription: Project memory and context from Stackbox. Read this before starting any task.\n---\n\n{c}",
        c = content
    );

    let all_targets = base_targets.iter()
        .copied()
        .chain(agent_targets.iter().copied());

    for (rel_path, preserve_existing) in all_targets {
        let path = base.join(rel_path);
        if let Some(parent) = path.parent() {
            if !parent.exists() {
                std::fs::create_dir_all(parent).ok();
            }
        }
        let raw = if rel_path.contains("/skills/stackbox/SKILL.md") {
            skill_content.clone()
        } else {
            content.clone()
        };
        let final_content = if preserve_existing {
            let existing = std::fs::read_to_string(&path).unwrap_or_default();
            merge_into_existing(&existing, &raw)
        } else {
            raw
        };
        std::fs::write(&path, final_content)
            .map_err(|e| format!("write {rel_path}: {e}"))?;
    }

    // ── 8. Write MCP config files ─────────────────────────────────────────
    if *agent != AgentKind::Shell {
        if let Err(e) = crate::mcp::write_mcp_config(cwd, runbox_id, session_id) {
            eprintln!("[git_memory] write_mcp_config: {e}");
        }
    }

    eprintln!(
        "[git_memory] injected {} memories + {} git lines + {} peer msgs → {:?}",
        final_memories.len(),
        git_log.lines().count(),
        peer_activity.recent_msgs.len(),
        agent,
    );
    Ok(())
}

fn relevance_score(content: &str, relevant_words: &std::collections::HashSet<String>) -> usize {
    content
        .split_whitespace()
        .filter(|w| relevant_words.contains(&w.to_lowercase()))
        .count()
}

pub async fn inject_context(runbox_id: &str, cwd: &str) -> Result<(), String> {
    inject_context_for_agent_with_session(runbox_id, cwd, &AgentKind::Shell, "shell").await
}

// ── Peer activity ─────────────────────────────────────────────────────────────
struct PeerActivity {
    recent_msgs:  Vec<db::BusMessageRow>,
    active_peers: Vec<String>,
}

fn fetch_peer_activity(runbox_id: &str, session_id: &str) -> PeerActivity {
    let recent_msgs = if let Some(db) = get_db() {
        db::bus_messages_for_runbox(db, runbox_id, 15, None)
            .unwrap_or_default()
            .into_iter()
            .filter(|m| m.from_agent != session_id)
            .collect()
    } else { vec![] };

    let active_peers = if let Some(registry) = get_bus_registry() {
        registry.agents_in(runbox_id)
            .into_iter()
            .filter(|s| s != session_id)
            .collect()
    } else { vec![] };

    PeerActivity { recent_msgs, active_peers }
}

fn build_peer_section(activity: &PeerActivity, runbox_id: &str, port: u16) -> String {
    let peers_line = if activity.active_peers.is_empty() {
        "**No other agents currently active.** You are the only agent in this runbox.".to_string()
    } else {
        format!(
            "**{} other agent(s) currently active:**\n{}",
            activity.active_peers.len(),
            activity.active_peers.iter()
                .map(|s| format!("  - `{}`", &s[..s.len().min(16)]))
                .collect::<Vec<_>>().join("\n"),
        )
    };

    let msgs_section = if activity.recent_msgs.is_empty() {
        "No recent bus activity from peers.".to_string()
    } else {
        activity.recent_msgs.iter().rev().map(|m| {
            let ago     = format_ts(m.timestamp);
            let session = &m.from_agent[..m.from_agent.len().min(12)];
            let payload = if m.payload.len() > 150 { format!("{}…", &m.payload[..150]) } else { m.payload.clone() };
            format!("- **[{ago}] {topic}** from `{session}`\n  {payload}", ago = ago, topic = m.topic, session = session, payload = payload)
        }).collect::<Vec<_>>().join("\n")
    };

    let claimed = activity.recent_msgs.iter()
        .filter(|m| m.topic == "task.started")
        .filter(|started| !activity.recent_msgs.iter().any(|m| {
            m.topic == "task.done"
                && m.correlation_id.is_some()
                && m.correlation_id == started.correlation_id
        }))
        .collect::<Vec<_>>();

    let claimed_section = if claimed.is_empty() {
        String::new()
    } else {
        format!(
            "\n**Tasks already in progress — do not duplicate these:**\n{}\n",
            claimed.iter().map(|m| {
                let s = &m.from_agent[..m.from_agent.len().min(12)];
                format!("  - `{s}` → {}", m.payload.chars().take(100).collect::<String>())
            }).collect::<Vec<_>>().join("\n")
        )
    };

    format!(
        "## IMPORTANT — Read this before starting any work\n\
         \n\
         {peers_line}\n\
         {claimed_section}\n\
         ### Recent peer activity\n\
         {msgs_section}\n\
         \n\
         > This section refreshes automatically whenever a peer completes or fails a task.\n\
         > For real-time state: `http://localhost:{port}/bus/history?runbox_id={runbox_id}&limit=20`\n\
         \n",
    )
}

// ── Context file builder ──────────────────────────────────────────────────────
fn build_context_md(
    runbox_id:     &str,
    session_id:    &str,
    memories:      &[crate::memory::Memory],
    git_log:       &str,
    peer_activity: &PeerActivity,
    agent:         &AgentKind,
) -> String {
    let port = MEMORY_PORT;

    let peer_section = build_peer_section(peer_activity, runbox_id, port);

    let base = format!("http://localhost:{port}");

    let memory_snippet = [
        "```bash",
        "# bash / zsh",
        &format!("curl -s -X POST {base}/memory \\"),
        "  -H 'Content-Type: application/json' \\",
        &format!("  -d '{{\"runbox_id\":\"{runbox_id}\",\"content\":\"YOUR SUMMARY\"}}'"),
        "```",
        "```powershell",
        "# PowerShell",
        &format!("Invoke-RestMethod {base}/memory -Method Post `"),
        "  -ContentType 'application/json' `",
        &format!("  -Body '{{\"runbox_id\":\"{runbox_id}\",\"content\":\"YOUR SUMMARY\"}}'"),
        "```",
    ].join("\n");

    let bus_publish_snippet = [
        "```bash",
        "# announce task start",
        &format!("curl -s -X POST {base}/bus/publish \\"),
        "  -H 'Content-Type: application/json' \\",
        &format!("  -d '{{\"runbox_id\":\"{runbox_id}\",\"from\":\"{session_id}\",\"topic\":\"task.started\",\"payload\":\"your task\"}}'"),
        "# announce completion",
        &format!("curl -s -X POST {base}/bus/publish \\"),
        "  -H 'Content-Type: application/json' \\",
        &format!("  -d '{{\"runbox_id\":\"{runbox_id}\",\"from\":\"{session_id}\",\"topic\":\"task.done\",\"payload\":\"what you did\"}}'"),
        "```",
        "```powershell",
        &format!("Invoke-RestMethod {base}/bus/publish -Method Post `"),
        "  -ContentType 'application/json' `",
        &format!("  -Body '{{\"runbox_id\":\"{runbox_id}\",\"from\":\"{session_id}\",\"topic\":\"task.started\",\"payload\":\"your task\"}}'"),
        "```",
    ].join("\n");

    let bus_catchup_snippet = [
        "```bash",
        &format!("curl -s '{base}/bus/tasks_in_progress?runbox_id={runbox_id}'"),
        &format!("curl -s '{base}/bus/history?runbox_id={runbox_id}&limit=20'"),
        &format!("curl -s '{base}/bus/agents?runbox_id={runbox_id}'"),
        "```",
        "```powershell",
        &format!("Invoke-RestMethod '{base}/bus/tasks_in_progress?runbox_id={runbox_id}'"),
        &format!("Invoke-RestMethod '{base}/bus/history?runbox_id={runbox_id}&limit=20'"),
        "```",
    ].join("\n");

    // Agent identity line — tells the agent who it is and who else is active
    let agent_identity = {
        let peers = if peer_activity.active_peers.is_empty() {
            "no other agents active".to_string()
        } else {
            format!("peers active: {}", peer_activity.active_peers.len())
        };
        format!(
            "> **You are: {}** (session `{}`) — {}\n",
            agent.display_name(),
            &session_id[..session_id.len().min(12)],
            peers,
        )
    };

    let instructions = format!(
        "## Stackbox Instructions\n\
         \n\
         {agent_identity}\
         \n\
         You are one of potentially multiple agents running in this RunBox.\n\
         Use the bus to coordinate — avoid duplicating work a peer is already doing.\n\
         \n\
         ### Before starting any work\n\
         1. Read all memories below — they contain what previous agents did\n\
         2. Check the bus for what peer agents are doing RIGHT NOW:\n\
         \n\
         {bus_catchup_snippet}\n\
         \n\
         ### While working\n\
         - Publish `task.started` when you begin a significant task\n\
         - Publish `task.done` when complete (include files changed)\n\
         - Publish `task.failed` or `error` if something goes wrong\n\
         - Publish `status` for progress updates on long-running tasks\n\
         \n\
         {bus_publish_snippet}\n\
         \n\
         **Valid topics:** `task.started` · `task.done` · `task.failed` · `file.changed` · `memory.added` · `status` · `error` · `agent.started` · `agent.stopped`\n\
         Use `custom.<anything>` for topics not in this list.\n\
         \n\
         ### After completing a task\n\
         Save a memory so future agents have context (1-3 sentences — what you did, files changed, known issues):\n\
         \n\
         {memory_snippet}\n\
         \n\
         ### Query your event history\n\
         ```powershell\n\
         Invoke-RestMethod \"http://localhost:{port}/events?runbox_id={runbox_id}&q=YOUR+QUERY\" | ConvertTo-Json\n\
         ```\n",
        agent_identity      = agent_identity,
        bus_catchup_snippet = bus_catchup_snippet,
        bus_publish_snippet = bus_publish_snippet,
        memory_snippet      = memory_snippet,
        port                = port,
        runbox_id           = runbox_id,
    );

    let memories_section = if memories.is_empty() {
        String::new()
    } else {
        let entries: String = memories.iter().map(|m| {
            let pin = if m.pinned { " 📌" } else { "" };
            let ts  = format_ts(m.timestamp);
            format!("- [{}]{} {}\n", ts, pin, m.content.trim())
        }).collect();
        format!("## Memories from previous sessions\n\n{entries}\n")
    };

    let git_section = if git_log.trim().is_empty() {
        String::new()
    } else {
        let entries: String = git_log.lines()
            .map(|l| format!("- {l}\n"))
            .collect();
        format!("## Recent git commits\n\n{entries}\n")
    };

    format!(
        "# Stackbox Context\n\
         > Auto-generated by Stackbox. Updated on every session start and when peers complete tasks.\n\
         > Do not edit this block — put your own notes outside the stackbox markers.\n\
         \n\
         {peer_section}\
         {instructions}\n\
         {memories_section}\
         {git_section}\
         ---\n\
         *Managed by Stackbox — stackbox.dev*\n"
    )
}

fn format_ts(ms: i64) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    let diff = (now - ms).max(0) / 1000;
    if diff < 60        { return "just now".to_string(); }
    if diff < 3600      { return format!("{}m ago", diff / 60); }
    if diff < 86400     { return format!("{}h ago", diff / 3600); }
    format!("{}d ago", diff / 86400)
}

fn merge_into_existing(existing: &str, new_block: &str) -> String {
    const START: &str = "<!-- stackbox:start -->";
    const END:   &str = "<!-- stackbox:end -->";
    let block = format!("{START}\n{new_block}\n{END}");

    if existing.trim().is_empty() {
        return block + "\n";
    }
    if let (Some(s), Some(e)) = (existing.find(START), existing.find(END)) {
        let before = &existing[..s];
        let after  = &existing[e + END.len()..];
        format!("{before}{block}{after}")
    } else {
        format!("{block}\n\n{existing}")
    }
}

// ── Live diff helpers ─────────────────────────────────────────────────────────
fn git_dir_opt_for(cwd: &str, runbox_id: &str) -> Option<String> {
    if std::path::Path::new(cwd).join(".git").exists() {
        return None;
    }
    let shadow = git_dir_for(cwd, runbox_id);
    if std::path::Path::new(&shadow).exists() {
        Some(shadow)
    } else {
        None
    }
}

// ── Tauri commands ────────────────────────────────────────────────────────────
#[tauri::command]
pub async fn git_ensure(cwd: String, runbox_id: String) -> Result<bool, String> {
    let had_git = has_git(&cwd, &runbox_id);
    ensure_git_repo(&cwd, &runbox_id)?;
    Ok(!had_git)
}

#[tauri::command]
pub async fn git_log_for_runbox(cwd: String, runbox_id: String) -> Result<Vec<GitCommit>, String> {
    let git_dir_opt = git_dir_opt_for(&cwd, &runbox_id);
    let gdo: Option<&str> = git_dir_opt.as_deref();

    let log = git(
        &["log", "--pretty=format:%H|%h|%s|%ai|%an", "--no-merges", "-50"],
        &cwd,
        gdo,
    ).unwrap_or_default();

    let commits = log.lines()
        .filter(|l| !l.is_empty())
        .filter_map(|l| {
            let parts: Vec<&str> = l.splitn(5, '|').collect();
            if parts.len() < 5 { return None; }
            Some(GitCommit {
                hash:       parts[0].to_string(),
                short_hash: parts[1].to_string(),
                message:    parts[2].to_string(),
                date:       parts[3].to_string(),
                author:     parts[4].to_string(),
            })
        })
        .collect();

    Ok(commits)
}

#[tauri::command]
pub async fn git_diff_for_commit(
    cwd:       String,
    runbox_id: String,
    hash:      String,
) -> Result<String, String> {
    let git_dir_opt = git_dir_opt_for(&cwd, &runbox_id);
    let gdo: Option<&str> = git_dir_opt.as_deref();
    git(&["diff", &format!("{hash}~1"), &hash], &cwd, gdo)
}

fn mtime_ms(cwd: &str, rel_path: &str) -> u64 {
    use std::time::UNIX_EPOCH;
    let full = std::path::Path::new(cwd).join(rel_path);
    std::fs::metadata(&full)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
pub async fn git_diff_live(
    cwd:       String,
    runbox_id: String,
) -> Result<Vec<LiveDiffFile>, String> {
    let git_dir_opt = git_dir_opt_for(&cwd, &runbox_id);
    let gdo: Option<&str> = git_dir_opt.as_deref();

    // 1. Diff against HEAD
    let mut diff    = git(&["diff", "HEAD"],              &cwd, gdo).unwrap_or_default();
    let mut numstat = git(&["diff", "HEAD", "--numstat"], &cwd, gdo).unwrap_or_default();

    // 2. Nothing vs HEAD — try staged-only
    if diff.trim().is_empty() {
        diff    = git(&["diff", "--cached"],               &cwd, gdo).unwrap_or_default();
        numstat = git(&["diff", "--cached", "--numstat"],  &cwd, gdo).unwrap_or_default();
    }

    // 3. Still empty — show untracked files
    if diff.trim().is_empty() {
        let status = git(&["status", "--porcelain"], &cwd, gdo).unwrap_or_default();
        let files: Vec<LiveDiffFile> = status.lines()
            .filter(|l| l.trim_start().starts_with("??"))
            .map(|l| {
                let path = l.trim_start_matches("??").trim().to_string();
                LiveDiffFile {
                    path:        path.clone(),
                    change_type: "created".to_string(),
                    diff:        format!("diff --git a/{path} b/{path}\nnew file (untracked — stage to see diff)"),
                    insertions:  0,
                    deletions:   0,
                    modified_at: mtime_ms(&cwd, &path),
                }
            })
            .collect();
        return Ok(files);
    }

    Ok(parse_diff_into_files(&diff, &numstat, &cwd))
}

fn parse_diff_into_files(diff: &str, numstat: &str, cwd: &str) -> Vec<LiveDiffFile> {
    let mut stat_map: std::collections::HashMap<String, (i32, i32)> = std::collections::HashMap::new();
    for line in numstat.lines() {
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        if parts.len() == 3 {
            let ins = parts[0].parse::<i32>().unwrap_or(0);
            let del = parts[1].parse::<i32>().unwrap_or(0);
            stat_map.insert(parts[2].to_string(), (ins, del));
        }
    }

    let mut files: Vec<LiveDiffFile> = Vec::new();
    let mut current_path = String::new();
    let mut current_diff = String::new();
    let mut change_type  = "modified";

    for line in diff.lines() {
        if line.starts_with("diff --git") {
            if !current_path.is_empty() {
                let (ins, del) = stat_map.get(&current_path).copied().unwrap_or((0, 0));
                files.push(LiveDiffFile {
                    path:        current_path.clone(),
                    change_type: change_type.to_string(),
                    diff:        current_diff.clone(),
                    insertions:  ins,
                    deletions:   del,
                    modified_at: mtime_ms(cwd, &current_path),
                });
            }
            current_path = line.split(" b/").nth(1).unwrap_or("").to_string();
            current_diff = line.to_string() + "\n";
            change_type  = "modified";
        } else if line.starts_with("new file mode") {
            change_type = "created";
            current_diff.push_str(line);
            current_diff.push('\n');
        } else if line.starts_with("deleted file mode") {
            change_type = "deleted";
            current_diff.push_str(line);
            current_diff.push('\n');
        } else if !current_path.is_empty() {
            current_diff.push_str(line);
            current_diff.push('\n');
        }
    }

    if !current_path.is_empty() && !current_diff.trim().is_empty() {
        let (ins, del) = stat_map.get(&current_path).copied().unwrap_or((0, 0));
        files.push(LiveDiffFile {
            path:        current_path.clone(),
            change_type: change_type.to_string(),
            diff:        current_diff,
            insertions:  ins,
            deletions:   del,
            modified_at: mtime_ms(cwd, &current_path),
        });
    }

    files
}

// ── Worktree commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn git_worktree_create(
    cwd:     String,
    branch:  String,
    wt_name: String,
) -> Result<String, String> {
    let cwd_path = std::path::Path::new(&cwd);
    if !cwd_path.join(".git").exists() {
        return Err("No .git found — init a repo first.".to_string());
    }
    let parent  = cwd_path.parent().ok_or("cwd has no parent directory")?;
    let wt_path = parent.join(format!("stackbox-wt-{wt_name}"));
    let wt_str  = wt_path.to_str().ok_or("non-UTF8 path")?;

    if wt_path.exists() {
        return Ok(wt_str.to_string());
    }

    let out = std::process::Command::new("git")
        .args(["worktree", "add", "-b", &branch, wt_str, "HEAD"])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("git worktree add: {e}"))?;

    if out.status.success() {
        Ok(wt_str.to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

#[tauri::command]
pub async fn git_worktree_remove(wt_path: String) -> Result<(), String> {
    if !std::path::Path::new(&wt_path).exists() {
        return Ok(());
    }
    let out = std::process::Command::new("git")
        .args(["worktree", "remove", "--force", &wt_path])
        .output()
        .map_err(|e| format!("git worktree remove: {e}"))?;

    if !out.status.success() {
        let msg = String::from_utf8_lossy(&out.stderr);
        if !msg.contains("is not a working tree") {
            eprintln!("[git_memory] worktree remove warn: {}", msg.trim());
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn git_current_branch(cwd: String) -> Result<String, String> {
    let out = std::process::Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("git branch: {e}"))?;

    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Ok(String::new())
    }
}

#[tauri::command]
pub async fn git_stage_and_commit(
    cwd:       String,
    runbox_id: String,
    message:   String,
) -> Result<String, String> {
    if message.trim().is_empty() {
        return Err("Commit message cannot be empty.".to_string());
    }
    let gdo_owned = git_dir_opt_for(&cwd, &runbox_id);
    let gdo: Option<&str> = gdo_owned.as_deref();

    git(&["add", "-A"], &cwd, gdo)?;

    let commit_out = git(&["commit", "-m", message.trim()], &cwd, gdo)?;

    let hash = git(&["rev-parse", "--short", "HEAD"], &cwd, gdo)
        .unwrap_or_default();
    let short = hash.trim();
    let summary = commit_out.lines().next().unwrap_or("").trim().to_string();
    Ok(format!("[{short}] {summary}"))
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct GitCommit {
    pub hash:       String,
    pub short_hash: String,
    pub message:    String,
    pub date:       String,
    pub author:     String,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct LiveDiffFile {
    pub path:        String,
    pub change_type: String,
    pub diff:        String,
    pub insertions:  i32,
    pub deletions:   i32,
    pub modified_at: u64,
}