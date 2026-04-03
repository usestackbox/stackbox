// sidebar/WorkspaceList.tsx
import { C, FS, MONO, SANS } from "../design";
import { WorkspaceItem } from "./WorkspaceItem";
import type { Runbox } from "../types";
import type { GitStats } from "./useWorkspaceGitStats";

interface Props {
  workspaces:    Runbox[];
  activeId:      string | null;
  gitStats:      Record<string, GitStats>;
  icons:         Record<string, string>;
  wsName:        string;
  wsEditing:     boolean;
  wsVal:         string;
  wsInputRef:    React.RefObject<HTMLInputElement>;
  onWsClick:     () => void;
  onWsChange:    (v: string) => void;
  onWsKeyDown:   (e: React.KeyboardEvent) => void;
  onWsBlur:      () => void;
  onSelect:      (id: string) => void;
  onRename:      (id: string, name: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  onNew:         () => void;
}

export function WorkspaceList({
  workspaces, activeId, gitStats, icons,
  wsName, wsEditing, wsVal, wsInputRef,
  onWsClick, onWsChange, onWsKeyDown, onWsBlur,
  onSelect, onRename, onContextMenu, onNew,
}: Props) {
  return (
    <div style={{
      flex: 1, minHeight: 0, display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>

      {/* New Workspace button — full width flush bar */}
      <div style={{
        height: 42, flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 16px",
        borderBottom: `1px solid ${C.border}`,
        background: C.bg1,
      }}>
        <span style={{
          fontSize: FS.xs, fontFamily: SANS, fontWeight: 500,
          color: C.t3, letterSpacing: ".1em", textTransform: "uppercase",
        }}>
          Workspaces
        </span>
        <span
          onClick={onNew}
          style={{
            fontSize: FS.sm, fontFamily: SANS, color: C.t3,
            cursor: "pointer", letterSpacing: ".02em",
            transition: "color .12s",
          }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.t1}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.t3}
        >
          + new
        </span>
      </div>

      {/* Workspace rows */}
      <div style={{ flex: 1, overflowY: "auto", padding: "2px 0 10px" }}>
        {workspaces.map(ws => (
          <WorkspaceItem
            key={ws.id}
            workspace={ws}
            isActive={activeId === ws.id}
            gitStats={gitStats[ws.id]}
            customIcon={icons[ws.id]}
            onSelect={() => onSelect(ws.id)}
            onRename={name => onRename(ws.id, name)}
            onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onContextMenu(e, ws.id); }}
          />
        ))}

        {workspaces.length === 0 && (
          <div style={{ padding: "32px 16px", textAlign: "center" }}>
            <div style={{ fontSize: FS.sm, color: C.t3, fontFamily: MONO, lineHeight: 1.8, opacity: 0.6 }}>
              no workspaces yet
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: "6px 16px",
        borderTop: `1px solid ${C.border}`,
        fontSize: FS.xs, color: C.t3, fontFamily: SANS,
        background: C.bg1, flexShrink: 0,
        letterSpacing: ".02em", textAlign: "center",
      }}>
        double-click to rename · right-click for options
      </div>
    </div>
  );
}