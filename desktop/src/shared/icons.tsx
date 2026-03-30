// src/shared/icons.tsx
// All icon components. Colors sourced from C tokens — never hardcoded.
import { C } from "./constants";

// ── Git branch ────────────────────────────────────────────────────────────────
export const IcoGit = ({ on }: { on?: boolean }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
    stroke={on ? C.t0 : C.t2}
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <line x1="6" y1="3" x2="6" y2="15"/>
    <circle cx="18" cy="6" r="3"/>
    <circle cx="6" cy="18" r="3"/>
    <path d="M18 9a9 9 0 0 1-9 9"/>
    <circle cx="6" cy="3" r="1.3" fill={on ? C.t0 : C.t2} stroke="none"/>
  </svg>
);

// ── Brain / memory ────────────────────────────────────────────────────────────
export const IcoBrain = ({ on }: { on?: boolean }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
    stroke={on ? C.t0 : C.t2}
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44
      2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58
      2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/>
    <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44
      2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58
      2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"/>
  </svg>
);

// ── File changes (+/-) ────────────────────────────────────────────────────────
export const IcoFiles = ({ on }: { on?: boolean }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
    stroke={on ? C.t0 : C.t2}
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
    style={{ opacity: on ? 1 : 0.4, transition: "opacity .15s" }}>
    <line x1="12" y1="2"  x2="12" y2="10"/>
    <line x1="8"  y1="6"  x2="16" y2="6"/>
    <line x1="8"  y1="18" x2="16" y2="18"/>
  </svg>
);

// ── Globe / browser ───────────────────────────────────────────────────────────
export const IcoGlobe = ({ on }: { on?: boolean }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
    stroke={on ? C.t0 : C.t2}
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="2" y1="12" x2="22" y2="12"/>
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10
      15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
  </svg>
);

// ── Sidebar toggle ────────────────────────────────────────────────────────────
export const IcoSidebar = ({ on }: { on?: boolean }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
    stroke={C.t1}
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <path d="M9 3v18"/>
    <path d="M3 3h6v18H3z" fill={on ? C.t1 : "none"} stroke="none"/>
  </svg>
);

// ── Open in external editor ───────────────────────────────────────────────────
export const IcoOpenEditor = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke={C.t1}
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
    <polyline points="15 3 21 3 21 9"/>
    <line x1="10" y1="14" x2="21" y2="3"/>
  </svg>
);