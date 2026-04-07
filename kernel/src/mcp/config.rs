// src-tauri/src/mcp/config.rs
//
// Writes MCP server config files for each supported agent.
// Called once on agent spawn so the agent discovers the Stackbox MCP server.
//
// FIX: configs are written to BOTH the main cwd AND the worktree path.
// Agents like Codex run inside cwd (stackbox-web/) not inside the worktree,
// so without writing to cwd they would get "unknown MCP server 'stackbox'".

use crate::workspace::context::MEMORY_PORT;

/// Write MCP configs to cwd and, if provided, to the worktree as well.
///
/// - `cwd`        — the main project directory (where the agent shell starts)
/// - `worktree`   — the agent's isolated git worktree (may differ from cwd)
/// - `runbox_id`  — used to build the MCP server URL
/// - `session_id` — used as the Bearer auth token
pub fn write_mcp_config(
    cwd: &str,
    worktree: Option<&str>,
    runbox_id: &str,
    session_id: &str,
) -> Result<(), String> {
    let url = format!("http://127.0.0.1:{}/mcp/{}", MEMORY_PORT, runbox_id);
    let auth = format!("Bearer {}", session_id);

    // Collect all directories that need configs written.
    // Always include cwd. Include worktree only when it differs from cwd.
    let mut dirs: Vec<&str> = vec![cwd];
    if let Some(wt) = worktree {
        if wt != cwd {
            dirs.push(wt);
        }
    }

    for dir in dirs {
        write_configs_to_dir(dir, &url, &auth)?;
        eprintln!("[mcp] configs written to {dir} for runbox={runbox_id}");
    }

    Ok(())
}

/// Write all agent config files into a single directory.
fn write_configs_to_dir(dir: &str, url: &str, auth: &str) -> Result<(), String> {
    let base = std::path::Path::new(dir);

    // ── Claude Code (.claude/mcp.json) ───────────────────────────────────────
    write_json(
        base.join(".claude").join("mcp.json"),
        serde_json::json!({
            "mcpServers": {
                "stackbox": {
                    "type": "http", "url": url,
                    "headers": { "Authorization": auth },
                    "description": "Stackbox workspace — call workspace_read before starting any task"
                }
            }
        }),
    )?;

    // ── Codex (.codex/mcp.json) ───────────────────────────────────────────────
    write_json(
        base.join(".codex").join("mcp.json"),
        serde_json::json!({
            "mcpServers": {
                "stackbox": { "type": "http", "url": url, "headers": { "Authorization": auth } }
            }
        }),
    )?;

    // ── Gemini CLI (.gemini/mcp.json) ─────────────────────────────────────────
    write_json(
        base.join(".gemini").join("mcp.json"),
        serde_json::json!({
            "mcpServers": [{
                "name": "stackbox",
                "transport": { "type": "http", "url": url },
                "headers": { "Authorization": auth }
            }]
        }),
    )?;

    // ── OpenCode (.opencode/mcp.json) ─────────────────────────────────────────
    write_json(
        base.join(".opencode").join("mcp.json"),
        serde_json::json!({
            "providers": [{ "name": "stackbox", "type": "http", "url": url,
                "headers": { "Authorization": auth } }]
        }),
    )?;

    // ── Cursor Agent (.cursor/mcp.json) ───────────────────────────────────────
    write_json(
        base.join(".cursor").join("mcp.json"),
        serde_json::json!({
            "mcpServers": {
                "stackbox": {
                    "command": "npx", "args": ["-y", "mcp-remote", url],
                    "env": { "MCP_REMOTE_HEADER_AUTHORIZATION": auth }
                }
            }
        }),
    )?;

    // ── GitHub Copilot (.github/mcp.json) ─────────────────────────────────────
    write_json(
        base.join(".github").join("mcp.json"),
        serde_json::json!({
            "mcpServers": {
                "stackbox": {
                    "type": "http", "url": url,
                    "headers": { "Authorization": auth }
                }
            }
        }),
    )?;

    Ok(())
}

fn write_json(path: std::path::PathBuf, value: serde_json::Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    std::fs::write(&path, serde_json::to_string_pretty(&value).unwrap())
        .map_err(|e| format!("write {}: {e}", path.display()))
}
