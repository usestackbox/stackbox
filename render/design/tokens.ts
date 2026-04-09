// ── Backgrounds ───────────────────────────────────────────────────────────────
// Slate — mid-dark, airy, like Linear or Vercel dashboard
export const BG = {
  0: "#151821", // terminal (not black, soft)
  1: "#1E222B", // app base
  2: "#242938", // workspace
  3: "#2B3042", // primary panels
  4: "#353A50", // borders / dividers
  5: "#404663", // hover / active
};

// ── Borders ───────────────────────────────────────────────────────────────────
export const BORDER = {
  subtle: "rgba(150,155,210,.07)",
  base:   "rgba(150,155,210,.13)",
  mid:    "rgba(150,155,210,.22)",
  hi:     "rgba(160,165,230,.36)",
} as const;

// ── Text ──────────────────────────────────────────────────────────────────────
export const TEXT = {
  primary:   "rgba(238,240,255,.96)",
  secondary: "rgba(195,198,225,.78)",
  muted:     "rgba(150,155,185,.58)",
  faint:     "rgba(110,115,150,.38)",
  ghost:     "rgba(80,85,120,.18)",
} as const;

// ── Semantic colours ──────────────────────────────────────────────────────────
export const SEM = {
  green: "#3fffa2",
  greenDim: "#22e87a",
  greenBg: "rgba(63,255,162,.07)",
  greenBorder: "rgba(63,255,162,.18)",
  red: "#ff6b6b",
  redDim: "#f54242",
  redBg: "rgba(255,107,107,.07)",
  redBorder: "rgba(255,107,107,.18)",
  amber: "#ffd060",
  amberDim: "#f5a623",
  amberBg: "rgba(255,208,96,.07)",
  amberBorder: "rgba(255,208,96,.18)",
  blue: "#6ab0ff",
  blueDim: "#3d8ff5",
  blueBg: "rgba(106,176,255,.07)",
  blueBorder: "rgba(106,176,255,.18)",
  // ── Violet/purple accent — Stackbox identity colour ─────────────────────────────
  violet: "#9D8FFF",
  violetBright: "#BCB2FF",
  violetDim: "#7560F0",
  violetBg: "rgba(157,143,255,.09)",
  violetBorder: "rgba(157,143,255,.26)",
} as const;

// ── Shadows ───────────────────────────────────────────────────────────────────
export const SHADOW = {
  xs: "0 1px 4px rgba(0,0,0,.30)",
  sm: "0 2px 10px rgba(0,0,0,.40)",
  md: "0 8px 28px rgba(0,0,0,.50)",
  lg: "0 16px 52px rgba(0,0,0,.58)",
  xl: "0 28px 80px rgba(0,0,0,.66)",
  inner: "inset 0 1px 0 rgba(255,255,255,.08)",
  glow: "0 0 24px rgba(157,143,255,.22)",
} as const;

// ── Radius ────────────────────────────────────────────────────────────────────
export const RADIUS = {
  xs: "4px",
  sm: "8px",
  md: "10px",
  lg: "12px",
  xl: "16px",
  full: "9999px",
} as const;

// ── Flat token map (C) ────────────────────────────────────────────────────────
export const C = {
  bg0: BG[0],
  bg1: BG[1],
  bg2: BG[2],
  bg3: BG[3],
  bg4: BG[4],
  bg5: BG[5],

  border: BORDER.base,
  borderMd: BORDER.mid,
  borderHi: BORDER.hi,

  t0: TEXT.primary,
  t1: TEXT.secondary,
  t2: TEXT.muted,
  t3: TEXT.faint,
  t4: TEXT.ghost,

  green: SEM.green,
  greenDim: SEM.greenDim,
  greenBg: SEM.greenBg,
  greenBorder: SEM.greenBorder,

  red: SEM.red,
  redDim: SEM.redDim,
  redBg: SEM.redBg,
  redBorder: SEM.redBorder,

  amber: SEM.amber,
  amberDim: SEM.amberDim,
  amberBg: SEM.amberBg,
  amberBorder: SEM.amberBorder,

  blue: SEM.blue,
  blueDim: SEM.blueDim,
  blueBg: SEM.blueBg,
  blueBorder: SEM.blueBorder,

  // ── Violet accent ─────────────────────────────────────────────────────────
  violet: SEM.violet,
  violetBright: SEM.violetBright,
  violetDim: SEM.violetDim,
  violetBg: SEM.violetBg,
  violetBorder: SEM.violetBorder,

  // Legacy compat — teal remapped to violet
  teal: SEM.violetBright,
  tealBright: SEM.violet,
  tealDim: SEM.violetBg,
  tealBorder: SEM.violetBorder,
  tealText: SEM.violetBright,

  shadowXs: SHADOW.xs,
  shadowSm: SHADOW.sm,
  shadow: SHADOW.md,
  shadowLg: SHADOW.lg,
  shadowXl: SHADOW.xl,
  shadowGlow: SHADOW.glow,

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
  xxs: 11,
  xs: 12,
  sm: 13,
  md: 14,
  base: 15,
  lg: 16,
  xl: 18,
  xxl: 20,
  h3: 22,
  h2: 26,
  h1: 34,
} as const;

// ── Spacing (4-pt grid) ───────────────────────────────────────────────────────
export const SP = {
  1: 2,
  2: 4,
  3: 6,
  4: 8,
  5: 10,
  6: 12,
  7: 14,
  8: 16,
  10: 20,
  12: 24,
  16: 32,
  20: 40,
} as const;

// ── Transition presets ────────────────────────────────────────────────────────
export const T = {
  fast: "all .08s ease",
  base: "all .12s ease",
  slow: "all .20s ease",
  spring: "all .18s cubic-bezier(.4,0,.2,1)",
  bounce: "all .22s cubic-bezier(.16,1,.3,1)",
} as const;

// ── App constants ─────────────────────────────────────────────────────────────
export const PORT = 7547;
export const STORAGE_KEY = "stackbox-runboxes-v2";