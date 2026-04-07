import { getCurrentWindow } from "@tauri-apps/api/window";
// sidebar/Sidebar.tsx
import { useEffect, useRef, useState } from "react";
import { C } from "../design";
import { FilePanel } from "../features/files";
import type { Runbox } from "../types";
import { CreateWorkspaceModal } from "./CreateWorkspaceModal";
import { WorkspaceContextMenu } from "./WorkspaceContextMenu";
import { WorkspaceList } from "./WorkspaceList";

const IS_MAC = navigator.userAgent.toLowerCase().includes("mac");
const BASE_TOOLBAR_H = 42;
const TRAFFIC_H = 28;
const WORKSPACE_W = 260;

export interface SidebarProps {
  runboxes: Runbox[];
  activeId: string | null;
  cwdMap: Record<string, string>;
  collapsed: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
  onCreate: (name: string, cwd: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  fileTreeOpen?: boolean;
  onFileTreeToggle?: () => void;
  onOpenFile?: (path: string) => void;
  onFileTreeWidth?: (w: number) => void;
  worktreeMap?: Record<string, string>;
}

function useMacFullscreen() {
  const [fs, setFs] = useState(false);
  useEffect(() => {
    if (!IS_MAC) return;
    getCurrentWindow()
      .isFullscreen()
      .then(setFs)
      .catch(() => {});
    const unsub = getCurrentWindow().onResized(async () => {
      try {
        setFs(await getCurrentWindow().isFullscreen());
      } catch {}
    });
    return () => {
      unsub.then((f) => f()).catch(() => {});
    };
  }, []);
  return fs;
}

export function Sidebar({
  runboxes,
  activeId,
  cwdMap,
  collapsed,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  fileTreeOpen,
  onFileTreeToggle,
  onOpenFile,
  onFileTreeWidth,
}: SidebarProps) {
  const isFullscreen = useMacFullscreen();
  const TOOLBAR_H = IS_MAC && !isFullscreen ? BASE_TOOLBAR_H + TRAFFIC_H : BASE_TOOLBAR_H;
  const panelW = WORKSPACE_W;

  useEffect(() => {
    onFileTreeWidth?.(WORKSPACE_W);
  }, [fileTreeOpen]); // eslint-disable-line

  // ── Local state ───────────────────────────────────────────────────────────
  const [showModal, setShowModal] = useState(false);
  const [lastUsedMap, setLastUsedMap] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem("stackbox-last-used") ?? "{}");
    } catch {
      return {};
    }
  });

  // ── Live tick — re-render every 60 s so "Xm ago" stays accurate ──────────
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [wsName, setWsName] = useState("WORKSPACE");
  const [wsEditing, setWsEditing] = useState(false);
  const [wsVal, setWsVal] = useState("WORKSPACE");
  const wsInputRef = useRef<HTMLInputElement>(null);

  /** Which workspace item is open for inline editing, and which field */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editField, setEditField] = useState<"name" | "dir" | null>(null);

  useEffect(() => {
    if (wsEditing) setTimeout(() => wsInputRef.current?.select(), 20);
  }, [wsEditing]);

  const submitWsRename = () => {
    if (wsVal.trim()) setWsName(wsVal.trim().toUpperCase());
    else setWsVal(wsName);
    setWsEditing(false);
  };

  // Stamp whenever the active workspace changes (covers create, kernel-driven switch, etc.)
  useEffect(() => {
    if (!activeId) return;
    setLastUsedMap((prev) => {
      const next = { ...prev, [activeId]: Date.now() };
      try {
        localStorage.setItem("stackbox-last-used", JSON.stringify(next));
      } catch {}
      return next;
    });
  }, [activeId]);

  const handleSelect = (id: string) => {
    setLastUsedMap((prev) => {
      const next = { ...prev, [id]: Date.now() };
      try {
        localStorage.setItem("stackbox-last-used", JSON.stringify(next));
      } catch {}
      return next;
    });
    onSelect(id);
  };

  return (
    <>
      {showModal && (
        <CreateWorkspaceModal
          onSubmit={(n, c) => {
            onCreate(n, c);
            setShowModal(false);
          }}
          onClose={() => setShowModal(false)}
        />
      )}

      {ctxMenu && (
        <WorkspaceContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          wsName={runboxes.find((r) => r.id === ctxMenu.id)?.name ?? ""}
          onDelete={() => {
            const ws = runboxes.find((r) => r.id === ctxMenu.id);
            if (ws && confirm(`Delete "${ws.name}"?`)) onDelete(ctxMenu.id);
          }}
          onChangeName={() => {
            setEditingId(ctxMenu.id);
            setEditField("name");
            setCtxMenu(null);
          }}
          onChangeDir={() => {
            setEditingId(ctxMenu.id);
            setEditField("dir");
            setCtxMenu(null);
          }}
          onClose={() => setCtxMenu(null)}
        />
      )}

      <div
        data-sidebar-panel
        style={{
          position: "fixed",
          left: 0,
          top: TOOLBAR_H,
          bottom: 0,
          width: panelW,
          background: C.bg1,
          borderRight: `1px solid ${C.border}`,
          display: "flex",
          flexDirection: "column",
          transform: collapsed ? `translateX(-${panelW}px)` : "translateX(0)",
          opacity: collapsed ? 0 : 1,
          transition: "transform .18s cubic-bezier(.4,0,.2,1), opacity .15s ease",
          pointerEvents: collapsed ? "none" : "all",
          overflow: "hidden",
          zIndex: 200,
        }}
      >
        {fileTreeOpen ? (
          <FilePanel
            cwd={runboxes.find((r) => r.id === activeId)?.cwd ?? "~"}
            onClose={() => onFileTreeToggle?.()}
            onOpenFile={(path) => onOpenFile?.(path)}
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
            onWsClick={() => {
              setWsEditing(true);
              setWsVal(wsName);
            }}
            onWsChange={setWsVal}
            onWsKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitWsRename();
              }
              if (e.key === "Escape") {
                setWsEditing(false);
                setWsVal(wsName);
              }
            }}
            onWsBlur={submitWsRename}
            onSelect={handleSelect}
            onRename={onRename}
            onContextMenu={(e, id) => setCtxMenu({ x: e.clientX, y: e.clientY, id })}
            onNew={() => setShowModal(true)}
            editingId={editingId}
            editField={editField}
            onExternalEditDone={() => {
              setEditingId(null);
              setEditField(null);
            }}
          />
        )}
      </div>
    </>
  );
}
