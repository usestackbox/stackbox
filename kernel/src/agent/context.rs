// src-tauri/src/agent/context.rs
//
// Writes agent context files when a PTY spawns.
//
// Two-level system:
//   CLAUDE.md / AGENTS.md  — shared, one per workspace, never overwritten if exists
//                             only tells agent WHERE to find its personal context
//   .stackbox/agents/{runbox_id}.md — per-agent, unique per terminal
//                             contains: runbox_id, worktree instructions, MCP tools
//
// This means 3 Claude instances in the same workspace never conflict.

use std::{fs, path::Path};

const SHARED_MARKER_START: &str = "<!-- stackbox:start -->";
const SHARED_MARKER_END:   &str = "<!-- stackbox:end -->";

// ── public entry point ────────────────────────────────────────────────────────

pub fn inject(
    cwd:        &str,
    runbox_id:  &str,
    session_id: &str,
    agent_kind: &str,
) -> Result<(), String> {
    write_shared_context(cwd, agent_kind)?;
    write_per_agent_context(cwd, runbox_id, session_id, agent_kind)?;
    Ok(())
}

// ── shared workspace context (CLAUDE.md / AGENTS.md) ─────────────────────────

/// Merge stackbox instructions into CLAUDE.md without destroying user content.
/// Only the block between markers is managed — everything else is untouched.
fn write_shared_context(cwd: &str, agent_kind: &str) -> Result<(), String> {
    let filename = match agent_kind {
        "codex"      => "AGENTS.md",
        "gemini-cli" => "GEMINI.md",
        _            => "CLAUDE.md",
    };
    let path = Path::new(cwd).join(filename);

    let existing = fs::read_to_string(&path).unwrap_or_default();
    let block    = shared_block();

    let new_content = if existing.contains(SHARED_MARKER_START) {
        // replace existing block
        let before = existing.split(SHARED_MARKER_START).next().unwrap_or("");
        let after  = existing
            .split(SHARED_MARKER_END)
            .nth(1)
            .unwrap_or("");
        format!("{before}{block}{after}")
    } else {
        // append at end — don't disturb user's existing content
        if existing.is_empty() {
            block
        } else {
            format!("{existing}\n\n{block}")
        }
    };

    fs::write(&path, new_content).map_err(|e| e.to_string())
}

fn shared_block() -> String {
    format!(
        "{SHARED_MARKER_START}\n\
         ## Stackbox Agent Instructions\n\
         \n\
         Your personal context is in: `.stackbox/agents/$STACKBOX_RUNBOX_ID.md`\n\
         Read that file first before doing anything.\n\
         \n\
         **Always follow the git worktree and PR flow described in your personal context.**\n\
         {SHARED_MARKER_END}\n"
    )
}

// ── per-agent context file ────────────────────────────────────────────────────

/// Write .stackbox/agents/{runbox_id}.md with this agent's specific instructions.
/// Unique filename = unique per terminal = zero conflicts between same-type agents.
fn write_per_agent_context(
    cwd:        &str,
    runbox_id:  &str,
    session_id: &str,
    agent_kind: &str,
) -> Result<(), String> {
    let agents_dir = Path::new(cwd).join(".stackbox").join("agents");
    fs::create_dir_all(&agents_dir).map_err(|e| e.to_string())?;

    let path    = agents_dir.join(format!("{runbox_id}.md"));
    let content = per_agent_content(cwd, runbox_id, session_id, agent_kind);

    fs::write(&path, content).map_err(|e| e.to_string())?;
    eprintln!("[context] wrote agent context: {}", path.display());
    Ok(())
}

fn per_agent_content(
    cwd:        &str,
    runbox_id:  &str,
    session_id: &str,
    agent_kind: &str,
) -> String {
    format!(
        "# Stackbox Agent Context\n\
         \n\
         - **Runbox ID**: `{runbox_id}`\n\
         - **Session ID**: `{session_id}`\n\
         - **Agent kind**: `{agent_kind}`\n\
         - **Workspace**: `{cwd}`\n\
         \n\
         ## Git Worktree — Do This First\n\
         \n\
         Before starting any task:\n\
         \n\
         1. Call `mcp__stackbox__git_worktree_get` to check if your worktree exists.\n\
         2. If it exists → `cd` into it and continue work there.\n\
         3. If not → call `mcp__stackbox__git_ensure` to create it, then `cd` into it.\n\
         4. **All file edits must happen inside your worktree only.**\n\
         5. Never edit files in the main workspace directory `{cwd}`.\n\
         \n\
         Your worktree will be created at:\n\
         `../stackbox-wt-{runbox_short}-{agent_kind}/`\n\
         Your branch: `stackbox/{runbox_short}`\n\
         \n\
         ## After Completing Work\n\
         \n\
         1. Call `mcp__stackbox__git_commit` with a clear commit message.\n\
         2. Call `mcp__stackbox__git_push_pr` to push and open a PR to main.\n\
         3. Report the PR url to the user.\n\
         4. Stay running — you will receive review comments automatically.\n\
         \n\
         ## When You Receive Review Feedback\n\
         \n\
         Feedback is delivered automatically into this terminal.\n\
         When you see a message starting with 🔴 CHANGES REQUESTED or ❌ CI FAILED:\n\
         \n\
         1. Read all the comments carefully.\n\
         2. Fix every issue in your worktree.\n\
         3. Call `mcp__stackbox__git_commit` again.\n\
         4. Call `mcp__stackbox__git_push_pr` to push — PR updates automatically.\n\
         5. Report back to the user that you've addressed the feedback.\n\
         \n\
         ## When PR is Merged\n\
         \n\
         When you see 🎉 PR MERGED:\n\
         1. Call `mcp__stackbox__git_worktree_delete` to clean up.\n\
         2. Report success to the user.\n\
         \n\
         ## MCP Tools Available\n\
         \n\
         | Tool | Purpose |\n\
         |------|---------|\n\
         | `mcp__stackbox__git_ensure` | Create or get your worktree |\n\
         | `mcp__stackbox__git_commit` | Stage and commit all changes |\n\
         | `mcp__stackbox__git_push_pr` | Push branch and open PR |\n\
         | `mcp__stackbox__git_worktree_delete` | Clean up after PR merged |\n\
         | `mcp__stackbox__memory_remember` | Persist notes across sessions |\n\
         ",
        runbox_short = &runbox_id[..runbox_id.len().min(8)],
    )
}

// ── MCP config ────────────────────────────────────────────────────────────────

pub fn write_mcp_config(
    cwd:        &str,
    worktree:   Option<&str>,
    session_id: &str,
    runbox_id:  &str,
) -> Result<(), String> {
    let target_dir = worktree.unwrap_or(cwd);
    let claude_dir = Path::new(target_dir).join(".claude");
    fs::create_dir_all(&claude_dir).map_err(|e| e.to_string())?;

    let config_path = claude_dir.join("mcp.json");
    let config = serde_json::json!({
        "mcpServers": {
            "stackbox": {
                "command": "stackbox-mcp",
                "args": [],
                "env": {
                    "STACKBOX_SESSION_ID": session_id,
                    "STACKBOX_RUNBOX_ID":  runbox_id,
                    "STACKBOX_CWD":        cwd,
                }
            }
        }
    });

    fs::write(&config_path, serde_json::to_string_pretty(&config).unwrap())
        .map_err(|e| e.to_string())?;

    eprintln!("[context] wrote mcp config: {}", config_path.display());
    Ok(())
}