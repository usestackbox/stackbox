// sidebar/WorkspaceItem.tsx
import { useState, useRef, useEffect } from "react";
import { C, FS, MONO } from "../design";
import type { Runbox } from "../types";
import type { GitStats } from "./useWorkspaceGitStats";

interface Props {
  workspace:     Runbox;
  isActive:      boolean;
  gitStats?:     GitStats;
  customIcon?:   string;
  onSelect:      () => void;
  onRename:      (name: string) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

export function WorkspaceItem({
  workspace, isActive, gitStats,
  onSelect, onRename, onContextMenu,
}: Props) {
  const [renaming,  setRenaming]  = useState(false);
  const [renameVal, setRenameVal] = useState(workspace.name);
  const [hovered,   setHovered]   = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setRenameVal(workspace.name); }, [workspace.name]);
  useEffect(() => {
    if (renaming) setTimeout(() => inputRef.current?.select(), 20);
  }, [renaming]);

  const submit = () => {
    if (renameVal.trim() && renameVal.trim() !== workspace.name) onRename(renameVal.trim());
    setRenaming(false);
  };

  const hasGit  = !!gitStats && (gitStats.insertions + gitStats.deletions) > 0;
  const dirName = workspace.cwd.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? workspace.cwd;

  const bg = isActive
    ? "rgba(255,255,255,.07)"
    : hovered
    ? "rgba(255,255,255,.04)"
    : "transparent";

  return (
    <div
      onClick={onSelect}
      onDoubleClick={() => { setRenaming(true); setRenameVal(workspace.name); }}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: "100%", boxSizing: "border-box",
        padding: "9px 14px 9px 16px",
        cursor: "pointer", userSelect: "none",
        background: bg,
        borderLeft: `2px solid ${isActive ? C.borderHi ?? "#3b82f6" : "transparent"}`,
        transition: "background .1s, border-color .1s",
        position: "relative",
      }}
    >
      {/* Title row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        {renaming ? (
          <input
            ref={inputRef}
            value={renameVal}
            onChange={e => setRenameVal(e.target.value)}
            onBlur={submit}
            onKeyDown={e => {
              if (e.key === "Enter")  { e.preventDefault(); submit(); }
              if (e.key === "Escape") { setRenaming(false); setRenameVal(workspace.name); }
            }}
            onClick={e => e.stopPropagation()}
            style={{
              flex: 1, background: C.bg0, border: `1px solid ${C.borderHi}`,
              borderRadius: C.r1, color: C.t0, fontSize: FS.base,
              padding: "2px 6px", outline: "none", fontFamily: MONO,
            }}
          />
        ) : (
          <span style={{
            fontSize: FS.md, fontFamily: MONO, fontWeight: 500,
            color: isActive ? C.t0 : C.t1,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            flex: 1, minWidth: 0,
          }}>
            {workspace.name}
          </span>
        )}

        {!renaming && hasGit && (
          <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0, marginLeft: 6 }}>
            {gitStats!.insertions > 0 && (
              <span style={{ fontSize: FS.xs, fontFamily: MONO, color: C.green }}>
                +{gitStats!.insertions}
              </span>
            )}
            {gitStats!.deletions > 0 && (
              <span style={{ fontSize: FS.xs, fontFamily: MONO, color: C.red }}>
                -{gitStats!.deletions}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Meta row */}
      {!renaming && (
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={C.t3}
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <line x1="6" y1="3" x2="6" y2="15"/>
            <circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
            <path d="M18 9a9 9 0 0 1-9 9"/>
          </svg>
          <span style={{
            fontSize: FS.xs, fontFamily: MONO, color: C.t3,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            flex: 1, minWidth: 0,
          }}>
            {dirName}
          </span>
        </div>
      )}
    </div>
  );
}