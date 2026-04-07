// design/primitives.ts
// Reusable CSSProperties objects — keeps component style code lean.
// All values reference tokens from ./tokens so theming stays consistent.

import type React from "react";
import { C, FS, MONO } from "./tokens";

/** Icon / toolbar button — zero-chrome, inherits color. */
export const tbtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: C.t2,
  cursor: "pointer",
  padding: "3px 6px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: C.r2,
  lineHeight: 1,
  flexShrink: 0,
  transition: "color .1s, background .1s",
};

/** Monospace badge / count pill */
export const pill: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  fontSize: FS.xxs,
  fontFamily: MONO,
  fontWeight: 700,
  borderRadius: C.r1,
  padding: "1px 6px",
  lineHeight: 1.4,
  letterSpacing: ".04em",
  flexShrink: 0,
};

/** Standard 42px panel header row */
export const panelHeader: React.CSSProperties = {
  height: 42,
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  padding: "0 12px",
  gap: 8,
  borderBottom: `1px solid ${C.border}`,
  background: C.bg1,
};

/** Base input style */
export const inputBase: React.CSSProperties = {
  background: C.bg0,
  border: `1px solid ${C.border}`,
  borderRadius: C.r2,
  color: C.t0,
  fontSize: FS.md,
  padding: "8px 10px",
  outline: "none",
  fontFamily: MONO,
  width: "100%",
  boxSizing: "border-box",
  transition: "border-color .15s",
};
