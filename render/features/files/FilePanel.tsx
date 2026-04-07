import { invoke } from "@tauri-apps/api/core";
// features/files/FilePanel.tsx
import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { C, MONO, SANS } from "../../design";
import { DeleteModal } from "./DeleteModal";
import { FileSearch } from "./FileSearch";
import { FileTree } from "./FileTree";

interface FsEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

interface Props {
  cwd: string;
  onClose: () => void;
  onOpenFile: (path: string) => void;
}

function TBtn({
  title,
  onClick,
  active,
  children,
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: 26,
        height: 26,
        border: "none",
        cursor: "pointer",
        background: active ? "rgba(59,130,246,.18)" : hov ? "rgba(255,255,255,.08)" : "transparent",
        borderRadius: 6,
        color: active ? "#3b82f6" : hov ? "#e6edf3" : "rgba(255,255,255,.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background .1s, color .1s",
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

interface CtxMenuState {
  x: number;
  y: number;
  entry: FsEntry;
}

function CtxMenu({
  menu,
  onClose,
  onCopyPath,
  onRename,
  onDelete,
  onNewFile,
  onNewFolder,
}: {
  menu: CtxMenuState;
  onClose: () => void;
  onCopyPath: () => void;
  onRename: () => void;
  onDelete: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
}) {
  const x = Math.min(menu.x, window.innerWidth - 180);
  const y = Math.min(menu.y, window.innerHeight - 180);

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9999 }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          left: x,
          top: y,
          background: "rgba(18,20,24,0.96)",
          backdropFilter: "blur(20px)",
          border: "1px solid rgba(255,255,255,.08)",
          borderRadius: 9,
          padding: 4,
          boxShadow: "0 24px 64px rgba(0,0,0,.75)",
          minWidth: 170,
          zIndex: 99999,
        }}
      >
        <div
          style={{
            padding: "3px 10px 5px",
            fontSize: 9,
            fontFamily: MONO,
            color: "rgba(255,255,255,.22)",
            letterSpacing: ".1em",
          }}
        >
          {menu.entry.name.toUpperCase()}
        </div>
        <div style={{ height: 1, background: "rgba(255,255,255,.07)", marginBottom: 3 }} />
        {[
          {
            label: "New File",
            icon: "📄",
            action: () => {
              onNewFile();
              onClose();
            },
          },
          {
            label: "New Folder",
            icon: "📁",
            action: () => {
              onNewFolder();
              onClose();
            },
          },
        ].map((item) => (
          <div
            key={item.label}
            onClick={item.action}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "0 10px",
              height: 28,
              borderRadius: 6,
              cursor: "pointer",
              color: "rgba(255,255,255,.78)",
              fontSize: 13,
              fontFamily: SANS,
              fontWeight: 400,
              transition: "background .08s",
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,.08)")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLElement).style.background = "transparent")
            }
          >
            <span style={{ fontSize: 11, opacity: 0.6 }}>{item.icon}</span>
            {item.label}
          </div>
        ))}
        <div style={{ height: 1, background: "rgba(255,255,255,.07)", margin: "3px 0" }} />
        {[
          {
            label: "Copy Path",
            action: () => {
              onCopyPath();
              onClose();
            },
          },
          {
            label: "Rename",
            action: () => {
              onRename();
              onClose();
            },
          },
          {
            label: "Delete",
            danger: true,
            action: () => {
              onDelete();
              onClose();
            },
          },
        ].map((item) => (
          <div
            key={item.label}
            onClick={item.action}
            style={{
              display: "flex",
              alignItems: "center",
              padding: "0 10px",
              height: 28,
              borderRadius: 6,
              cursor: "pointer",
              color: (item as any).danger ? "#f87171" : "rgba(255,255,255,.78)",
              fontSize: 13,
              fontFamily: SANS,
              fontWeight: 400,
              transition: "background .08s",
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLElement).style.background = (item as any).danger
                ? "rgba(239,68,68,.18)"
                : "rgba(255,255,255,.08)")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLElement).style.background = "transparent")
            }
          >
            {item.label}
          </div>
        ))}
      </div>
    </div>,
    document.body
  );
}

function RenameModal({
  entry,
  onConfirm,
  onCancel,
}: { entry: FsEntry; onConfirm: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(entry.name);
  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9998,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,.5)",
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: "#252526",
          border: "1px solid #454545",
          borderRadius: 6,
          padding: "16px 20px",
          minWidth: 320,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          boxShadow: "0 8px 32px rgba(0,0,0,.6)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <span style={{ fontSize: 13, color: "#cccccc", fontWeight: 400 }}>Rename</span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onConfirm(value.trim());
            if (e.key === "Escape") onCancel();
          }}
          style={{
            background: "#3c3c3c",
            border: "1px solid #007fd4",
            borderRadius: 3,
            color: "#cccccc",
            fontSize: 13,
            fontFamily: MONO,
            padding: "6px 10px",
            outline: "none",
          }}
        />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            style={{
              background: "transparent",
              border: "1px solid #454545",
              borderRadius: 3,
              color: "#cccccc",
              fontSize: 12,
              padding: "5px 16px",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(value.trim())}
            style={{
              background: "#0e639c",
              border: "none",
              borderRadius: 3,
              color: "#fff",
              fontSize: 12,
              padding: "5px 16px",
              cursor: "pointer",
            }}
          >
            Rename
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function FilePanel({ cwd, onClose, onOpenFile }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedIsDir, setSelectedIsDir] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState<{ type: "file" | "folder"; parentPath: string } | null>(
    null
  );
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const [renaming, setRenaming] = useState<FsEntry | null>(null);
  const [deleting, setDeleting] = useState<FsEntry | null>(null);

  const _getActiveDir = (): string => {
    if (!selected) return cwd;
    if (selectedIsDir) return selected;
    const parts = selected.replace(/\\/g, "/").split("/");
    parts.pop();
    return parts.join("/") || cwd;
  };

  const handleOpen = (path: string) => {
    setSelected(path);
    setSelectedIsDir(false);
    setSearching(false);
    onOpenFile(path);
  };
  const handleSelect = (path: string, isDir: boolean) => {
    setSelected(path);
    setSelectedIsDir(isDir);
  };

  const handleCtxMenu = useCallback((e: React.MouseEvent, entry: FsEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, entry });
  }, []);

  const handleEmptyCtxMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const dirEntry: FsEntry = {
        name: cwd.split(/[/\\]/).pop() ?? "root",
        path: cwd,
        is_dir: true,
      };
      setCtxMenu({ x: e.clientX, y: e.clientY, entry: dirEntry });
    },
    [cwd]
  );

  const handleDelete = async () => {
    if (!deleting) return;
    const entry = deleting;
    setDeleting(null);
    try {
      await invoke("fs_delete", { path: entry.path, isDir: entry.is_dir });
      if (selected === entry.path) setSelected(null);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      alert(`Delete failed: ${e}`);
    }
  };

  const handleRename = async (newName: string) => {
    if (!renaming || !newName || newName === renaming.name) {
      setRenaming(null);
      return;
    }
    const sep = renaming.path.includes("\\") ? "\\" : "/";
    const parts = renaming.path.replace(/\\/g, "/").split("/");
    parts[parts.length - 1] = newName;
    try {
      await invoke("fs_rename", { from: renaming.path, to: parts.join(sep) });
      setRefreshKey((k) => k + 1);
    } catch (e) {
      alert(`Rename failed: ${e}`);
    }
    setRenaming(null);
  };

  if (searching) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg1 }}>
        <FileSearch root={cwd} onClose={() => setSearching(false)} onOpenFile={handleOpen} />
      </div>
    );
  }

  return (
    <div
      style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg1 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Header */}
      <div
        style={{
          height: 42,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          padding: "0 8px 0 14px",
          borderBottom: `1px solid ${C.border}`,
          gap: 4,
        }}
      >
        <span
          style={{
            flex: 1,
            fontSize: 13,
            letterSpacing: ".06em",
            fontFamily: MONO,
            fontWeight: 400,
            color: "rgba(255,255,255,.55)",
            userSelect: "none",
          }}
        >
          FILES
        </span>
        <TBtn title="Search in files" onClick={() => setSearching(true)}>
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </TBtn>
        <TBtn title="Refresh" onClick={() => setRefreshKey((k) => k + 1)}>
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </TBtn>
        <TBtn title="Close" onClick={onClose}>
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </TBtn>
      </div>

      <div
        style={{ flex: 1, overflowY: "auto", padding: "4px 0 12px" }}
        onClick={() => {
          setSelected(null);
          setSelectedIsDir(false);
        }}
        onContextMenu={handleEmptyCtxMenu}
      >
        <FileTree
          cwd={cwd}
          selectedPath={selected}
          refreshKey={refreshKey}
          creating={creating}
          onSelect={handleSelect}
          onOpen={handleOpen}
          onRefresh={() => setRefreshKey((k) => k + 1)}
          onCreatingDone={() => {
            setCreating(null);
            setRefreshKey((k) => k + 1);
          }}
          onCreatingCancel={() => setCreating(null)}
          onContextMenu={handleCtxMenu}
        />
      </div>

      {ctxMenu &&
        (() => {
          const targetDir = ctxMenu.entry.is_dir
            ? ctxMenu.entry.path
            : (() => {
                const parts = ctxMenu.entry.path.replace(/\\/g, "/").split("/");
                parts.pop();
                return parts.join("/") || cwd;
              })();
          return (
            <CtxMenu
              menu={ctxMenu}
              onClose={() => setCtxMenu(null)}
              onCopyPath={() => navigator.clipboard.writeText(ctxMenu.entry.path)}
              onRename={() => setRenaming(ctxMenu.entry)}
              onDelete={() => setDeleting(ctxMenu.entry)}
              onNewFile={() => {
                setCreating({ type: "file", parentPath: targetDir });
                setSelected(targetDir);
                setSelectedIsDir(true);
              }}
              onNewFolder={() => {
                setCreating({ type: "folder", parentPath: targetDir });
                setSelected(targetDir);
                setSelectedIsDir(true);
              }}
            />
          );
        })()}

      {renaming && (
        <RenameModal entry={renaming} onConfirm={handleRename} onCancel={() => setRenaming(null)} />
      )}
      {deleting && (
        <DeleteModal entry={deleting} onConfirm={handleDelete} onCancel={() => setDeleting(null)} />
      )}

      <style>{"@keyframes fsp-spin { to { transform: rotate(360deg); } }"}</style>
    </div>
  );
}
