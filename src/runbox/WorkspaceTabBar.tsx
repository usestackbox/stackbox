import { C, MONO, SANS, tbtn } from "../shared/constants";
import type { DiffTab } from "../shared/types";

interface WorkspaceTabBarProps {
  leafIds:      string[];
  activePane:   string;
  paneCwds:     Record<string, string>;
  runboxCwd:    string;
  diffTabs:     DiffTab[];
  branch:       string;
  toolbarSlot?: React.ReactNode;
  onSelect:     (id: string) => void;
  onNewTerm:    () => void;
  onClose:      (id: string) => void;
  onCloseDiff:  (id: string) => void;
}

export function WorkspaceTabBar({
  leafIds, activePane, paneCwds, runboxCwd,
  diffTabs, branch, toolbarSlot,
  onSelect, onNewTerm, onClose, onCloseDiff,
}: WorkspaceTabBarProps) {
  const totalTabs = leafIds.length + diffTabs.length;
  // Shrink tabs as count grows so they always fit without needing scroll
  const tabMinW = totalTabs > 12 ? 40 : totalTabs > 8 ? 56 : totalTabs > 5 ? 72 : 90;
  const tabMaxW = totalTabs > 8 ? 90 : 160;
  const showLabel = totalTabs <= 10;

  return (
    <div style={{ display: "flex", alignItems: "stretch", height: 35, flexShrink: 0, background: C.bg1, borderBottom: `1px solid ${C.border}`, overflow: "hidden" }}>

      {/* Scrollable tab strip */}
      <div style={{ display: "flex", alignItems: "stretch", flex: 1, overflowX: "auto", overflowY: "hidden", minWidth: 0 }}>

        {leafIds.map(id => {
          const isActive = id === activePane;
          const cwd      = paneCwds[id] || runboxCwd;
          const label    = cwd.split(/[/\\]/).filter(Boolean).pop() || cwd;
          return (
            <div key={id} onClick={() => onSelect(id)}
              title={cwd}
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 8px 0 10px", minWidth: tabMinW, maxWidth: tabMaxW, cursor: "pointer", flexShrink: 0, background: isActive ? C.bg0 : "transparent", borderRight: `1px solid ${C.border}`, borderBottom: isActive ? `2px solid ${C.teal}` : "2px solid transparent", transition: "background .1s" }}
              onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = C.bg2; }}
              onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={isActive ? C.tealText : C.t2} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
              </svg>
              {showLabel && (
                <span style={{ fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: isActive ? C.t0 : C.t2, fontFamily: MONO }}>{label}</span>
              )}
              {leafIds.length > 1 && (
                <button onClick={e => { e.stopPropagation(); onClose(id); }}
                  style={{ ...tbtn, fontSize: 11, opacity: isActive ? 0.5 : 0, padding: "0 1px", flexShrink: 0 }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; (e.currentTarget as HTMLElement).style.color = C.redBright; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = isActive ? "0.5" : "0"; (e.currentTarget as HTMLElement).style.color = C.t2; }}>×</button>
              )}
            </div>
          );
        })}

        {diffTabs.map(dt => {
          const isActive = dt.id === activePane;
          const fileName = dt.path.split(/[/\\]/).pop() ?? dt.path;
          const cc       = dt.changeType === "created" ? C.green : dt.changeType === "deleted" ? C.redBright : C.amber;
          return (
            <div key={dt.id} onClick={() => onSelect(dt.id)}
              title={dt.path}
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "0 8px 0 10px", minWidth: tabMinW, maxWidth: tabMaxW, cursor: "pointer", flexShrink: 0, background: isActive ? C.bg0 : "transparent", borderRight: `1px solid ${C.border}`, borderBottom: isActive ? `2px solid ${cc}` : "2px solid transparent", transition: "background .1s" }}
              onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = C.bg2; }}
              onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
              <span style={{ width: 6, height: 6, borderRadius: 2, background: cc, flexShrink: 0 }} />
              {showLabel && (
                <span style={{ fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: isActive ? C.t0 : C.t2, fontFamily: MONO }}>{fileName}</span>
              )}
              <button onClick={e => { e.stopPropagation(); onCloseDiff(dt.id); }}
                style={{ ...tbtn, fontSize: 11, opacity: isActive ? 0.6 : 0, padding: "0 1px", flexShrink: 0 }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; (e.currentTarget as HTMLElement).style.color = C.redBright; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = isActive ? "0.6" : "0"; (e.currentTarget as HTMLElement).style.color = C.t2; }}>×</button>
            </div>
          );
        })}
      </div>

      {/* Pinned right — never pushed off screen */}
      <div style={{ display: "flex", alignItems: "stretch", flexShrink: 0, borderLeft: `1px solid ${C.border}` }}>
        <button onClick={onNewTerm} title="New terminal"
          style={{ ...tbtn, padding: "0 12px", fontSize: 17, fontWeight: 300, borderRadius: 0, flexShrink: 0, borderRight: toolbarSlot || branch ? `1px solid ${C.border}` : "none" }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.tealText}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.t2}>+</button>

        {toolbarSlot && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 8px", borderRight: branch ? `1px solid ${C.border}` : "none", flexShrink: 0 }}>
            {toolbarSlot}
          </div>
        )}

        {branch && (
          <div style={{ display: "flex", alignItems: "center", padding: "0 12px", flexShrink: 0 }}>
            <span style={{ fontSize: 10, fontFamily: MONO, color: C.t2, maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {branch}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}