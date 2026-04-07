// features/memory/memoryTypes.ts
import { C } from "../../design";

export interface Memory {
  id: string;
  runbox_id: string;
  session_id: string;
  content: string;
  pinned: boolean;
  timestamp: number;
  branch: string;
  commit_type: string;
  tags: string;
  parent_id: string;
  agent_name: string;
  memory_type: string;
  importance: number;
  resolved: boolean;
  decay_at: number;
  scope: string;
  agent_type: string;
  level: string;
  agent_id: string;
  key: string;
}

export type MemTab = "LOCKED" | "PREFERRED" | "TEMPORARY" | "SESSION" | "all" | "context";

export interface LevelMeta {
  label: string;
  icon: string;
  color: string;
  bg: string;
  desc: string;
}

export const LEVEL_META: Record<string, LevelMeta> = {
  LOCKED: {
    label: "Locked",
    icon: "🔒",
    color: C.amber,
    bg: C.amberBg,
    desc: "Hard constraints. Set by you. Agents can never violate these.",
  },
  PREFERRED: {
    label: "Preferred",
    icon: "◎",
    color: C.blue,
    bg: C.blueDim,
    desc: "Persistent facts. Key-versioned — writing port=3456 resolves old port=3000.",
  },
  TEMPORARY: {
    label: "Temporary",
    icon: "⏳",
    color: C.t2,
    bg: C.tealDim,
    desc: "Agent working notes. Private per agent. Auto-expires when session ends.",
  },
  SESSION: {
    label: "Sessions",
    icon: "⌛",
    color: C.teal,
    bg: C.tealDim,
    desc: "End-of-session summaries. Last 3 per agent kept. Agents see each other's.",
  },
  all: {
    label: "All",
    icon: "≡",
    color: C.t2,
    bg: "transparent",
    desc: "All memories across all levels.",
  },
  context: {
    label: "Context",
    icon: "↺",
    color: C.teal,
    bg: "transparent",
    desc: "What agents receive when they call memory_context().",
  },
};

export const AGENT_COLOR: Record<string, { fg: string; bg: string }> = {
  "claude-code": { fg: C.amber, bg: C.amberBg },
  codex: { fg: C.green, bg: C.greenBg },
  gemini: { fg: C.blue, bg: C.blueDim },
  cursor: { fg: C.teal, bg: C.tealDim },
  copilot: { fg: C.blue, bg: C.blueDim },
  human: { fg: C.t2, bg: C.bg3 },
};

export function agentStyle(at: string) {
  return AGENT_COLOR[at?.toLowerCase()] ?? { fg: C.t3, bg: C.bg3 };
}

export function effectiveLevel(m: Memory): string {
  if (m.level && m.level !== "") return m.level;
  const mt = m.memory_type || "";
  if (mt === "goal") return "LOCKED";
  if (mt === "session") return "SESSION";
  if (mt === "blocker") return "TEMPORARY";
  if (mt === "environment" || mt === "codebase" || mt === "failure") return "PREFERRED";
  return "PREFERRED";
}

export function reltime(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}
