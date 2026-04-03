// ui/TabCloseBtn.tsx
// Small ✕ button used on terminal and file tabs.

import { useState } from "react";

interface Props { onClose: () => void; }

export function TabCloseBtn({ onClose }: Props) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onMouseDown={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); onClose(); }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      title="Close"
      style={{
        width: 16, height: 16, borderRadius: 4, border: "none",
        background: hov ? "rgba(239,68,68,.25)" : "transparent",
        cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        color:      hov ? "#f87171" : "rgba(255,255,255,.35)",
        flexShrink: 0, padding: 0,
        transition: "background .1s, color .1s",
      }}
    >
      <svg width="8" height="8" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
        <line x1="4" y1="4" x2="20" y2="20"/>
        <line x1="20" y1="4" x2="4" y2="20"/>
      </svg>
    </button>
  );
}
