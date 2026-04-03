// ui/PanelHeader.tsx
// Standard 48px panel header with title, optional icon, and close button.

import { C, SANS, tbtn } from "../design";

interface Props {
  title:   string;
  icon?:   React.ReactNode;
  onClose: () => void;
}

export function PanelHeader({ title, icon, onClose }: Props) {
  return (
    <div style={{
      height: 48, padding: "0 12px 0 14px", flexShrink: 0,
      borderBottom: `1px solid ${C.border}`,
      display: "flex", alignItems: "center", gap: 8,
      background: C.bg1,
    }}>
      {icon && <span style={{ flexShrink: 0, opacity: .75 }}>{icon}</span>}
      <span style={{ fontSize: 13, fontWeight: 600, color: C.t0, flex: 1, fontFamily: SANS }}>
        {title}
      </span>
      <button
        onMouseDown={e => e.stopPropagation()}
        onClick={onClose}
        style={{ ...tbtn, width: 28, height: 28, borderRadius: 8, fontSize: 14, color: C.t2 }}
        onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = C.redBg; el.style.color = C.red; }}
        onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.color = C.t2; }}
      >
        ✕
      </button>
    </div>
  );
}
