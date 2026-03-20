// src-tauri/src/mcp/config.rs
//
// Writes MCP server config files for each supported agent.
// Called once on agent spawn so the agent discovers the Stackbox MCP server.

use crate::workspace::context::MEMORY_PORT;

pub fn write_mcp_config(cwd: &str, runbox_id: &str, session_id: &str) -> Result<(), String> {
    let base = std::path::Path::new(cwd);
    let url  = format!("http://127.0.0.1:{}/mcp/{}", MEMORY_PORT, runbox_id);
    let auth = format!("Bearer {}", session_id);

    // Claude Code
    write_json(base.join(".claude").join("mcp.json"), serde_json::json!({
        "mcpServers": {
            "stackbox": {
                "type": "http", "url": url,
                "headers": { "Authorization": auth },
                "description": "Stackbox workspace — call workspace_read before starting any task"
            }
        }
    }))?;

    // Codex
    write_json(base.join(".codex").join("mcp.json"), serde_json::json!({
        "mcpServers": {
            "stackbox": { "type": "http", "url": url, "headers": { "Authorization": auth } }
        }
    }))?;

    // Gemini CLI
    write_json(base.join(".gemini").join("mcp.json"), serde_json::json!({
        "mcpServers": [{
            "name": "stackbox",
            "transport": { "type": "http", "url": url },
            "headers": { "Authorization": auth }
        }]
    }))?;

    // OpenCode
    write_json(base.join(".opencode").join("mcp.json"), serde_json::json!({
        "providers": [{ "name": "stackbox", "type": "http", "url": url,
            "headers": { "Authorization": auth } }]
    }))?;

    // Cursor Agent
    write_json(base.join(".cursor").join("mcp.json"), serde_json::json!({
        "mcpServers": {
            "stackbox": {
                "command": "npx", "args": ["-y", "mcp-remote", &url],
                "env": { "MCP_REMOTE_HEADER_AUTHORIZATION": &auth }
            }
        }
    }))?;

    eprintln!("[mcp] configs written for runbox={runbox_id}");
    Ok(())
}

fn write_json(path: std::path::PathBuf, value: serde_json::Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    std::fs::write(&path, serde_json::to_string_pretty(&value).unwrap())
        .map_err(|e| format!("write {}: {e}", path.display()))
}
