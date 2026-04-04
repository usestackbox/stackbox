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
//
// FIX (Bug #5): Removed the duplicate write_mcp_config() that had its
//               runbox_id and session_id parameters swapped. All MCP config
//               writing now goes through mcp::config::write_mcp_config()
//               (the canonical implementation with the correct param order).
//               The broken copy in this file is gone.

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
         Your personal context: `.stackbox/agents/$STACKBOX_RUNBOX_ID.md`\n\
         **Read this file once at session start. Already read it? Skip it — do not re-read.**\n\
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
    let runbox_short = &runbox_id[..runbox_id.len().min(8)];
    format!(
        "# Stackbox Agent Context\n\
         \n\
         - **Runbox ID**: `{runbox_id}`\n\
         - **Session ID**: `{session_id}`\n\
         - **Kind**: `{agent_kind}`\n\
         - **Workspace**: `{cwd}`\n\
         - **Worktree**: `../stackbox-wt-{runbox_short}-{agent_kind}/`\n\
         - **Branch**: `stackbox/{runbox_short}`\n\
         \n\
         ## Git Flow\n\
         \n\
         ```\n\
         mcp__stackbox__git_ensure          → creates/gets your worktree\n\
         cd ../stackbox-wt-{runbox_short}-{agent_kind}/\n\
         ... do your work ...\n\
         mcp__stackbox__git_commit          → stages + commits all changes\n\
         mcp__stackbox__git_push_pr         → pushes branch + opens PR\n\
         mcp__stackbox__git_worktree_delete → cleanup AFTER you receive PR MERGED notification\n\
         ```\n\
         \n\
         All edits inside your worktree only — never in `{cwd}` directly.\n\
         \n\
         ## ⚠️ IMPORTANT: Do NOT merge PRs\n\
         \n\
         You must NEVER merge a PR yourself. Your job is:\n\
         1. Push a branch and open a PR (`git_push_pr`)\n\
         2. Wait for review feedback (it will arrive in this terminal)\n\
         3. Fix issues if requested, commit, push again\n\
         4. Wait for the 🎉 PR MERGED notification (a human merges it)\n\
         5. Then run `git_worktree_delete` to clean up\n\
         \n\
         ## Review Feedback\n\
         \n\
         🔴 CHANGES REQUESTED or ❌ CI FAILED → fix in worktree → git_commit → git_push_pr\n\
         ✅ APPROVED → wait for human to merge, do NOT merge yourself\n\
         🎉 PR MERGED → git_worktree_delete → report success\n\
         \n\
         ## MCP Tools\n\
         \n\
         | Tool | Purpose |\n\
         |------|---------|\n\
         | `mcp__stackbox__git_ensure` | Create or get your worktree |\n\
         | `mcp__stackbox__git_commit` | Stage and commit all changes |\n\
         | `mcp__stackbox__git_push_pr` | Push branch and open PR |\n\
         | `mcp__stackbox__git_worktree_delete` | Clean up after PR MERGED notification |\n\
         | `mcp__stackbox__memory_remember` | Persist notes across sessions |\n\
         \n\
         Playbooks: `.stackbox/commands/` — read when needed, not before.\n\
         ",
        runbox_short = runbox_short,
    )
}