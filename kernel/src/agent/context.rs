// src-tauri/src/agent/context.rs
//
// Writes agent context files when a PTY agent is detected.
//
// ALL files go to appdata (~/.stackbox/projects/<repo>/agents/<wt>/CONTEXT.md).
// NOTHING is written to the user's repo.
//
// The shared workspace file (AGENTS.md / CLAUDE.md) is replaced by a per-agent
// context file in appdata. Agents are pointed to it via the STACKBOX_CONTEXT
// environment variable set at PTY spawn.

use std::path::Path;

// ── public entry point ────────────────────────────────────────────────────────

pub fn inject(
    cwd: &str,
    runbox_id: &str,
    session_id: &str,
    agent_kind: &str,
    worktree_path: Option<&str>,
) -> Result<(), String> {
    write_appdata_context(cwd, runbox_id, session_id, agent_kind, worktree_path)
}

// ── appdata context file ──────────────────────────────────────────────────────

/// Write the per-agent context to ~/.stackbox/projects/<repo>/agents/<runbox_id>/CONTEXT.md
/// This replaces the old .stackbox/agents/{runbox_id}.md in the user's repo.
fn write_appdata_context(
    cwd: &str,
    runbox_id: &str,
    session_id: &str,
    agent_kind: &str,
    worktree_path: Option<&str>,
) -> Result<(), String> {
    // Use runbox_id as the agent folder name (no worktree yet at inject time)
    let agent_dir = crate::workspace::persistent::agent_dir(cwd, runbox_id);
    std::fs::create_dir_all(&agent_dir).map_err(|e| e.to_string())?;

    let context_path = agent_dir.join("CONTEXT.md");
    let content = build_context_content(cwd, runbox_id, session_id, agent_kind, worktree_path);

    std::fs::write(&context_path, content).map_err(|e| e.to_string())?;
    eprintln!("[context] wrote agent context: {}", context_path.display());
    Ok(())
}

fn build_context_content(
    cwd: &str,
    runbox_id: &str,
    session_id: &str,
    agent_kind: &str,
    worktree_path: Option<&str>,
) -> String {
    let runbox_short = &runbox_id[..runbox_id.len().min(8)];
    let proj_dir = crate::workspace::persistent::project_dir(cwd);
    let workspace_md = crate::workspace::persistent::workspace_md_path(cwd);
    let graph_md = crate::workspace::persistent::graph_md_path(cwd);

    // Worktree section
    let wt_section = match worktree_path {
        Some(wt) => {
            let wt_name = crate::workspace::persistent::wt_name_from_path(wt);
            let state_p = crate::workspace::persistent::state_path(cwd, &wt_name);
            let log_p = crate::workspace::persistent::log_path(cwd, &wt_name);
            format!(
                "## Your Worktree\n\
                 \n\
                 path:   {wt}\n\
                 branch: stackbox/{runbox_short}\n\
                 \n\
                 ⚠️  All edits go INSIDE the worktree — never touch `{cwd}` directly.\n\
                 \n\
                 ## Persistent Memory\n\
                 \n\
                 state:     {state}\n\
                 log:       {log}\n\
                 graph:     {graph}\n\
                 workspace: {ws}\n\
                 \n\
                 ## Memory Rules\n\
                 \n\
                 - ON START: read state file — if exists resume from it, else create it\n\
                 - DURING WORK: update state after each action; append one line to log\n\
                 - LOG FORMAT: `- [YYYY-MM-DD HH:MM] action — reason`\n\
                 - ON FINISH: set `status: done` in state\n\
                 - NEVER write memory files into the user repo\n\
                 - NEVER create a new worktree if yours already exists\n\
                 - Update graph if you detect overlap with another agent\n\
                 \n",
                state = state_p.display(),
                log = log_p.display(),
                graph = graph_md.display(),
                ws = workspace_md.display(),
            )
        }
        None => format!(
            "## Persistent Memory\n\
             \n\
             project dir: {proj}\n\
             graph:       {graph}\n\
             workspace:   {ws}\n\
             \n\
             When you create a worktree your STATE.md and LOG.md will be at:\n\
             {proj}/agents/<wt-name>/STATE.md\n\
             {proj}/agents/<wt-name>/LOG.md\n\
             \n\
             ## Memory Rules\n\
             \n\
             - ON START: read state file — if exists resume from it, else create it\n\
             - DURING WORK: update state after each action; append one line to log\n\
             - LOG FORMAT: `- [YYYY-MM-DD HH:MM] action — reason`\n\
             - ON FINISH: set `status: done` in state\n\
             - NEVER write memory files into the user repo\n\
             \n",
            proj = proj_dir.display(),
            graph = graph_md.display(),
            ws = workspace_md.display(),
        ),
    };

    format!(
        "# Stackbox Agent Context\n\
         \n\
         - Runbox ID: `{runbox_id}`\n\
         - Session ID: `{session_id}`\n\
         - Kind: `{agent_kind}`\n\
         - Workspace: `{cwd}`\n\
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
         2. Fix → commit → push if review requests changes\n\
         3. Wait for PR MERGED (human merges)\n\
         4. Then `git_worktree_delete` → done\n\
         \n\
         ## Worktree Rules\n\
         \n\
         Before ANY task:\n\
         1. Run `git worktree list`\n\
         2. If a stackbox/* worktree exists for this task → cd into it, read STATE.md\n\
         3. If not → create one: `git worktree add ../<name> -b stackbox/{runbox_short}/<slug>`\n\
         4. ALL work stays inside the worktree — never edit the main workspace directly\n\
         "
    )
}

/// Returns the appdata path for a runbox's context file.
/// Used by pty::spawn to set STACKBOX_CONTEXT env var.
pub fn context_file_path(cwd: &str, runbox_id: &str) -> std::path::PathBuf {
    crate::workspace::persistent::agent_dir(cwd, runbox_id).join("CONTEXT.md")
}
