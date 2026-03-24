// src-tauri/src/agent/context.rs
//
// Writes agent-specific context files when an agent is spawned.
// Each agent reads from a different file path — this writes them all.
//
// Trigger: AgentSpawned (called from pty/mod.rs after spawn)
// NOT triggered by FileChanged — too noisy.

use std::path::Path;

use crate::{
    db::Db,
    agent::kind::AgentKind,
    mcp::config::write_mcp_config,
    workspace::context::{build, MEMORY_PORT},
};

/// Write all context files for the given agent.
/// Idempotent — safe to call multiple times.
pub async fn inject(
    db:         &Db,
    runbox_id:  &str,
    session_id: &str,
    cwd:        &str,
    agent:      &AgentKind,
) -> Result<(), String> {
    let content = build(db, runbox_id, session_id, cwd, agent).await?;
    let base    = Path::new(cwd);

    // Always write the shared context file
    std::fs::write(base.join(".stackbox-context.md"), &content)
        .map_err(|e| format!("write .stackbox-context.md: {e}"))?;

    // Agent-specific files
    let targets = agent_targets(agent);
    let skill_name = skill_name_for(agent);
    let skill_content = format!(
        "---\nname: {skill_name}\ndescription: Stackbox workspace context. Read before starting any task.\n---\n\n{content}"
    );

    for (rel_path, preserve_existing) in &targets {
        let path = base.join(rel_path);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }

        let raw = if rel_path.contains("/skills/stackbox/SKILL.md") {
            skill_content.clone()
        } else {
            content.clone()
        };

        let final_content = if *preserve_existing {
            let existing = std::fs::read_to_string(&path).unwrap_or_default();
            merge_into_existing(&existing, &raw)
        } else {
            raw
        };

        std::fs::write(&path, final_content)
            .map_err(|e| format!("write {rel_path}: {e}"))?;
    }

    // MCP config for agents that support it
    if *agent != AgentKind::Shell {
        if let Err(e) = write_mcp_config(cwd, runbox_id, session_id) {
            eprintln!("[agent::context] write_mcp_config: {e}");
        }
    }

    eprintln!("[agent::context] injected context for {:?} in {cwd}", agent);

    Ok(())
}

fn agent_targets(agent: &AgentKind) -> Vec<(&'static str, bool)> {
    match agent {
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
            // Single skill path — avoids "skill conflict" warning
            (".agents/skills/stackbox/SKILL.md", false),
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
    }
}

fn skill_name_for(agent: &AgentKind) -> &'static str {
    match agent {
        AgentKind::ClaudeCode    => "stackbox-context-claude",
        AgentKind::Codex         => "stackbox-context-codex",
        AgentKind::GeminiCli     => "stackbox-context-gemini",
        AgentKind::CursorAgent   => "stackbox-context-cursor",
        AgentKind::GitHubCopilot => "stackbox-context-copilot",
        AgentKind::Shell         => "stackbox-context",
    }
}

fn merge_into_existing(existing: &str, new_block: &str) -> String {
    const START: &str = "<!-- stackbox:start -->";
    const END:   &str = "<!-- stackbox:end -->";
    let block = format!("{START}\n{new_block}\n{END}");

    if existing.trim().is_empty() {
        return block + "\n";
    }
    if let (Some(s), Some(e)) = (existing.find(START), existing.find(END)) {
        format!("{}{block}{}", &existing[..s], &existing[e + END.len()..])
    } else {
        format!("{block}\n\n{existing}")
    }
}