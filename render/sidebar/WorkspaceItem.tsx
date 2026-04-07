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
  onEditDir?:    (cwd: string) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  /** Externally trigger editing from the context menu */
  externalEdit?: "name" | "dir" | null;
  onExternalEditDone?: () => void;
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
  onSelect, onRename, onEditDir, onContextMenu,
  externalEdit, onExternalEditDone,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [nameVal, setNameVal] = useState(workspace.name);
  const [dirVal,  setDirVal]  = useState(workspace.cwd);
  const [hovered, setHovered] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const dirRef  = useRef<HTMLInputElement>(null);

  useEffect(() => { setNameVal(workspace.name); }, [workspace.name]);
  useEffect(() => { setDirVal(workspace.cwd);   }, [workspace.cwd]);

  // Focus the right input once editing panel opens
  useEffect(() => {
    if (!editing) return;
    const target = externalEdit === "dir" ? dirRef : nameRef;
    setTimeout(() => target.current?.select(), 20);
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  // React to external trigger from context menu
  useEffect(() => {
    if (!externalEdit) return;
    setNameVal(workspace.name);
    setDirVal(workspace.cwd);
    setEditing(true);
  }, [externalEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (nameVal.trim() && nameVal.trim() !== workspace.name) onRename(nameVal.trim());
    if (dirVal.trim()  && dirVal.trim()  !== workspace.cwd)  onEditDir?.(dirVal.trim());
    setEditing(false);
    onExternalEditDone?.();
  };

  const cancel = () => {
    setNameVal(workspace.name);
    setDirVal(workspace.cwd);
    setEditing(false);
    onExternalEditDone?.();
  };

  const normalized = workspace.cwd.replace(/\\/g, "/").replace(/^~\//, "");
  const rawDir  = normalized.split("/").filter(Boolean).pop() ?? normalized;
  const dirName = `~/${normalized}`;
  const showPath = rawDir.toLowerCase() !== workspace.name.toLowerCase();

  const bg = isActive
    ? "rgba(255,255,255,.07)"
    : hovered
    ? "rgba(255,255,255,.04)"
    : "transparent";

  return (
    <div
      onClick={editing ? undefined : onSelect}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: "100%", boxSizing: "border-box",
        padding: editing ? "10px 14px 10px 16px" : "9px 14px 9px 16px",
        cursor: editing ? "default" : "pointer", userSelect: "none",
        background: bg,
        borderLeft: `2px solid ${isActive ? C.borderHi ?? "#3b82f6" : "transparent"}`,
        transition: "background .1s, border-color .1s",
        position: "relative",
      }}
    >
      {editing ? (
        <div onClick={e => e.stopPropagation()} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 9, fontFamily: MONO, color: C.t3, letterSpacing: ".06em", textTransform: "uppercase" as const }}>Name</span>
            <input
              ref={nameRef}
              value={nameVal}
              onChange={e => setNameVal(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter")  { e.preventDefault(); submit(); }
                if (e.key === "Escape") { e.preventDefault(); cancel(); }
              }}
              style={{
                background: C.bg0, border: `1px solid ${C.borderHi}`,
                borderRadius: C.r1, color: C.t0, fontSize: FS.base,
                padding: "4px 7px", outline: "none", fontFamily: MONO,
                width: "100%", boxSizing: "border-box" as const,
              }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 9, fontFamily: MONO, color: C.t3, letterSpacing: ".06em", textTransform: "uppercase" as const }}>Directory</span>
            <input
              ref={dirRef}
              value={dirVal}
              onChange={e => setDirVal(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter")  { e.preventDefault(); submit(); }
                if (e.key === "Escape") { e.preventDefault(); cancel(); }
              }}
              style={{
                background: C.bg0, border: `1px solid ${C.border}`,
                borderRadius: C.r1, color: C.t1, fontSize: FS.sm,
                padding: "4px 7px", outline: "none", fontFamily: MONO,
                width: "100%", boxSizing: "border-box" as const,
              }}
            />
          </div>

          <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
            <button onClick={submit} style={{ flex: 1, padding: "4px 0", border: "none", borderRadius: C.r1, background: C.borderHi ?? "#3b82f6", color: "#fff", fontSize: FS.xs, fontFamily: MONO, cursor: "pointer" }}>
              Save
            </button>
            <button onClick={cancel} style={{ flex: 1, padding: "4px 0", border: `1px solid ${C.border}`, borderRadius: C.r1, background: "transparent", color: C.t2, fontSize: FS.xs, fontFamily: MONO, cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontSize: 14, fontFamily: MONO, fontWeight: 500, color: isActive ? C.t0 : C.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}>
              {workspace.name}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, fontFamily: MONO, color: C.t3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}>
              {showPath ? dirName : normalized.includes("/") ? dirName : "~/"}
            </span>
            {lastUsed !== undefined && lastUsed > 0 && (
              <span style={{ fontSize: 11, fontFamily: MONO, color: C.t3, flexShrink: 0, marginLeft: 8, opacity: 0.7 }}>
                {formatRelativeTime(lastUsed)}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}