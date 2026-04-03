// lib/fileFilter.ts
// Rules for which file paths should be hidden from the Changes panel.
// Pure functions — no React, no side effects.

const BLOCKED_NAMES = new Set([
  ".stackbox-context.md", "claude.md", "agents.md", "gemini.md",
  "opencode.md", "copilot-instructions.md", "mcp.json", "skill.md",
  "payload.json", "rewrite_app.py", "update_app.py",
]);

const BLOCKED_PREFIXES = [
  ".claude/", ".gemini/", ".codex/", ".cursor/",
  ".agents/", ".opencode/", ".github/skills/", ".github/copilot",
];

function isTempFile(name: string): boolean {
  return /^(rewrite_|update_|patch_|fix_|temp_|tmp_).*\.(py|js|sh|ps1)$/.test(name);
}

/** Returns true if this file path should be excluded from the Changes panel. */
export function shouldBlock(path: string): boolean {
  const norm = path.replace(/\\/g, "/").toLowerCase();
  const name = norm.split("/").pop() ?? "";
  return (
    BLOCKED_NAMES.has(name) ||
    isTempFile(name) ||
    BLOCKED_PREFIXES.some(p => norm.startsWith(p))
  );
}
