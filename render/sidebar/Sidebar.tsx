// sidebar/Sidebar.tsx
import { useState, useRef, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { C } from "../design";
import { FilePanel } from "../features/files";
import { WorkspaceList }        from "./WorkspaceList";
import { WorkspaceContextMenu } from "./WorkspaceContextMenu";
import { CreateWorkspaceModal } from "./CreateWorkspaceModal";
import type { Runbox } from "../types";

const IS_MAC         = navigator.userAgent.toLowerCase().includes("mac");
const BASE_TOOLBAR_H = 42;
const TRAFFIC_H      = 28;
const WORKSPACE_W    = 260;

export interface SidebarProps {
  runboxes:          Runbox[];
  activeId:          string | null;
  cwdMap:            Record<string, string>;
  collapsed:         boolean;
  onToggle:          () => void;
  onSelect:          (id: string) => void;
  onCreate:          (name: string, cwd: string) => void;
  onRename:          (id: string, name: string) => void;
  onDelete:          (id: string) => void;
  fileTreeOpen?:     boolean;
  onFileTreeToggle?: () => void;
  onOpenFile?:       (path: string) => void;
  onFileTreeWidth?:  (w: number) => void;
  worktreeMap?:      Record<string, string>;
}

function useMacFullscreen() {
  const [fs, setFs] = useState(false);
  useEffect(() => {
    if (!IS_MAC) return;
    getCurrentWindow().isFullscreen().then(setFs).catch(() => {});
    const unsub = getCurrentWindow().onResized(async () => {
      try { setFs(await getCurrentWindow().isFullscreen()); } catch {}
    });
    return () => { unsub.then(f => f()).catch(() => {}); };
  }, []);
  return fs;
}

export function Sidebar({
  runboxes, activeId, cwdMap, collapsed,
  onSelect, onCreate, onRename, onDelete,
  fileTreeOpen, onFileTreeToggle, onOpenFile, onFileTreeWidth,
}: SidebarProps) {
  const isFullscreen = useMacFullscreen();
  const TOOLBAR_H    = IS_MAC && !isFullscreen ? BASE_TOOLBAR_H + TRAFFIC_H : BASE_TOOLBAR_H;
  const panelW       = WORKSPACE_W;

  useEffect(() => { onFileTreeWidth?.(WORKSPACE_W); }, [fileTreeOpen]); // eslint-disable-line

  // ── Local state ───────────────────────────────────────────────────────────
  const [showModal,   setShowModal]   = useState(false);
  const [lastUsedMap, setLastUsedMap] = useState<Record<string, number>>({});
  const [ctxMenu,     setCtxMenu]     = useState<{ x: number; y: number; id: string } | null>(null);
  const [wsName,      setWsName]      = useState("WORKSPACE");
  const [wsEditing,   setWsEditing]   = useState(false);
  const [wsVal,       setWsVal]       = useState("WORKSPACE");
  const wsInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (wsEditing) setTimeout(() => wsInputRef.current?.select(), 20); }, [wsEditing]);

  const submitWsRename = () => {
    if (wsVal.trim()) setWsName(wsVal.trim().toUpperCase()); else setWsVal(wsName);
    setWsEditing(false);
  };

  // Record timestamp whenever a workspace is activated
  const handleSelect = (id: string) => {
    setLastUsedMap(prev => ({ ...prev, [id]: Date.now() }));
    onSelect(id);
  };

  return (
    <>
      {showModal && (
        <CreateWorkspaceModal
          onSubmit={(n, c) => { onCreate(n, c); setShowModal(false); }}
          onClose={() => setShowModal(false)}
        />
      )}

      {ctxMenu && (
        <WorkspaceContextMenu
          x={ctxMenu.x} y={ctxMenu.y}
          wsName={runboxes.find(r => r.id === ctxMenu.id)?.name ?? ""}
          onDelete={() => {
            const ws = runboxes.find(r => r.id === ctxMenu.id);
            if (ws && confirm(`Delete "${ws.name}"?`)) onDelete(ctxMenu.id);
          }}
          onChangeIcon={() => {}}
          onClose={() => setCtxMenu(null)}
        />
      )}

      <div
        data-sidebar-panel
        style={{
          position: "fixed",
          left: 0, top: TOOLBAR_H, bottom: 0,
          width: panelW,
          background: C.bg1,
          borderRight: `1px solid ${C.border}`,
          display: "flex", flexDirection: "column",
          transform:     collapsed ? `translateX(-${panelW}px)` : "translateX(0)",
          opacity:       collapsed ? 0 : 1,
          transition:    "transform .18s cubic-bezier(.4,0,.2,1), opacity .15s ease",
          pointerEvents: collapsed ? "none" : "all",
          overflow: "hidden", zIndex: 200,
        }}
      >
        {fileTreeOpen ? (
          <FilePanel
            cwd={runboxes.find(r => r.id === activeId)?.cwd ?? "~"}
            onClose={() => onFileTreeToggle?.()}
            onOpenFile={path => onOpenFile?.(path)}
          />
        ) : (
          <WorkspaceList
            workspaces={runboxes}
            activeId={activeId}
            lastUsedMap={lastUsedMap}
            wsName={wsName}
            wsEditing={wsEditing}
            wsVal={wsVal}
            wsInputRef={wsInputRef}
            onWsClick={() => { setWsEditing(true); setWsVal(wsName); }}
            onWsChange={setWsVal}
            onWsKeyDown={e => {
              if (e.key === "Enter")  { e.preventDefault(); submitWsRename(); }
              if (e.key === "Escape") { setWsEditing(false); setWsVal(wsName); }
            }}
            onWsBlur={submitWsRename}
            onSelect={handleSelect}
            onRename={onRename}
            onContextMenu={(e, id) => setCtxMenu({ x: e.clientX, y: e.clientY, id })}
            onNew={() => setShowModal(true)}
          />
        )}
      </div>
    </>
  );
}