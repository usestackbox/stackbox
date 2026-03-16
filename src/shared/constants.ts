import type React from "react";

export const C = {
  bg0: "#0d0d0d", bg1: "#141414", bg2: "#1a1a1a",
  bg3: "#202020", bg4: "#282828", bg5: "#303030",
  border:   "rgba(255,255,255,.07)",
  borderMd: "rgba(255,255,255,.11)",
  borderHi: "rgba(255,255,255,.17)",
  t0: "#e6edf3", t1: "#8b949e", t2: "#484f58", t3: "#2d333b",
  teal:       "#e0e0e0",
  tealBright: "#ffffff",
  tealDim:    "rgba(255,255,255,.06)",
  tealBorder: "rgba(255,255,255,.18)",
  tealText:   "#e8e8e8",
  green:   "#888888",
  greenDm: "rgba(160,160,160,.10)",
  greenBg: "rgba(160,160,160,.12)",
  red:     "#b05252",
  redBright: "#f85149",
  redBg:   "rgba(248,81,73,.10)",
  amber:   "#d29922",
  amberBg: "rgba(210,153,34,.12)",
  blue:    "#58a6ff",
  blueDim: "rgba(88,166,255,.10)",
};

export const MONO = "ui-monospace,'SF Mono',Consolas,'Cascadia Code',monospace";
export const SANS = "-apple-system,'SF Pro Text',system-ui,sans-serif";

export const tbtn: React.CSSProperties = {
  background: "none", border: "none", color: C.t2, cursor: "pointer",
  padding: "2px 4px", display: "flex", alignItems: "center",
  justifyContent: "center", borderRadius: 5, lineHeight: 1,
};

export const TOPIC_COLOR: Record<string, string> = {
  "task.done":     "#888888",
  "task.started":  "#7a9ec0",
  "task.failed":   "#e05555",
  "error":         "#e05555",
  "agent.started": "#aaaaaa",
  "agent.stopped": "#444444",
  "file.changed":  "#a08040",
  "memory.added":  "#888888",
  "status":        "#555555",
};

export function topicColor(topic: string): string {
  return TOPIC_COLOR[topic] ?? C.teal;
}

export function reltime(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60_000)    return "just now";
  if (d < 3600_000)  return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86400_000) return `${Math.floor(d / 3600_000)}h ago`;
  return `${Math.floor(d / 86400_000)}d ago`;
}

export const STORAGE_KEY = "stackbox-runboxes-v2";

export function loadRunboxes() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"); } catch { return []; }
}
export function saveRunboxes(rbs: unknown[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rbs)); } catch {}
}

export const PORT = 7547;