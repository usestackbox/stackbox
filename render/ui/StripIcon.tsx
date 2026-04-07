// ui/StripIcon.tsx
// Toolbar icon button with active/hover state.

import { useState } from "react";

interface Props {
  children: React.ReactNode;
  title: string;
  active?: boolean;
  size?: number;
  onClick: () => void;
}

export function StripIcon({ children, title, active, size = 28, onClick }: Props) {
  const [hov, setHov] = useState(false);
  const lit = active || hov;
  return (
    <button
      title={title}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: 26,
        height: 26,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: active ? "#3A4149" : hov ? "rgba(255,255,255,.09)" : "transparent",
        border: active ? "1px solid rgba(255,255,255,.12)" : "1px solid transparent",
        borderRadius: 6,
        cursor: "pointer",
        transition: "color .12s, background .12s, border-color .12s",
        color: lit ? "#ffffff" : "rgba(255,255,255,.4)",
      }}
    >
      {children}
    </button>
  );
}
