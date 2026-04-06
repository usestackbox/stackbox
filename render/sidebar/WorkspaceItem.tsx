// sidebar/WorkspaceItem.tsx
import { useState, useRef, useEffect } from "react";
import { C, FS, MONO } from "../design";
import type { Runbox } from "../types";

interface Props {
  workspace:     Runbox;
  isActive:      boolean;
  lastUsed?:     number;
  onSelect:      () => void;
  onRename:      (name: string) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function formatRelativeTime(ts?: number): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  <  1) return "just now";
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

export function WorkspaceItem({
  workspace, isActive, lastUsed,
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

  // Strip leading ~/ before extracting the last segment, then re-apply ~/
  // This prevents "~/foo" → rawDir="foo" → dirName="~/foo" looking like a duplicate
  // when the workspace name is already "foo".
  const normalized = workspace.cwd.replace(/\\/g, "/").replace(/^~\//, "");
  const rawDir  = normalized.split("/").filter(Boolean).pop() ?? normalized;
  const dirName = `~/${normalized}`;
  // Hide the path row when it adds no information (name already equals last segment)
  const showPath = rawDir.toLowerCase() !== workspace.name.toLowerCase();

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
            fontSize: 14, fontFamily: MONO, fontWeight: 500,
            color: isActive ? C.t0 : C.t1,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            flex: 1, minWidth: 0,
          }}>
            {workspace.name}
          </span>
        )}
      </div>

      {/* Meta row: folder path + time */}
      {!renaming && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{
            fontSize: 12, fontFamily: MONO, color: C.t3,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            flex: 1, minWidth: 0,
          }}>
            {showPath ? dirName : normalized.includes("/") ? dirName : "~/"}
          </span>
          {lastUsed !== undefined && lastUsed > 0 && (
            <span style={{
              fontSize: 11, fontFamily: MONO, color: C.t3,
              flexShrink: 0, marginLeft: 8, opacity: 0.7,
            }}>
              {formatRelativeTime(lastUsed)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}