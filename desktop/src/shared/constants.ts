// src/shared/constants.ts
import type React from "react";

// ═══════════════════════════════════════════════════════════════════════════════
// DESIGN TOKENS
//
// Single source of truth for every visual value in Stackbox.
// Nothing gets hardcoded in components — colors, spacing, type, shadows and
// radius all live here. Import from { C, FS, SP, T, MONO, SANS }.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Background scale ──────────────────────────────────────────────────────────
// Pure black → dark grey, 6-stop elevation system.
const BG = {
  0: "#080808",   // canvas floor  — terminal, main app body
  1: "#0d0d0d",   // base surface  — panels, sidebar
  2: "#121212",   // raised        — cards, modals, popovers
  3: "#181818",   // interactive   — hover states, inputs
  4: "#1e1e1e",   // pressed       — selected / active
  5: "#252525",   // peak          — dropdowns, tooltips
} as const;

// ── Border opacity scale ──────────────────────────────────────────────────────
const BORDER = {
  subtle: "rgba(255,255,255,.05)",   // barely-there dividers
  base:   "rgba(255,255,255,.08)",   // default component borders
  mid:    "rgba(255,255,255,.12)",   // hover-state borders
  hi:     "rgba(255,255,255,.22)",   // focused / selected borders
} as const;

// ── Text opacity scale ────────────────────────────────────────────────────────
const TEXT = {
  primary:   "rgba(255,255,255,.93)",  // headings, active labels
  secondary: "rgba(255,255,255,.65)",  // body text, descriptions
  muted:     "rgba(255,255,255,.40)",  // placeholders, hints
  faint:     "rgba(255,255,255,.22)",  // disabled, decorative
  ghost:     "rgba(255,255,255,.10)",  // barely visible
} as const;

// ── Semantic colors ───────────────────────────────────────────────────────────
// REAL colors — not greys.
// Used for git stats (+/- lines), status indicators, toast feedback.
const SEM = {
  // Green — git additions, success, "done"
  green:       "#4ade80",
  greenDim:    "#22c55e",
  greenBg:     "rgba(74,222,128,.07)",
  greenBorder: "rgba(74,222,128,.18)",

  // Red — git deletions, errors, danger
  red:         "#f87171",
  redDim:      "#ef4444",
  redBg:       "rgba(248,113,113,.07)",
  redBorder:   "rgba(248,113,113,.18)",

  // Amber — warnings, in-progress states
  amber:       "#fbbf24",
  amberDim:    "#f59e0b",
  amberBg:     "rgba(251,191,36,.07)",
  amberBorder: "rgba(251,191,36,.18)",

  // Blue — info, links
  blue:        "#60a5fa",
  blueDim:     "#3b82f6",
  blueBg:      "rgba(96,165,250,.07)",
  blueBorder:  "rgba(96,165,250,.18)",
} as const;

// ── Shadow scale ──────────────────────────────────────────────────────────────
const SHADOW = {
  xs:    "0 1px 4px rgba(0,0,0,.45)",
  sm:    "0 2px 10px rgba(0,0,0,.55)",
  md:    "0 8px 28px rgba(0,0,0,.65)",
  lg:    "0 16px 52px rgba(0,0,0,.75)",
  xl:    "0 28px 80px rgba(0,0,0,.88)",
  inner: "inset 0 1px 0 rgba(255,255,255,.04)",
} as const;

// ── Border radius scale ───────────────────────────────────────────────────────
const RADIUS = {
  xs:   "4px",
  sm:   "8px",
  md:   "10px",
  lg:   "12px",
  xl:   "16px",
  full: "9999px",
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTED TOKEN MAP  ( C )
//
// Flat structure — every consumer gets direct dot-access.
// No drilling into nested objects at the call site.
// ═══════════════════════════════════════════════════════════════════════════════
export const C = {
  // Backgrounds
  bg0: BG[0],
  bg1: BG[1],
  bg2: BG[2],
  bg3: BG[3],
  bg4: BG[4],
  bg5: BG[5],

  // Borders
  border:   BORDER.base,
  borderMd: BORDER.mid,
  borderHi: BORDER.hi,

  // Text
  t0: TEXT.primary,
  t1: TEXT.secondary,
  t2: TEXT.muted,
  t3: TEXT.faint,
  t4: TEXT.ghost,

  // Git additions / success
  green:       SEM.green,
  greenDim:    SEM.greenDim,
  greenBg:     SEM.greenBg,
  greenBorder: SEM.greenBorder,

  // Git deletions / danger
  red:         SEM.red,
  redDim:      SEM.redDim,
  redBg:       SEM.redBg,
  redBorder:   SEM.redBorder,

  // Warnings
  amber:       SEM.amber,
  amberDim:    SEM.amberDim,
  amberBg:     SEM.amberBg,
  amberBorder: SEM.amberBorder,

  // Info
  blue:        SEM.blue,
  blueDim:     SEM.blueDim,
  blueBg:      SEM.blueBg,
  blueBorder:  SEM.blueBorder,

  // Legacy compat — teal slots remapped to neutral white so
  // existing components referencing C.teal* don't break.
  teal:        TEXT.primary,
  tealBright:  "#ffffff",
  tealDim:     "rgba(255,255,255,.06)",
  tealBorder:  BORDER.mid,
  tealText:    TEXT.primary,

  // Shadows
  shadowXs: SHADOW.xs,
  shadowSm: SHADOW.sm,
  shadow:   SHADOW.md,
  shadowLg: SHADOW.lg,
  shadowXl: SHADOW.xl,

  // Radius
  r1: RADIUS.xs,
  r2: RADIUS.sm,
  r3: RADIUS.md,
  r4: RADIUS.lg,
  r5: RADIUS.xl,
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// TYPOGRAPHY
// ═══════════════════════════════════════════════════════════════════════════════

export const MONO = "'JetBrains Mono','Cascadia Code','Fira Code','Consolas',monospace";
export const SANS = "'DM Sans','Outfit',-apple-system,'SF Pro Text',system-ui,sans-serif";

/** Font size scale in px. Prefer FS.sm over magic numbers. */
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

// ═══════════════════════════════════════════════════════════════════════════════
// SPACING  ( 4-pt grid )
// Use SP[4] instead of writing 16 inline.
// ═══════════════════════════════════════════════════════════════════════════════
export const SP = {
  1:  2,
  2:  4,
  3:  6,
  4:  8,
  5:  10,
  6:  12,
  7:  14,
  8:  16,
  10: 20,
  12: 24,
  16: 32,
  20: 40,
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSITION PRESETS
// ═══════════════════════════════════════════════════════════════════════════════
export const T = {
  fast:   "all .08s ease",
  base:   "all .12s ease",
  slow:   "all .20s ease",
  spring: "all .18s cubic-bezier(.4,0,.2,1)",
  bounce: "all .22s cubic-bezier(.16,1,.3,1)",
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED STYLE PRIMITIVES
// Reusable CSSProperties objects — keeps component code lean.
// ═══════════════════════════════════════════════════════════════════════════════

/** Icon / toolbar button — zero-chrome, inherits color. */
export const tbtn: React.CSSProperties = {
  background:     "none",
  border:         "none",
  color:          C.t2,
  cursor:         "pointer",
  padding:        "3px 6px",
  display:        "flex",
  alignItems:     "center",
  justifyContent: "center",
  borderRadius:   C.r2,
  lineHeight:     1,
  flexShrink:     0,
  transition:     "color .1s, background .1s",
};

/** Monospace badge / count pill — background + border provided by caller. */
export const pill: React.CSSProperties = {
  display:       "inline-flex",
  alignItems:    "center",
  fontSize:      FS.xxs,
  fontFamily:    MONO,
  fontWeight:    700,
  borderRadius:  C.r1,
  padding:       "1px 6px",
  lineHeight:    1.4,
  letterSpacing: ".04em",
  flexShrink:    0,
};

/** Standard 42px panel header row. */
export const panelHeader: React.CSSProperties = {
  height:       42,
  flexShrink:   0,
  display:      "flex",
  alignItems:   "center",
  padding:      "0 12px",
  gap:          8,
  borderBottom: `1px solid ${C.border}`,
  background:   C.bg1,
};

/** Base input style — pair with focus handler that swaps border to borderHi. */
export const inputBase: React.CSSProperties = {
  background:   C.bg0,
  border:       `1px solid ${C.border}`,
  borderRadius: C.r2,
  color:        C.t0,
  fontSize:     FS.md,
  padding:      "8px 10px",
  outline:      "none",
  fontFamily:   MONO,
  width:        "100%",
  boxSizing:    "border-box",
  transition:   "border-color .15s",
};

// ═══════════════════════════════════════════════════════════════════════════════
// APP CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════
export const PORT        = 7547;
export const STORAGE_KEY = "stackbox-runboxes-v2";

// ── Storage helpers ───────────────────────────────────────────────────────────
export function loadRunboxes() {
  try   { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"); }
  catch { return []; }
}

export function saveRunboxes(rbs: unknown[]) {
  try   { localStorage.setItem(STORAGE_KEY, JSON.stringify(rbs)); }
  catch { /**/ }
}

// ── Time formatting ───────────────────────────────────────────────────────────
export function reltime(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60_000)     return "just now";
  if (d < 3_600_000)  return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}