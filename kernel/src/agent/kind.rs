// src-tauri/src/agent/kind.rs

#[derive(Debug, Clone, PartialEq)]
pub enum AgentKind {
    ClaudeCode,
    Codex,
    CursorAgent,
    GeminiCli,
    GitHubCopilot,
    Shell,
}

impl AgentKind {
    /// Detect agent kind from the command string passed by the frontend (agentCmd)
    /// or typed by the user in the terminal.
    ///
    /// Cursor: the CLI command is `agent` (cursor agent mode, not the GUI app).
    /// Copilot: the CLI command is `copilot` (GitHub Copilot CLI).
    pub fn detect(cmd: &str) -> Self {
        let c = cmd.trim().to_lowercase();
        let base = c
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or(c.as_str())
            .trim_end_matches(".exe");

        if base.contains("claude") {
            return Self::ClaudeCode;
        }
        if base.contains("codex") {
            return Self::Codex;
        }
        // Cursor agent CLI — invoked as `agent` in the terminal
        if base == "agent" {
            return Self::CursorAgent;
        }
        if base.contains("gemini") {
            return Self::GeminiCli;
        }
        // GitHub Copilot CLI — invoked as `copilot` in the terminal
        if base == "copilot" {
            return Self::GitHubCopilot;
        }
        Self::Shell
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            Self::ClaudeCode   => "Claude Code",
            Self::Codex        => "OpenAI Codex",
            Self::CursorAgent  => "Cursor Agent",
            Self::GeminiCli    => "Gemini",
            Self::GitHubCopilot => "GitHub Copilot",
            Self::Shell        => "Shell",
        }
    }

    pub fn kind_str(&self) -> &'static str {
        match self {
            Self::ClaudeCode    => "claude",
            Self::Codex         => "codex",
            Self::CursorAgent   => "cursor",
            Self::GeminiCli     => "gemini",
            Self::GitHubCopilot => "copilot",
            Self::Shell         => "shell",
        }
    }

    /// The exact command the backend sends to the PTY after the shell is ready.
    /// This is what auto-starts the agent — the user never has to type it.
    ///
    /// Cursor  → sends `agent\n`   (Cursor's terminal agent mode)
    /// Copilot → sends `copilot\n` (GitHub Copilot CLI)
    pub fn launch_cmd(&self, _ctx_file: &str) -> Option<String> {
        match self {
            Self::ClaudeCode    => Some("claude\n".to_string()),
            Self::Codex         => Some("codex\n".to_string()),
            Self::GeminiCli     => Some("gemini\n".to_string()),
            Self::CursorAgent   => Some("agent\n".to_string()),
            Self::GitHubCopilot => Some("copilot\n".to_string()),
            Self::Shell         => None,
        }
    }

    /// Infer agent kind from PTY stdout (used when a shell pane detects an agent starting).
    /// Matches output signatures each agent prints on startup.
    pub fn infer_from_output(text: &str) -> Option<Self> {
        if text.contains("OpenAI Codex") || text.contains("codex>") {
            return Some(Self::Codex);
        }
        if text.contains("Gemini CLI") || text.contains("gemini>") {
            return Some(Self::GeminiCli);
        }
        if text.contains("Claude Code") || text.contains("claude>") {
            return Some(Self::ClaudeCode);
        }
        // GitHub Copilot CLI prints this on startup
        if text.contains("GitHub Copilot") || text.contains("copilot>") {
            return Some(Self::GitHubCopilot);
        }
        // Cursor agent prints this banner
        if text.contains("Cursor Agent") || text.contains("agent>") {
            return Some(Self::CursorAgent);
        }
        None
    }
}