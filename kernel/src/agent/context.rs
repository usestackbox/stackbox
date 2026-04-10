// src/agent/context.rs
//
// Writes CONTEXT.md to AppData when a PTY agent is detected.
// Path: <appdata>/calus/<hash>/agents/<runbox_id>/CONTEXT.md
//
// NOTHING is written to the user's repo.
//
// Agents learn:
//  - Their worktree location (~/calus/<hash>/.worktrees/)
//  - That THEY must call git_ensure with a name slug — Calus never pre-creates worktrees
//  - Strict STATE.md / session summary formats for the injector

pub fn inject(
    cwd: &str,
    runbox_id: &str,
    session_id: &str,
    agent_kind: &str,
    _worktree_path: Option<&str>,
) -> Result<(), String> {
    let agent_dir = crate::workspace::persistent::agent_dir(cwd, runbox_id);
    std::fs::create_dir_all(&agent_dir).map_err(|e| e.to_string())?;

    let context_path = agent_dir.join("CONTEXT.md");
    let content = build(cwd, runbox_id, session_id, agent_kind);
    std::fs::write(&context_path, content).map_err(|e| e.to_string())?;
    eprintln!("[context] wrote: {}", context_path.display());
    Ok(())
}

pub fn context_file_path(cwd: &str, runbox_id: &str) -> std::path::PathBuf {
    crate::workspace::persistent::agent_dir(cwd, runbox_id).join("CONTEXT.md")
}

fn build(cwd: &str, runbox_id: &str, session_id: &str, agent_kind: &str) -> String {
    let workspace_md = crate::workspace::persistent::workspace_md_path(cwd);
    let graph_md     = crate::workspace::persistent::graph_md_path(cwd);
    let wt_base      = crate::workspace::persistent::worktrees_base(cwd);
    let wt_base_str  = wt_base.to_string_lossy();

    format!(
        "# Calus Agent Context\n\
         \n\
         - Runbox ID:  `{runbox_id}`\n\
         - Session ID: `{session_id}`\n\
         - Kind:       `{agent_kind}`\n\
         - Workspace:  `{cwd}`\n\
         \n\
         ## Your Worktree\n\
         \n\
         Calus does NOT create your worktree. Call `git_ensure` with a `name` that\n\
         describes your task — a short lowercase slug, no spaces.\n\
         \n\
         Good names:  `fix-null-crash`  `feat-oauth`  `bug-login-loop`  `refactor-db`\n\
         \n\
         After `git_ensure` Calus creates:\n\
         \n\
         ```\n\
         worktree → {wt_base_str}/{agent_kind}-<name>/\n\
         branch   → calus/{agent_kind}/<name>\n\
         ```\n\
         \n\
         `cd` into your worktree before editing ANY file.\n\
         ⚠️  NEVER edit `{cwd}` directly — ALL changes go inside your worktree.\n\
         \n\
         ## Persistent Memory\n\
         \n\
         STATE.md and LOG.md live INSIDE your worktree (Calus creates them on first `git_ensure`):\n\
         \n\
         ```\n\
         {wt_base_str}/{agent_kind}-<name>/STATE.md\n\
         {wt_base_str}/{agent_kind}-<name>/LOG.md\n\
         ```\n\
         \n\
         graph:     {graph}\n\
         workspace: {ws}\n\
         \n\
         ## ⚠️ STATE.md Format — STRICT\n\
         \n\
         Keep signal fields as single `key: value` lines. Free-form prose goes in `## notes` only.\n\
         \n\
         ```\n\
         # state\n\
         agent: {agent_kind}\n\
         branch: calus/{agent_kind}/<name>\n\
         status: in-progress\n\
         updated: <ISO timestamp>\n\
         \n\
         ## doing\n\
         - <one line: what you are doing RIGHT NOW>\n\
         \n\
         ## next\n\
         - <one line: immediate next step>\n\
         \n\
         ## blocked\n\
         - <blocker or ->\n\
         \n\
         ## done\n\
         - <completed item>\n\
         \n\
         ## notes\n\
         Free-form here only.\n\
         ```\n\
         \n\
         ## ⚠️ Session Summary Format — STRICT\n\
         \n\
         ```\n\
         goal: <one line>\n\
         done: <comma-separated list>\n\
         blocked: <blocker or ->\n\
         next: <first thing on resume>\n\
         ```\n\
         \n\
         No prose. No headers. Four key: value lines only.\n\
         \n\
         ## Memory Rules\n\
         \n\
         - ON START: call `git_worktree_get` — if worktree exists, cd in and read STATE.md\n\
         - ON START: if no worktree → call `git_ensure` with a descriptive `name`\n\
         - DURING WORK: update `## doing` + `## next` after each action\n\
         - LOG FORMAT: `- [YYYY-MM-DD HH:MM] action — reason`\n\
         - ON FINISH: set `status: done`, move items to `## done`\n\
         - ON SESSION END: call `session_summary` MCP with goal/done/blocked/next\n\
         - NEVER write memory files into `{cwd}`\n\
         - NEVER create a new worktree if one already exists for this task\n\
         - Update GRAPH.md if you overlap with another agent\n\
         \n\
         ## MCP Tools\n\
         \n\
         ```\n\
         mcp__calus__git_ensure           → create your worktree (required: name, agent_kind, cwd, runbox_id)\n\
         mcp__calus__git_worktree_get     → check if worktree exists\n\
         mcp__calus__git_commit           → stage + commit all changes\n\
         mcp__calus__git_merge_branch     → human triggers merge into main\n\
         mcp__calus__git_delete_branch    → cleanup after merge\n\
         mcp__calus__set_agent_status     → update your status\n\
         ```\n\
         \n\
         ## ⚠️ Do NOT merge your own branch\n\
         \n\
         1. Call `git_ensure` with your task name → get worktree path\n\
         2. cd into `{wt_base_str}/{agent_kind}-<name>/`\n\
         3. Commit as you go with `git_commit`\n\
         4. Set `status: done` in STATE.md when finished\n\
         5. Call `session_summary` with goal/done/blocked/next\n\
         6. Human reviews the diff and triggers `git_merge_branch`\n\
         7. Branch cleaned up with `git_delete_branch` after merge\n\
         ",
        runbox_id   = runbox_id,
        session_id  = session_id,
        agent_kind  = agent_kind,
        cwd         = cwd,
        wt_base_str = wt_base_str,
        graph       = graph_md.display(),
        ws          = workspace_md.display(),
    )
}