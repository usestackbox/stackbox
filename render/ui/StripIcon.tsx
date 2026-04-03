// ui/StripIcon.tsx
// Toolbar icon button with active/hover teal glow state.

import { useState } from "react";
import { C } from "../design";

interface Props {
  children: React.ReactNode;
  title:    string;
  active?:  boolean;
  onClick:  () => void;
}

export function StripIcon({ children, title, active, onClick }: Props) {
  const [hov, setHov] = useState(false);
  const lit = active || hov;
  return (
    <button
      title={title}
      onMouseDown={e => e.stopPropagation()}
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: 30, height: 30, flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        background:  "transparent",
        border:      "none",
        borderRadius: 8,
        cursor:      "pointer",
        transition:  "color .12s, transform .12s",
        color:       lit ? "#ffffff" : "rgba(255,255,255,.4)",
        transform:   lit ? "scale(1.18)" : "scale(1)",
      }}
    >
      {children}
    </button>
  );
}