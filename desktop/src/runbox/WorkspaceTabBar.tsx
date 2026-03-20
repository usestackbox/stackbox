// src/runbox/WorkspaceTabBar.tsx
import { C, MONO, SANS, tbtn } from "../shared/constants";

interface WorkspaceTabBarProps {
  leafIds:      string[];
  activePane:   string;
  paneCwds:     Record<string, string>;
  runboxCwd:    string;
  branch:       string;
  toolbarSlot?: React.ReactNode;
  onSelect:     (id: string) => void;
  onNewTerm:    () => void;
  onClose:      (id: string) => void;
}

export function WorkspaceTabBar({
  leafIds, activePane, paneCwds, runboxCwd,
  branch, toolbarSlot,
  onSelect, onNewTerm, onClose,
}: WorkspaceTabBarProps) {
  const totalTabs = leafIds.length;

  return (
    <div style={{
      display: "flex", alignItems: "center", height: 42, flexShrink: 0,
      background: C.bg1, borderBottom: `1px solid ${C.border}`,
      padding: "0 6px", gap: 3,
    }}>

      {/* Terminal tabs */}
      <div style={{ display: "flex", alignItems: "center", flex: 1, gap: 3, overflowX: "auto", minWidth: 0 }}>
        {leafIds.map(id => {
          const isActive = id === activePane;
          const cwd      = paneCwds[id] || runboxCwd;
          const label    = cwd.split(/[/\\]/).filter(Boolean).pop() || cwd;
          return (
            <div key={id} onClick={() => onSelect(id)} title={cwd}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "5px 10px 5px 12px",
                height: 30, borderRadius: 8,
                cursor: "pointer", flexShrink: 0,
                background: isActive ? C.bg3 : "transparent",
                border: `1px solid ${isActive ? C.borderMd : "transparent"}`,
                transition: "all .1s",
              }}
              onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = C.bg2; }}
              onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>

              {/* Terminal icon */}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
                stroke={isActive ? C.t1 : C.t3} strokeWidth="2.2"
                strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
              </svg>

              <span style={{
                fontSize: 12, fontFamily: MONO,
                color: isActive ? C.t0 : C.t2,
                maxWidth: 120, overflow: "hidden",
                textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{label}</span>

              {leafIds.length > 1 && (
                <button onClick={e => { e.stopPropagation(); onClose(id); }}
                  style={{ ...tbtn, fontSize: 13, padding: "0 2px", opacity: 0, flexShrink: 0, borderRadius: 4 }}
                  onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.opacity = "1"; el.style.color = C.red; }}
                  onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.opacity = "0"; el.style.color = C.t2; }}>×</button>
              )}
            </div>
          );
        })}

        {/* New terminal button */}
        <button onClick={onNewTerm} title="New terminal"
          style={{
            ...tbtn, width: 30, height: 30, borderRadius: 8,
            fontSize: 18, fontWeight: 300,
            border: `1px solid transparent`,
            flexShrink: 0,
          }}
          onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.color = C.t0; el.style.background = C.bg3; el.style.borderColor = C.border; }}
          onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.color = C.t2; el.style.background = "transparent"; el.style.borderColor = "transparent"; }}>
          +
        </button>
      </div>

      {/* Right side: toolbar slot + branch */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        {toolbarSlot}

        {branch && (
          <div style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "4px 10px", borderRadius: 8,
            background: C.bg2, border: `1px solid ${C.border}`,
          }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
              <path d="M18 9a9 9 0 0 1-9 9"/>
            </svg>
            <span style={{ fontSize: 10, fontFamily: MONO, color: C.t2, maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {branch}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}