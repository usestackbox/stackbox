// src/shared/constants.ts
import type React from "react";

// ── Dark teal design system (#0b0e10 → #1b2328, white text only) ──────────────
export const C = {
  // Backgrounds — deep teal-blacks
  bg0: "#0b0e10",   // deepest — terminal, main canvas
  bg1: "#101518",   // base panels
  bg2: "#161c20",   // cards, secondary panels
  bg3: "#1b2328",   // hover states, inputs
  bg4: "#1f2a30",   // active states
  bg5: "#243035",   // elevated, dropdowns

  // Borders — barely-there to visible
  border:   "rgba(255,255,255,.06)",
  borderMd: "rgba(255,255,255,.10)",
  borderHi: "rgba(255,255,255,.18)",

  // Text hierarchy — white only
  t0: "rgba(255,255,255,.92)",
  t1: "rgba(255,255,255,.62)",
  t2: "rgba(255,255,255,.38)",
  t3: "rgba(255,255,255,.22)",

  // Status — all white toned
  green:   "rgba(255,255,255,.70)",
  greenBg: "rgba(255,255,255,.06)",
  red:     "rgba(255,255,255,.55)",
  redBg:   "rgba(255,255,255,.06)",
  amber:   "rgba(255,255,255,.55)",
  amberBg: "rgba(255,255,255,.06)",
  blue:    "rgba(255,255,255,.55)",
  blueDim: "rgba(255,255,255,.06)",

  // Accents — white only
  teal:       "rgba(255,255,255,.80)",
  tealBright: "#ffffff",
  tealDim:    "rgba(255,255,255,.06)",
  tealBorder: "rgba(255,255,255,.14)",
  tealText:   "rgba(255,255,255,.88)",

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
  if (d < 86400_000) return `${Math.floor(d / 3600_000)}h ago`;
  return `${Math.floor(d / 86400_000)}d ago`;
}

export const TOPIC_COLOR: Record<string, string> = {
  "task.done":     "rgba(255,255,255,.35)",
  "task.started":  "rgba(255,255,255,.55)",
  "task.failed":   "rgba(255,255,255,.45)",
  "error":         "rgba(255,255,255,.45)",
  "agent.started": "rgba(255,255,255,.40)",
  "agent.stopped": "rgba(255,255,255,.25)",
  "file.changed":  "rgba(255,255,255,.50)",
  "memory.added":  "rgba(255,255,255,.45)",
  "status":        "rgba(255,255,255,.25)",
};

export function topicColor(topic: string): string {
  return TOPIC_COLOR[topic] ?? C.teal;
}