// src/agent/context.rs
//
// Writes CONTEXT.md to AppData when a PTY agent is detected.
// Path: <appdata>/calus/<hash>/agents/<runbox_id>/CONTEXT.md
//
// Also writes .codex/config.yaml into the user's repo to put Codex into
// full-auto mode (no mid-task approval prompts).
//
// Platform support: Windows, macOS, Linux, containers.
// NOTHING agent-specific is written to the user's repo except
// .codex/config.yaml and the .gitignore update (both intentional).

use std::path::Path;

pub fn inject(
    cwd: &str,
    runbox_id: &str,
    session_id: &str,
    agent_kind: &str,
    _worktree_path: Option<&str>,
) -> Result<(), String> {
    let agent_dir = crate::workspace::persistent::agent_dir(cwd, runbox_id);
    std::fs::create_dir_all(&agent_dir).map_err(|e| e.to_string())?;

    // Write CONTEXT.md to AppData — agent instruction file.
    let context_path = agent_dir.join("CONTEXT.md");
    let content = build(cwd, runbox_id, session_id, agent_kind);
    std::fs::write(&context_path, content).map_err(|e| e.to_string())?;
    eprintln!("[context] wrote: {}", context_path.display());

    // Write .codex/config.yaml to suppress Codex approval prompts.
    write_codex_config(cwd)?;

    Ok(())
}

pub fn context_file_path(cwd: &str, runbox_id: &str) -> std::path::PathBuf {
    crate::workspace::persistent::agent_dir(cwd, runbox_id).join("CONTEXT.md")
}

/// Writes .codex/config.yaml into the user's repo.
/// Supports both camelCase and kebab-case keys so it works across
/// all Codex CLI versions.
fn write_codex_config(cwd: &str) -> Result<(), String> {
    let codex_dir = Path::new(cwd).join(".codex");
    std::fs::create_dir_all(&codex_dir)
        .map_err(|e| format!("mkdir .codex: {e}"))?;

    let config_path = codex_dir.join("config.yaml");

    // Only write if not already present — respect user customisation.
    if config_path.exists() {
        return Ok(());
    }

    // Both camelCase and kebab-case keys are written so this works
    // across every Codex CLI version without knowing which one is installed.
    let content = "\
# Calus-managed Codex config.
# Generated automatically on first agent spawn — do not delete.

# Never ask for shell-command approval.
# Calus handles safety at the kernel level.
approval-policy: never
approvalPolicy: never

# Keep terminal output clean.
disable-update-check: true
disableUpdateCheck: true

# Codex must not open a browser on its own.
disable-browser: true
disableBrowser: true
";
    std::fs::write(&config_path, content)
        .map_err(|e| format!("write .codex/config.yaml: {e}"))?;

    eprintln!("[context] wrote: {}", config_path.display());
    Ok(())
}

fn build(cwd: &str, runbox_id: &str, session_id: &str, agent_kind: &str) -> String {
    let workspace_md = crate::workspace::persistent::workspace_md_path(cwd);
    let graph_md     = crate::workspace::persistent::graph_md_path(cwd);
    let wt_base      = crate::workspace::persistent::worktrees_base(cwd);
    let wt_base_str  = wt_base.to_string_lossy();

    // Build the example worktree path using the correct OS separator.
    let sep = std::path::MAIN_SEPARATOR;

    format!(
        "# Calus Agent Context\n\
         \n\
         - Runbox ID:  `{runbox_id}`\n\
         - Session ID: `{session_id}`\n\
         - Kind:       `{agent_kind}`\n\
         - Workspace:  `{cwd}`\n\
         \n\
         ## ⚠️ CRITICAL — Read This Before Doing Anything\n\
         \n\
         You are running inside the Calus multi-agent terminal.\n\
         Calus manages ALL git operations via MCP tools.\n\
         \n\
         **NEVER run `git worktree add`, `git branch`, or `git checkout` directly.**\n\
         **NEVER construct your own worktree path.**\n\
         **NEVER create `.agents/` or `AGENTS.md` in the workspace.**\n\
         **ALL git actions go through MCP tools — no exceptions.**\n\
         \n\
         ## Your Worktree\n\
         \n\
         Worktrees are created at EXACTLY this base path by Calus:\n\
         \n\
         ```\n\
         {wt_base_str}{sep}{{agent_kind}}-{{slug}}{sep}\n\
         ```\n\
         \n\
         You do not compute this path yourself. Calus returns it from `git_ensure`.\n\
         \n\
         ### How to get your worktree\n\
         \n\
         1. Call `mcp__calus__git_worktree_get` first.\n\
            - If it exists → cd into it, read STATE.md, resume work.\n\
            - If it does not exist → go to step 2.\n\
         2. Call `mcp__calus__git_ensure` with a short task slug.\n\
            - Good slugs: `fix-login`, `feat-auth`, `bug-crash`, `refactor-db`\n\
            - Calus creates the worktree and returns the exact path.\n\
         3. cd into the returned path immediately.\n\
         4. Never edit any file inside `{cwd}` directly.\n\
         \n\
         ✅ `mcp__calus__git_ensure(name: \"fix-login\", agent_kind: \"{agent_kind}\", ...)`\n\
         ❌ `git worktree add ...`  — DO NOT DO THIS\n\
         ❌ Any path you construct yourself\n\
         ❌ Editing files in `{cwd}` directly\n\
         \n\
         ## Persistent Memory\n\
         \n\
         STATE.md and LOG.md live inside your worktree (Calus creates them on `git_ensure`):\n\
         \n\
         ```\n\
         {wt_base_str}{sep}{{agent_kind}}-{{slug}}{sep}STATE.md\n\
         {wt_base_str}{sep}{{agent_kind}}-{{slug}}{sep}LOG.md\n\
         ```\n\
         \n\
         Shared files (read-only for you unless instructed):\n\
         \n\
         ```\n\
         graph:     {graph}\n\
         workspace: {ws}\n\
         memory:    {mem}\n\
         ```\n\
         \n\
         ## Cross-Agent Memory\n\
         \n\
         MEMORY.md is shared by ALL agents in this workspace.\n\
         First 200 lines are injected into every session automatically.\n\
         \n\
         ```\n\
         calus_memory_read(cwd)              — read index and past learnings\n\
         calus_memory_append(cwd, learning)  — record a one-line insight\n\
         calus_memory_set_command(cwd, k, v) — record build/test/lint commands\n\
         calus_memory_write_topic(cwd, name) — deep notes, loaded on demand\n\
         calus_session_summary(...)          — end-of-session summary\n\
         ```\n\
         \n\
         ## STATE.md Format — STRICT\n\
         \n\
         Signal fields must be single `key: value` lines.\n\
         Free-form prose goes in `## notes` ONLY.\n\
         \n\
         ```\n\
         # state\n\
         agent: {agent_kind}\n\
         branch: calus/{agent_kind}/{{slug}}\n\
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
         Free-form observations here only.\n\
         ```\n\
         \n\
         ## Session Summary Format — STRICT\n\
         \n\
         Exactly four key: value lines. No prose. No headers.\n\
         \n\
         ```\n\
         goal: <one line>\n\
         done: <comma-separated list>\n\
         blocked: <blocker or ->\n\
         next: <first thing on resume>\n\
         ```\n\
         \n\
         ## Rules\n\
         \n\
         - ON START: call `git_worktree_get` — resume if exists, create if not\n\
         - DURING WORK: update `## doing` and `## next` after each action\n\
         - LOG FORMAT: `- [YYYY-MM-DD HH:MM] action — reason`\n\
         - ON FINISH: set `status: done`, move items to `## done`\n\
         - ON END: call `session_summary` with goal/done/blocked/next\n\
         - NEVER write memory files into `{cwd}`\n\
         - NEVER create a new worktree if one exists for this task\n\
         - NEVER run git commands directly — MCP tools only\n\
         - NEVER create `.agents/` folder or `AGENTS.md` in the repo\n\
         - Update GRAPH.md only if you overlap with another agent\n\
         \n\
         ## MCP Tools Reference\n\
         \n\
         ```\n\
         mcp__calus__git_ensure        → create worktree (call before any file edit)\n\
         mcp__calus__git_worktree_get  → check if worktree exists\n\
         mcp__calus__git_commit        → stage and commit changes\n\
         mcp__calus__git_merge_branch  → human triggers merge (not you)\n\
         mcp__calus__git_delete_branch → cleanup after merge\n\
         mcp__calus__set_agent_status  → update your status\n\
         ```\n\
         ",
        runbox_id   = runbox_id,
        session_id  = session_id,
        agent_kind  = agent_kind,
        cwd         = cwd,
        sep         = sep,
        wt_base_str = wt_base_str,
        graph       = graph_md.display(),
        ws          = workspace_md.display(),
        mem         = crate::workspace::context::memory_md_path(cwd).display(),
    )
}