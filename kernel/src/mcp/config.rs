// src/mcp/config.rs
//
// Writes ONE shared MCP config to ~/calus/mcp/mcp.json.
// Never written to the user's repo or worktree.
//
// Called once per spawn, stamps the current session_id as the Bearer token.
// Agents receive the config via --mcp-config CLI flag at launch.

use crate::MEMORY_PORT;

/// ~/calus/mcp/mcp.json
pub fn mcp_config_path() -> std::path::PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("calus")
        .join("mcp")
        .join("mcp.json")
}

pub fn write_mcp_config(session_id: &str) -> Result<(), String> {
    let url = format!("http://127.0.0.1:{}/mcp", MEMORY_PORT);
    let auth = format!("Bearer {}", session_id);
    let path = mcp_config_path();

    write_json(
        path.clone(),
        serde_json::json!({
            "mcpServers": {
                "calus": {
                    "type": "http",
                    "url": url,
                    "headers": { "Authorization": auth },
                    "description": "Calus workspace — call git_ensure before starting any task"
                }
            }
        }),
    )?;

    eprintln!("[mcp] config written: {}", path.display());
    Ok(())
}

fn write_json(path: std::path::PathBuf, value: serde_json::Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    std::fs::write(&path, serde_json::to_string_pretty(&value).unwrap())
        .map_err(|e| format!("write {}: {e}", path.display()))
}
