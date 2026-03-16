// src-tauri/src/agent/kind.rs

#[derive(Debug, Clone, PartialEq)]
pub enum AgentKind {
    ClaudeCode,
    Codex,
    CursorAgent,
    GeminiCli,
    GitHubCopilot,
    OpenCode,
    Shell,
}

impl AgentKind {
    pub fn detect(cmd: &str) -> Self {
        let c = cmd.trim().to_lowercase();
        if c.contains("claude")   { return Self::ClaudeCode; }
        if c.contains("codex")    { return Self::Codex; }
        if c == "agent" || c.ends_with("/agent") || c.ends_with("\\agent") {
            return Self::CursorAgent;
        }
        if c.contains("gemini")   { return Self::GeminiCli; }
        if c.contains("copilot")  { return Self::GitHubCopilot; }
        if c.contains("opencode") { return Self::OpenCode; }
        Self::Shell
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            Self::ClaudeCode    => "Claude Code",
            Self::Codex         => "OpenAI Codex CLI",
            Self::CursorAgent   => "Cursor Agent",
            Self::GeminiCli     => "Gemini CLI",
            Self::GitHubCopilot => "GitHub Copilot",
            Self::OpenCode      => "OpenCode",
            Self::Shell         => "Shell",
        }
    }

    /// Returns the shell command to auto-launch the agent after bash starts.
    pub fn launch_cmd(&self, ctx_file: &str) -> Option<String> {
        match self {
            Self::ClaudeCode    => Some(format!("claude --append-system-prompt-file {ctx_file}\n")),
            Self::GeminiCli     => Some("gemini\n".to_string()),
            Self::Codex         => Some("codex\n".to_string()),
            Self::OpenCode      => Some("opencode\n".to_string()),
            Self::CursorAgent   => Some("agent\n".to_string()),
            Self::GitHubCopilot => Some("gh copilot suggest\n".to_string()),
            Self::Shell         => None,
        }
    }

    /// Infer agent kind from PTY banner output.
    /// Used to upgrade a Shell session once the agent binary announces itself.
    pub fn infer_from_output(text: &str) -> Option<Self> {
        if text.contains("OpenAI Codex")                        { return Some(Self::Codex); }
        if text.contains("Gemini CLI") || text.contains("gemini>") { return Some(Self::GeminiCli); }
        if text.contains("Claude Code") || text.contains("claude>") { return Some(Self::ClaudeCode); }
        if text.contains("OpenCode")                            { return Some(Self::OpenCode); }
        None
    }
}
