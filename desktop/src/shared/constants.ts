// src/shared/constants.ts
import type React from "react";

// ── Pure black/white design system ───────────────────────────────────────────
// Philosophy: VS Code density + Linear cleanliness + developer precision
export const C = {
  // Backgrounds — deep blacks with subtle steps
  bg0: "#0a0a0a",   // deepest — terminal, main canvas
  bg1: "#111111",   // base panels
  bg2: "#181818",   // cards, secondary panels
  bg3: "#1f1f1f",   // hover states, inputs
  bg4: "#272727",   // active states
  bg5: "#303030",   // dropdowns, elevated

  // Borders — barely-there to visible
  border:   "rgba(255,255,255,.06)",
  borderMd: "rgba(255,255,255,.10)",
  borderHi: "rgba(255,255,255,.18)",

  // Text hierarchy
  t0: "#f2f2f2",   // primary — headings, active labels
  t1: "#999999",   // secondary — body text, descriptions
  t2: "#555555",   // tertiary — placeholders, disabled
  t3: "#333333",   // quaternary — very dim hints

  // Status — muted, not loud
  green:   "#6a9a6a",
  greenBg: "rgba(100,160,100,.10)",
  red:     "#c05050",
  redBg:   "rgba(200,80,80,.10)",
  amber:   "#a08030",
  amberBg: "rgba(160,128,48,.10)",
  blue:    "#5a7ea8",
  blueDim: "rgba(90,126,168,.10)",

  // Accents — white only
  teal:       "#e0e0e0",
  tealBright: "#ffffff",
  tealDim:    "rgba(255,255,255,.06)",
  tealBorder: "rgba(255,255,255,.14)",
  tealText:   "#e8e8e8",

  // Radius — round everything
  r1: "4px",
  r2: "8px",
  r3: "12px",
  r4: "16px",
};

export const MONO = "'JetBrains Mono','Cascadia Code','Fira Code','Consolas',monospace";
export const SANS = "'DM Sans','Outfit',-apple-system,'SF Pro Text',system-ui,sans-serif";

export const tbtn: React.CSSProperties = {
  background: "none", border: "none", color: C.t2, cursor: "pointer",
  padding: "3px 6px", display: "flex", alignItems: "center",
  justifyContent: "center", borderRadius: 6, lineHeight: 1,
  transition: "color .1s, background .1s",
};

export const PORT = 7547;
export const STORAGE_KEY = "stackbox-runboxes-v2";

export function loadRunboxes() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"); } catch { return []; }
}
export function saveRunboxes(rbs: unknown[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rbs)); } catch {}
}

export function reltime(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60_000)    return "just now";
  if (d < 3600_000)  return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86400_000) return `${Math.floor(d / 3600_000)}h  ago`;
  return `${Math.floor(d / 86400_000)}d ago`;
}

export const TOPIC_COLOR: Record<string, string> = {
  "task.done":     "#888",
  "task.started":  "#5a7ea8",
  "task.failed":   "#c05050",
  "error":         "#c05050",
  "agent.started": "#777",
  "agent.stopped": "#444",
  "file.changed":  "#a08030",
  "memory.added":  "#887898",
  "status":        "#444",
};

export function topicColor(topic: string): string {
  return TOPIC_COLOR[topic] ?? C.teal;
}