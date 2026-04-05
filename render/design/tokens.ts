// design/tokens.ts
// Single source of truth for every visual value in Stackbox.
// Nothing gets hardcoded in components — import from { C, FS, SP, T, MONO, SANS }.

import type React from "react";

// ── Backgrounds ───────────────────────────────────────────────────────────────
const BG = {
  0: "#000000",  // terminals (pure black)
  1: "#1a1a1a",  // main app bg (between your two colors)
  2: "#222222",  // subtle step up
  3: "#2c2c2c",  // ← PRIMARY — panels, sidebars
  4: "#353535",  // midpoint step
  5: "#3f3f3f",  // ← SECONDARY — hover, selected, active
};

// ── Borders ───────────────────────────────────────────────────────────────────
const BORDER = {
  subtle: "rgba(255,255,255,.05)",
  base:   "rgba(255,255,255,.08)",
  mid:    "rgba(255,255,255,.12)",
  hi:     "rgba(255,255,255,.22)",
} as const;

// ── Text ──────────────────────────────────────────────────────────────────────
const TEXT = {
  primary:   "rgba(255,255,255,.93)",
  secondary: "rgba(255,255,255,.65)",
  muted:     "rgba(255,255,255,.40)",
  faint:     "rgba(255,255,255,.22)",
  ghost:     "rgba(255,255,255,.10)",
} as const;

// ── Semantic colours ──────────────────────────────────────────────────────────
const SEM = {
  green:       "#4ade80",
  greenDim:    "#22c55e",
  greenBg:     "rgba(74,222,128,.07)",
  greenBorder: "rgba(74,222,128,.18)",
  red:         "#f87171",
  redDim:      "#ef4444",
  redBg:       "rgba(248,113,113,.07)",
  redBorder:   "rgba(248,113,113,.18)",
  amber:       "#fbbf24",
  amberDim:    "#f59e0b",
  amberBg:     "rgba(251,191,36,.07)",
  amberBorder: "rgba(251,191,36,.18)",
  blue:        "#60a5fa",
  blueDim:     "#3b82f6",
  blueBg:      "rgba(96,165,250,.07)",
  blueBorder:  "rgba(96,165,250,.18)",
} as const;

// ── Shadows ───────────────────────────────────────────────────────────────────
const SHADOW = {
  xs:    "0 1px 4px rgba(0,0,0,.45)",
  sm:    "0 2px 10px rgba(0,0,0,.55)",
  md:    "0 8px 28px rgba(0,0,0,.65)",
  lg:    "0 16px 52px rgba(0,0,0,.75)",
  xl:    "0 28px 80px rgba(0,0,0,.88)",
  inner: "inset 0 1px 0 rgba(255,255,255,.04)",
} as const;

// ── Radius ────────────────────────────────────────────────────────────────────
const RADIUS = {
  xs:   "4px",
  sm:   "8px",
  md:   "10px",
  lg:   "12px",
  xl:   "16px",
  full: "9999px",
} as const;

// ── Flat token map (C) ────────────────────────────────────────────────────────
export const C = {
  bg0: BG[0], bg1: BG[1], bg2: BG[2], bg3: BG[3], bg4: BG[4], bg5: BG[5],

  border:   BORDER.base,
  borderMd: BORDER.mid,
  borderHi: BORDER.hi,

  t0: TEXT.primary,
  t1: TEXT.secondary,
  t2: TEXT.muted,
  t3: TEXT.faint,
  t4: TEXT.ghost,

  green:       SEM.green,
  greenDim:    SEM.greenDim,
  greenBg:     SEM.greenBg,
  greenBorder: SEM.greenBorder,

  red:         SEM.red,
  redDim:      SEM.redDim,
  redBg:       SEM.redBg,
  redBorder:   SEM.redBorder,

  amber:       SEM.amber,
  amberDim:    SEM.amberDim,
  amberBg:     SEM.amberBg,
  amberBorder: SEM.amberBorder,

  blue:        SEM.blue,
  blueDim:     SEM.blueDim,
  blueBg:      SEM.blueBg,
  blueBorder:  SEM.blueBorder,

  // Legacy compat — teal remapped to neutral white
  teal:        TEXT.primary,
  tealBright:  "#ffffff",
  tealDim:     "rgba(255,255,255,.06)",
  tealBorder:  BORDER.mid,
  tealText:    TEXT.primary,

  shadowXs: SHADOW.xs,
  shadowSm: SHADOW.sm,
  shadow:   SHADOW.md,
  shadowLg: SHADOW.lg,
  shadowXl: SHADOW.xl,

  r1: RADIUS.xs,
  r2: RADIUS.sm,
  r3: RADIUS.md,
  r4: RADIUS.lg,
  r5: RADIUS.xl,
} as const;

// ── Typography ────────────────────────────────────────────────────────────────
export const MONO = "'JetBrains Mono','Cascadia Code','Fira Code','Consolas',monospace";
export const SANS = "'DM Sans','Outfit',-apple-system,'SF Pro Text',system-ui,sans-serif";

/** Font size scale in px */
export const FS = {
  xxs:  9,
  xs:   10,
  sm:   11,
  md:   12,
  base: 13,
  lg:   14,
  xl:   16,
  xxl:  18,
  h3:   20,
  h2:   24,
  h1:   32,
} as const;

// ── Spacing (4-pt grid) ───────────────────────────────────────────────────────
export const SP = {
  1: 2, 2: 4, 3: 6, 4: 8, 5: 10, 6: 12,
  7: 14, 8: 16, 10: 20, 12: 24, 16: 32, 20: 40,
} as const;

// ── Transition presets ────────────────────────────────────────────────────────
export const T = {
  fast:   "all .08s ease",
  base:   "all .12s ease",
  slow:   "all .20s ease",
  spring: "all .18s cubic-bezier(.4,0,.2,1)",
  bounce: "all .22s cubic-bezier(.16,1,.3,1)",
} as const;

// ── App constants ─────────────────────────────────────────────────────────────
export const PORT        = 7547;
export const STORAGE_KEY = "stackbox-runboxes-v2";
