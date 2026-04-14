    // src/mcp/config.rs
    //
    // Writes ONE shared MCP config to ~/calus/mcp/mcp.json.
    // Never written to the user's repo or worktree.
    //
    // Called once per spawn, stamps the current session_id as the Bearer token.
    // Agents receive the config via --mcp-config CLI flag at launch.
    //
    // Also auto-installs the stdio bridge (index.js + package.json) to
    // ~/calus/mcp/ on first spawn — embedded at compile time via include_str!.
    // This gives Gemini (and any future agent that prefers stdio) a working
    // calus MCP server without any manual setup by the user.

    use crate::MEMORY_PORT;

    // ── Embedded stdio bridge files ───────────────────────────────────────────────
    // Paths are relative to this file (src/mcp/config.rs).
    // The .calus/ folder must live at kernel/.calus/ in the repo.
    const MCP_INDEX_JS:     &str = include_str!("bridge/index.js");
    const MCP_PACKAGE_JSON: &str = include_str!("bridge/package.json");

    // ─────────────────────────────────────────────────────────────────────────────

    /// Returns ~/calus/mcp/mcp.json
    pub fn mcp_config_path() -> std::path::PathBuf {
        dirs::data_local_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .join("calus")
            .join("mcp")
            .join("mcp.json")
    }

    /// Returns ~/calus/mcp/  (the directory that holds index.js + mcp.json)
    pub fn mcp_dir() -> std::path::PathBuf {
        dirs::data_local_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .join("calus")
            .join("mcp")
    }

    /// Ensure index.js and package.json exist on disk.
    ///
    /// Idempotent — skips files that are already present so repeated spawns are
    /// fast and don't clobber user edits.  Returns the mcp/ directory path so
    /// callers can build the full index.js path without duplicating logic.
    pub fn ensure_stdio_bridge() -> Result<std::path::PathBuf, String> {
        let dir = mcp_dir();

        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("calus mcp dir: {e}"))?;

        let index = dir.join("index.js");
        if !index.exists() {
            std::fs::write(&index, MCP_INDEX_JS)
                .map_err(|e| format!("write index.js: {e}"))?;
            eprintln!("[mcp] stdio bridge installed: {}", index.display());
        }

        let pkg = dir.join("package.json");
        if !pkg.exists() {
            std::fs::write(&pkg, MCP_PACKAGE_JSON)
                .map_err(|e| format!("write package.json: {e}"))?;
            eprintln!("[mcp] package.json installed: {}", pkg.display());
        }

        Ok(dir)
    }

    /// Write ~/calus/mcp/mcp.json.
    ///
    /// Contains two entries:
    ///   "calus"       — HTTP, used by Claude Code / Codex / Cursor / Copilot
    ///   "calus-stdio" — stdio via node, used by Gemini and any agent that
    ///                   sets GEMINI_MCP_CONFIG or prefers stdio over HTTP
    ///
    /// Also calls ensure_stdio_bridge() so index.js is always on disk before
    /// any agent tries to use it.
    pub fn write_mcp_config(session_id: &str) -> Result<(), String> {
        let http_url = format!("http://127.0.0.1:{}/mcp", MEMORY_PORT);
        let auth     = format!("Bearer {}", session_id);
        let path     = mcp_config_path();

        // Ensure the stdio bridge files exist — idempotent, fast after first run
        let bridge_dir = ensure_stdio_bridge()?;
        let index_path = bridge_dir.join("index.js");

        write_json(
            path.clone(),
            serde_json::json!({
                "mcpServers": {
                    // ── HTTP entry ────────────────────────────────────────────────
                    // Claude Code, Codex, Cursor Agent, GitHub Copilot all read
                    // --mcp-config and connect here directly.
                    "calus": {
                        "type": "http",
                        "url": http_url,
                        "headers": { "Authorization": auth },
                        "description": "Calus workspace — call git_ensure before starting any task"
                    },

                    // ── Stdio entry ───────────────────────────────────────────────
                    // Gemini reads GEMINI_MCP_CONFIG which points at this same
                    // mcp.json.  The stdio bridge proxies to the kernel HTTP server
                    // and falls back to local git/fs ops if the kernel is unreachable.
                    "calus-stdio": {
                        "type": "stdio",
                        "command": "node",
                        "args": [index_path.to_string_lossy()],
                        "env": {
                            "CALUS_PORT":  MEMORY_PORT.to_string(),
                            "CALUS_TOKEN": auth
                        }
                    }
                }
            }),
        )?;

        eprintln!("[mcp] config written: {}", path.display());
        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────────────

    fn write_json(path: std::path::PathBuf, value: serde_json::Value) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        std::fs::write(&path, serde_json::to_string_pretty(&value).unwrap())
            .map_err(|e| format!("write {}: {e}", path.display()))
    }