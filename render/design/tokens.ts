export const BG = {
  0: "#0F1012",
  1: "#1c1f22e6",
  2: "#23262C",
  3: "#2D3138",
  4: "#373C45",
  5: "#424752",
};

export const BORDER = {
  subtle: "rgba(90,100,200,.07)",
  base:   "rgba(100,110,210,.13)",
  mid:    "rgba(120,130,230,.20)",
  hi:     "rgba(150,160,255,.30)",
} as const;

export const TEXT = {
  primary:   "rgba(218,222,255,.95)",
  secondary: "rgb(255, 255, 255)",
  muted:     "rgba(172, 175, 198, 0.6)",
  faint:     "rgba(72,78,135,.44)",
  ghost:     "rgba(45,50,100,.22)",
} as const;

export const SEM = {
  green: "#3CFFA0",
  greenDim: "#25E882",
  greenBg: "rgba(60,255,160,.07)",
  greenBorder: "rgba(60,255,160,.16)",
  red: "#FF5F6D",
  redDim: "#F04050",
  redBg: "rgba(255,95,109,.07)",
  redBorder: "rgba(255,95,109,.16)",
  amber: "#FFB347",
  amberDim: "#F5951A",
  amberBg: "rgba(255,179,71,.07)",
  amberBorder: "rgba(255,179,71,.16)",
  blue: "#3AF5ED",
  blueDim: "#22D5CC",
  blueBg: "rgba(58,245,237,.08)",
  blueBorder: "rgba(58,245,237,.18)",
  violet: "#9B72EF",
  violetBright: "#B896FF",
  violetDim: "#7550CC",
  violetBg: "rgba(155,114,239,.10)",
  violetBorder: "rgba(155,114,239,.24)",
} as const;

export const SHADOW = {
  xs: "0 1px 4px rgba(0,0,0,.55)",
  sm: "0 2px 10px rgba(0,0,0,.65)",
  md: "0 8px 28px rgba(0,0,0,.70)",
  lg: "0 16px 52px rgba(0,0,0,.76)",
  xl: "0 28px 80px rgba(0,0,0,.82)",
  inner: "inset 0 1px 0 rgba(255,255,255,.05)",
  glow: "0 0 24px rgba(155,114,239,.15)",
} as const;

export const RADIUS = {
  xs: "4px",
  sm: "8px",
  md: "10px",
  lg: "12px",
  xl: "16px",
  full: "9999px",
} as const;

export const C = {
  bg0: BG[0], bg1: BG[1], bg2: BG[2], bg3: BG[3], bg4: BG[4], bg5: BG[5],
  border: BORDER.base, borderSubtle: BORDER.subtle, borderMd: BORDER.mid, borderHi: BORDER.hi,
  t0: TEXT.primary, t1: TEXT.secondary, t2: TEXT.muted, t3: TEXT.faint, t4: TEXT.ghost,
  green: SEM.green, greenDim: SEM.greenDim, greenBg: SEM.greenBg, greenBorder: SEM.greenBorder,
  red: SEM.red, redDim: SEM.redDim, redBg: SEM.redBg, redBorder: SEM.redBorder,
  amber: SEM.amber, amberDim: SEM.amberDim, amberBg: SEM.amberBg, amberBorder: SEM.amberBorder,
  blue: SEM.blue, blueDim: SEM.blueDim, blueBg: SEM.blueBg, blueBorder: SEM.blueBorder,
  violet: SEM.violet, violetBright: SEM.violetBright, violetDim: SEM.violetDim,
  violetBg: SEM.violetBg, violetBorder: SEM.violetBorder,
  teal: SEM.blue, tealBright: SEM.blue, tealDim: SEM.blueBg,
  tealBorder: SEM.blueBorder, tealText: SEM.blue,
  shadowXs: SHADOW.xs, shadowSm: SHADOW.sm, shadow: SHADOW.md,
  shadowLg: SHADOW.lg, shadowXl: SHADOW.xl, shadowGlow: SHADOW.glow,
  r1: RADIUS.xs, r2: RADIUS.sm, r3: RADIUS.md, r4: RADIUS.lg, r5: RADIUS.xl,
} as const;

export const MONO = "'JetBrains Mono','Cascadia Code','Fira Code','Consolas',monospace";
export const SANS = "'DM Sans','Outfit',-apple-system,'SF Pro Text',system-ui,sans-serif";

export const FS = {
  xxs: 11, xs: 12, sm: 13, md: 14, base: 15, lg: 16, xl: 18, xxl: 20, h3: 22, h2: 26, h1: 34,
} as const;

export const SP = {
  1: 2, 2: 4, 3: 6, 4: 8, 5: 10, 6: 12, 7: 14, 8: 16, 10: 20, 12: 24, 16: 32, 20: 40,
} as const;

export const T = {
  fast: "all .08s ease",
  base: "all .12s ease",
  slow: "all .20s ease",
  spring: "all .18s cubic-bezier(.4,0,.2,1)",
  bounce: "all .22s cubic-bezier(.16,1,.3,1)",
} as const;

export const PORT = 7547;
export const STORAGE_KEY = "calus-runboxes-v2";
