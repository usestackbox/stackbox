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
    pub fn detect(cmd: &str) -> Self {
        let c = cmd.trim().to_lowercase();
        if c.contains("claude")  { return Self::ClaudeCode; }
        if c.contains("codex")   { return Self::Codex; }
        if c == "agent" || c.ends_with("/agent") || c.ends_with("\\agent") {
            return Self::CursorAgent;
        }
        if c.contains("gemini")  { return Self::GeminiCli; }
        if c.contains("copilot") { return Self::GitHubCopilot; }
        Self::Shell
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            Self::ClaudeCode    => "Claude Code",
            Self::Codex         => "OpenAI Codex CLI",
            Self::CursorAgent   => "Cursor Agent",
            Self::GeminiCli     => "Gemini CLI",
            Self::GitHubCopilot => "GitHub Copilot",
            Self::Shell         => "Shell",
        }
    }

    pub fn kind_str(&self) -> &'static str {
        match self {
            Self::ClaudeCode    => "claude-code",
            Self::Codex         => "codex",
            Self::CursorAgent   => "cursor-agent",
            Self::GeminiCli     => "gemini-cli",
            Self::GitHubCopilot => "github-copilot",
            Self::Shell         => "shell",
        }
    }

    /// Mirrors exactly what the user types to start the agent.
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

    pub fn infer_from_output(text: &str) -> Option<Self> {
        if text.contains("OpenAI Codex")                                   { return Some(Self::Codex); }
        if text.contains("Gemini CLI") || text.contains("gemini>")        { return Some(Self::GeminiCli); }
        if text.contains("Claude Code") || text.contains("claude>")       { return Some(Self::ClaudeCode); }
        if text.contains("GitHub Copilot") || text.contains("gh copilot") { return Some(Self::GitHubCopilot); }
        if text.contains("Cursor Agent")                                   { return Some(Self::CursorAgent); }
        None
    }
}