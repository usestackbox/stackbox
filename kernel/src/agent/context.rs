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
    cwd:           &str,
    runbox_id:     &str,
    session_id:    &str,
    agent_kind:    &str,
    worktree_path: Option<&str>,
) -> Result<(), String> {
    write_shared_context(cwd, agent_kind)?;
    write_per_agent_context(cwd, runbox_id, session_id, agent_kind, worktree_path)?;
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
    cwd:           &str,
    runbox_id:     &str,
    session_id:    &str,
    agent_kind:    &str,
    worktree_path: Option<&str>,
) -> Result<(), String> {
    let agents_dir = Path::new(cwd).join(".stackbox").join("agents");
    fs::create_dir_all(&agents_dir).map_err(|e| e.to_string())?;

    let path    = agents_dir.join(format!("{runbox_id}.md"));
    let content = per_agent_content(cwd, runbox_id, session_id, agent_kind, worktree_path);

    fs::write(&path, content).map_err(|e| e.to_string())?;
    eprintln!("[context] wrote agent context: {}", path.display());
    Ok(())
}

fn per_agent_content(
    cwd:           &str,
    runbox_id:     &str,
    session_id:    &str,
    agent_kind:    &str,
    worktree_path: Option<&str>,
) -> String {
    let runbox_short = &runbox_id[..runbox_id.len().min(8)];

    // Build a relative path from cwd to the real worktree so the agent can `cd` to it.
    let wt_rel = worktree_path.map(|wt| pathdiff_simple(cwd, wt));

    let wt_meta = match &wt_rel {
        Some(rel) => format!(
            "- **Worktree**: `{rel}`\n- **Branch**: `stackbox/{runbox_short}`\n"
        ),
        None => String::new(),
    };

    let wt_section = match &wt_rel {
        Some(rel) => format!(
            "## Your Worktree\n\
             \n\
             You are already `cd`-ed into your worktree. Confirm with `pwd`.\n\
             If not, run: `cd {rel}`\n\
             ⚠️  All edits go INSIDE the worktree — never touch `{cwd}` directly.\n\n"
        ),
        None => String::new(),
    };

    format!(
        "# Stackbox Agent Context\n\
         \n\
         - **Runbox ID**: `{runbox_id}`\n\
         - **Session ID**: `{session_id}`\n\
         - **Kind**: `{agent_kind}`\n\
         - **Workspace**: `{cwd}`\n\
         {wt_meta}\
         \n\
         {wt_section}\
         ## Git Flow\n\
         \n\
         ```\n\
         mcp__stackbox__git_commit          → stage + commit all changes\n\
         mcp__stackbox__git_push_pr         → push branch + open PR\n\
         mcp__stackbox__git_worktree_delete → cleanup AFTER PR MERGED\n\
         ```\n\
         \n\
         ## ⚠️ Do NOT merge PRs yourself\n\
         \n\
         1. Push branch + open PR (`git_push_pr`)\n\
         2. Wait for review feedback\n\
         3. Fix → commit → push again if needed\n\
         4. Wait for 🎉 PR MERGED (human merges)\n\
         5. Then `git_worktree_delete`\n\
         \n\
         🔴 CHANGES REQUESTED / ❌ CI FAILED → fix → git_commit → git_push_pr\n\
         🎉 PR MERGED → git_worktree_delete → done\n\
         \n\
         ## MCP Tools\n\
         \n\
         | Tool | Purpose |\n\
         |------|----------|\n\
         | `mcp__stackbox__git_commit` | Stage and commit all changes |\n\
         | `mcp__stackbox__git_push_pr` | Push branch and open PR |\n\
         | `mcp__stackbox__git_worktree_delete` | Clean up after PR MERGED |\n\
         \n\
         Playbooks: `.stackbox/commands/` — read when needed, not upfront.\n\
         "
    )
}

/// Returns `target` as a path relative to `base`.
fn pathdiff_simple(base: &str, target: &str) -> String {
    use std::path::{Component, Path};
    let base_path   = Path::new(base);
    let target_path = Path::new(target);

    let base_comps: Vec<_>   = base_path.components().collect();
    let target_comps: Vec<_> = target_path.components().collect();

    let common = base_comps.iter().zip(target_comps.iter())
        .take_while(|(a, b)| a == b)
        .count();

    let up   = base_comps.len() - common;
    let down = &target_comps[common..];

    let mut parts: Vec<String> = std::iter::repeat("..".to_string()).take(up).collect();
    for c in down {
        if let Component::Normal(s) = c {
            parts.push(s.to_string_lossy().to_string());
        }
    }

    if parts.is_empty() { ".".to_string() } else { parts.join("/") }
}