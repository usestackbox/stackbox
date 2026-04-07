// features/workspace/WinControls.tsx
import { getCurrentWindow } from "@tauri-apps/api/window";
import { C } from "../../design";

function WinBtn({
  children, title, hoverBg, hoverColor, onClick,
}: {
  children: React.ReactNode;
  title: string;
  hoverBg: string;
  hoverColor: string;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        width: 28, height: 28, borderRadius: 7,
        border: "none", background: "transparent",
        cursor: "pointer", display: "flex",
        alignItems: "center", justifyContent: "center",
        color: C.t1, transition: "all .12s", flexShrink: 0,
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.background = hoverBg;
        el.style.color = hoverColor;
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.background = "transparent";
        el.style.color = C.t1;
      }}
    >
      {children}
    </button>
  );
}

export function WinControls() {
  const win = getCurrentWindow();
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 1,
      marginLeft: 4, paddingLeft: 6,
      borderLeft: `1px solid rgba(255,255,255,.08)`,
    }}>
      <WinBtn title="Minimize"         hoverBg="rgba(255,255,255,.07)" hoverColor="#fff" onClick={() => win.minimize().catch(() => {})}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="4" y1="12" x2="20" y2="12"/>
        </svg>
      </WinBtn>
      <WinBtn title="Maximize/Restore" hoverBg="rgba(255,255,255,.07)" hoverColor="#fff" onClick={() => win.toggleMaximize().catch(() => {})}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="4" width="16" height="16" rx="2"/>
        </svg>
      </WinBtn>
      <WinBtn title="Close"            hoverBg="rgba(239,68,68,.2)"   hoverColor="#f87171" onClick={() => win.close().catch(() => {})}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="4" y1="4" x2="20" y2="20"/>
          <line x1="20" y1="4" x2="4" y2="20"/>
        </svg>
      </WinBtn>
    </div>
  );
} 