// features/workspace/types.ts

export interface WinState {
  id: string;
  label: string;
  kind: "terminal" | "browser";
  x: number;
  y: number;
  w: number;
  h: number;
  minimized: boolean;
  maximized: boolean;
  preMaxX?: number;
  preMaxY?: number;
  preMaxW?: number;
  preMaxH?: number;
  cwd: string;
  zIndex: number;
  /** Agent command sent to backend on pane creation (e.g. "claude", "agent"). Undefined = plain shell. */
  agentCmd?: string;
  /** Agent key detected from PTY I/O (e.g. "claude", "cursor"). Undefined = plain shell. */
  detectedAgent?: string;
  /** True when this window was auto-minimized by another window's maximize. */
  minimizedByMaximize?: boolean;
}

export interface FileTab {
  id: string;
  filePath: string;
}

export type SidePanel = "files" | "git" | "memory" | null;
export type FilesView = "list" | "diff";

export const GAP = 0;
export const MIN_W = 280;
export const MIN_H = 180;

let _topZ = 10;
export const nextZ = () => ++_topZ;

export function tileWindows(count: number, aw: number, ah: number) {
  if (count === 0) return [];
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const w = Math.floor((aw - GAP * (cols + 1)) / cols);
  const h = Math.floor((ah - GAP * (rows + 1)) / rows);
  return Array.from({ length: count }, (_, i) => ({
    x: GAP + (i % cols) * (w + GAP),
    y: GAP + Math.floor(i / cols) * (h + GAP),
    w,
    h,
  }));
}

export function winLabel(win: WinState): string {
  if (win.kind === "browser") return win.label ?? "browser";
  if (win.detectedAgent) return AGENT_META[win.detectedAgent]?.label ?? win.detectedAgent;
  if (win.agentCmd) return AGENT_META[win.agentCmd]?.label ?? win.agentCmd;
  return win.cwd.split(/[/\\]/).filter(Boolean).pop() ?? "~";
}

// ── Agent metadata ────────────────────────────────────────────────────────────
// All icon colors are #ffffff.
// Icons are dimmed via opacity (0.38) when the tab is inactive.
// Detection happens in TWO ways — both are "detected" mode:
//
//   1. agentCmd pane: backend sends the launch command automatically after
//      the shell starts (kind.rs launch_cmd). The backend emits pty://agent/{sid}
//      when it detects the agent from stdout, and the frontend sets detectedAgent.
//
//   2. Plain shell pane: user types the agent command manually. TerminalPane's
//      onData handler matches the typed command against AGENT_INPUT_CMDS,
//      and sets detectedAgent immediately on Enter.
export interface AgentMeta {
  label: string; // Display name in the tab
  color: string; // Always "#ffffff"
}

export const AGENT_META: Record<string, AgentMeta> = {
  claude:  { label: "claude",  color: "#ffffff" },
  codex:   { label: "codex",   color: "#ffffff" },
  openai:  { label: "openai",  color: "#ffffff" },
  gemini:  { label: "gemini",  color: "#ffffff" },
  cursor:  { label: "cursor",  color: "#ffffff" },
  copilot: { label: "copilot", color: "#ffffff" },
  aider:   { label: "aider",   color: "#ffffff" },
};

// ── What users type in the terminal → agent key ───────────────────────────────
// Used by TerminalPane's onData handler to detect agents in plain shell panes.
//
// Cursor: user types `agent` (NOT `cursor` — that opens the GUI app).
// Copilot: user types `copilot` (the GitHub Copilot CLI).
// No gh-copilot alias — use the actual CLI name only.
export const AGENT_INPUT_CMDS: Record<string, string> = {
  claude: "claude",
  codex: "codex",
  openai: "openai",
  gemini: "gemini",
  agent: "cursor", // Cursor's terminal agent CLI is `agent`
  copilot: "copilot", // GitHub Copilot CLI
  aider: "aider",
};