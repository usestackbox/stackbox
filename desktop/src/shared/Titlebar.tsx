import { getCurrentWindow } from "@tauri-apps/api/window";
import { C, SANS } from "./constants";

const win = getCurrentWindow();
const isMac = navigator.userAgent.toLowerCase().includes("mac");

interface BtnProps {
  label: string;
  hoverBg: string;
  onClick: () => void;
}

function WinBtn({ label, hoverBg, onClick }: BtnProps) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.background = hoverBg;
        el.style.color = "#000";
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.background = "transparent";
        el.style.color = C.t2;
      }}
      style={{
        width: 28, height: 28, borderRadius: 6,
        border: "none", background: "transparent",
        cursor: "pointer", display: "flex",
        alignItems: "center", justifyContent: "center",
        color: C.t2, fontSize: 14, fontFamily: SANS,
        flexShrink: 0, transition: "background .12s, color .12s",
      }}
    >
      {label}
    </button>
  );
}

function Controls() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
      <WinBtn label="−" hoverBg="#f59e0b" onClick={() => win.minimize()} />
      <WinBtn label="□" hoverBg="#22c55e" onClick={() => win.toggleMaximize()} />
      <WinBtn label="✕" hoverBg="#ef4444" onClick={() => win.close()} />
    </div>
  );
}

export function Titlebar() {
  return (
    <div
      data-tauri-drag-region
      style={{
        height: 36,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        paddingInline: 8,
        background: C.bg0,
        borderBottom: `1px solid ${C.border}`,
        userSelect: "none",
      }}
    >
      {/* Left slot — controls on Mac, empty on Windows */}
      {isMac ? <Controls /> : <div style={{ width: 8 }} />}

      {/* Center — app name */}
      <span
        data-tauri-drag-region
        style={{
          fontSize: 11,
          color: C.t2,
          fontFamily: SANS,
          letterSpacing: ".06em",
          pointerEvents: "none",
        }}
      >
        Stackbox
      </span>

      {/* Right slot — controls on Windows, empty on Mac */}
      {!isMac ? <Controls /> : <div style={{ width: 8 }} />}
    </div>
  );
}