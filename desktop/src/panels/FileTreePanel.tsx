import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { C, MONO, SANS, tbtn } from "../shared/constants";

interface FileNode {
  name:      string;
  path:      string;
  is_dir:    boolean;
  children?: FileNode[];
}

interface CtxMenu {
  x:    number;
  y:    number;
  node: FileNode;
}

function folderColor(depth: number): string {
  if (depth === 0) return "#00e5ff";
  if (depth === 1) return "#ffd740";
  return "#ff9e40";
}

const iconBtn: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  padding: "1px 3px", borderRadius: 3,
  display: "flex", alignItems: "center", justifyContent: "center",
  transition: "color .1s",
};

// ── SVG Icons ─────────────────────────────────────────────────────────────────
const IcoOpenFile  = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
const IcoCopyPath  = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>;
const IcoRelPath   = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>;
const IcoCopyFile  = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>;
const IcoRename    = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
const IcoDelete    = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>;

// ── Context Menu ──────────────────────────────────────────────────────────────
function ContextMenu({
  menu, rootCwd, onClose, onRefresh, onOpenFile,
}: {
  menu:        CtxMenu;
  rootCwd:     string;
  onClose:     () => void;
  onRefresh:   () => void;
  onOpenFile?: (path: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    // small delay so the mousedown that opened it doesn't immediately close it
    const t = setTimeout(() => document.addEventListener("mousedown", handler), 50);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", handler); };
  }, [onClose]);

  const relativePath = menu.node.path.startsWith(rootCwd)
    ? menu.node.path.slice(rootCwd.length).replace(/^\//, "")
    : menu.node.path;

  interface Action {
    label:  string;
    icon?:  React.ReactNode;
    action: () => void;
    danger?: boolean;
  }

  const actions: (Action | "divider")[] = [
    ...(!menu.node.is_dir ? [{
      label: "Open File", icon: <IcoOpenFile />,
      action: () => { onOpenFile?.(menu.node.path); onClose(); },
    }] : []),
    {
      label: "Copy Path", icon: <IcoCopyPath />,
      action: () => { navigator.clipboard.writeText(menu.node.path); onClose(); },
    },
    {
      label: "Copy Relative Path", icon: <IcoRelPath />,
      action: () => { navigator.clipboard.writeText(relativePath); onClose(); },
    },
    ...(!menu.node.is_dir ? [{
      label: "Copy File Contents", icon: <IcoCopyFile />,
      action: async () => {
        try {
            const content = await invoke<string>("read_text_file", { path: menu.node.path });
            await invoke("copy_to_clipboard", { text: content });
        } catch { /**/ }
        onClose();
        },
    }] : []),
    "divider",
    {
      label: "Rename", icon: <IcoRename />,
      action: async () => {
        const newName = window.prompt("Rename to:", menu.node.name);
        if (!newName || newName === menu.node.name) { onClose(); return; }
        const newPath = menu.node.path.replace(/[^/]+$/, newName);
        try {
          await invoke("fs_rename", { from: menu.node.path, to: newPath });
          onRefresh();
        } catch (e) { alert(`Rename failed: ${e}`); }
        onClose();
      },
    },
    {
      label: "Delete", icon: <IcoDelete />, danger: true,
      action: async () => {
        if (!window.confirm(`Delete "${menu.node.name}"?`)) { onClose(); return; }
        try {
          await invoke("fs_delete", { path: menu.node.path, isDir: menu.node.is_dir });
          onRefresh();
        } catch (e) { alert(`Delete failed: ${e}`); }
        onClose();
      },
    },
  ];

  // Clamp to viewport
  const menuW = 220, menuH = actions.length * 34;
  const left = Math.min(menu.x, window.innerWidth  - menuW - 8);
  const top  = Math.min(menu.y, window.innerHeight - menuH - 8);

  return (
    <div ref={ref} style={{
      position: "fixed", zIndex: 9999,
      left, top,
      background: "rgba(18,18,22,0.97)",
      backdropFilter: "blur(16px)",
      border: "1px solid rgba(255,255,255,.1)",
      borderRadius: 10,
      boxShadow: "0 16px 48px rgba(0,0,0,.7), 0 0 0 0.5px rgba(255,255,255,.05)",
      padding: "5px 0",
      minWidth: menuW,
      fontFamily: MONO,
      animation: "ctxIn .1s ease-out",
    }}>
      {/* File name header */}
      <div style={{
        padding: "6px 14px 8px",
        fontSize: 11, color: "rgba(255,255,255,.35)",
        letterSpacing: ".03em",
        borderBottom: "1px solid rgba(255,255,255,.06)",
        marginBottom: 4,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {menu.node.name}
      </div>

      {actions.map((a, i) =>
        a === "divider" ? (
          <div key={i} style={{ height: 1, background: "rgba(255,255,255,.06)", margin: "4px 0" }} />
        ) : (
          <CtxItem key={i} label={a.label} icon={a.icon} danger={a.danger} onClick={a.action} />
        )
      )}

      <style>{`@keyframes ctxIn { from { opacity:0; transform:scale(.96) translateY(-4px); } to { opacity:1; transform:scale(1) translateY(0); } }`}</style>
    </div>
  );
}

function CtxItem({ label, icon, danger, onClick }: {
  label:    string;
  icon?:    React.ReactNode;
  danger?:  boolean;
  onClick:  () => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "7px 14px", cursor: "pointer", fontSize: 12,
        color: danger ? (hov ? "#ff6b6b" : "#e05252") : (hov ? "#ffffff" : "rgba(255,255,255,.7)"),
        background: hov ? (danger ? "rgba(255,80,80,.08)" : "rgba(255,255,255,.06)") : "transparent",
        transition: "all .08s",
      }}
    >
      <span style={{ opacity: danger ? 1 : 0.55, flexShrink: 0 }}>{icon}</span>
      {label}
    </div>
  );
}

// ── Inline Create Input ───────────────────────────────────────────────────────
function CreateInput({ parentPath, type, onDone }: {
  parentPath: string;
  type:       "file" | "folder";
  onDone:     () => void;
}) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) { onDone(); return; }
    const fullPath = `${parentPath}/${trimmed}`;
    try {
      if (type === "folder") await invoke("fs_create_dir",  { path: fullPath });
      else                   await invoke("fs_create_file", { path: fullPath });
    } catch (e) { alert(`Create failed: ${e}`); }
    onDone();
  };

  return (
    <div style={{ display: "flex", alignItems: "center", padding: "4px 10px", gap: 6 }}>
      <span style={{ fontSize: 10, opacity: 0.4, color: type === "folder" ? "#ffd740" : "#f0f0f0" }}>
        {type === "folder" ? "▶" : "·"}
      </span>
      <input
        ref={inputRef}
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") submit(); if (e.key === "Escape") onDone(); }}
        onBlur={submit}
        placeholder={type === "folder" ? "folder name" : "file name"}
        style={{
          flex: 1, background: "rgba(255,255,255,.07)",
          border: "1px solid rgba(0,229,255,.35)",
          borderRadius: 5, color: "#f0f0f0",
          fontSize: 12, fontFamily: MONO,
          padding: "3px 8px", outline: "none",
        }}
      />
    </div>
  );
}

// ── File Item ─────────────────────────────────────────────────────────────────
function FileItem({ node, depth, rootCwd, onOpenFile, onRefreshParent }: {
  node:             FileNode;
  depth:            number;
  rootCwd:          string;
  onOpenFile?:      (path: string) => void;
  onRefreshParent:  () => void;
}) {
  const [open,     setOpen]     = useState(false);
  const [children, setChildren] = useState<FileNode[]>(node.children ?? []);
  const [loaded,   setLoaded]   = useState(!!node.children);
  const [hov,      setHov]      = useState(false);
  const [ctxMenu,  setCtxMenu]  = useState<CtxMenu | null>(null);
  const [creating, setCreating] = useState<"file" | "folder" | null>(null);

  const loadChildren = useCallback(async () => {
    try {
      const kids = await invoke<FileNode[]>("fs_list_dir", { path: node.path });
      setChildren(kids);
      setLoaded(true);
    } catch { /**/ }
  }, [node.path]);

  const toggle = async () => {
    if (!node.is_dir) { onOpenFile?.(node.path); return; }
    if (!loaded) await loadChildren();
    setOpen(o => !o);
  };

  // Refresh this node's children + bubble up
  const handleRefresh = useCallback(async () => {
    await loadChildren();
    onRefreshParent();
  }, [loadChildren, onRefreshParent]);

  const onCtxMenu = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, node });
  };

  const color = node.is_dir ? folderColor(depth) : "#e8e8e8";

  return (
    <div>
      <div
        onClick={toggle}
        onContextMenu={onCtxMenu}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: `3px 8px 3px ${12 + depth * 14}px`,
          cursor: "pointer", fontSize: 12, fontFamily: MONO,
          color, background: hov ? "rgba(255,255,255,.05)" : "transparent",
          userSelect: "none", fontWeight: node.is_dir ? 500 : 400,
          borderRadius: 4, margin: "0 4px",
          transition: "background .08s",
        }}
      >
        {node.is_dir ? (
          <span style={{ fontSize: 8, opacity: 0.6, width: 10, flexShrink: 0, transition: "transform .12s",
            display: "inline-block", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
        ) : (
          <span style={{ width: 10, flexShrink: 0, opacity: 0.25, fontSize: 10 }}>·</span>
        )}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
          {node.name}
        </span>
        {node.is_dir && hov && (
          <div style={{ display: "flex", gap: 1, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            <button title="New File"
              onClick={async () => { if (!loaded) await loadChildren(); setOpen(true); setCreating("file"); }}
              style={{ ...iconBtn, color: "rgba(255,255,255,.4)", padding: "2px 4px" }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#fff"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,.4)"}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
              </svg>
            </button>
            <button title="New Folder"
              onClick={async () => { if (!loaded) await loadChildren(); setOpen(true); setCreating("folder"); }}
              style={{ ...iconBtn, color: "rgba(255,255,255,.4)", padding: "2px 4px" }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#fff"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,.4)"}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                <line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>
              </svg>
            </button>
          </div>
        )}
      </div>

      {node.is_dir && open && (
        <>
          {creating && (
            <div style={{ paddingLeft: (depth + 1) * 14 }}>
              <CreateInput parentPath={node.path} type={creating}
                onDone={async () => {
                  setCreating(null);
                  await loadChildren(); // auto-refresh after create
                }} />
            </div>
          )}
          {children.map(child => (
            <FileItem key={child.path} node={child} depth={depth + 1}
              rootCwd={rootCwd} onOpenFile={onOpenFile} onRefreshParent={handleRefresh} />
          ))}
        </>
      )}

      {ctxMenu && (
        <ContextMenu
          menu={ctxMenu} rootCwd={rootCwd}
          onClose={() => setCtxMenu(null)}
          onRefresh={handleRefresh}
          onOpenFile={onOpenFile}
        />
      )}
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────
export default function FileTreePanel({ cwd, onClose, onOpenFile }: {
  cwd:         string;
  onClose:     () => void;
  onOpenFile?: (path: string) => void;
}) {
  const [tree,       setTree]       = useState<FileNode[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [creating,   setCreating]   = useState<"file" | "folder" | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    invoke<FileNode[]>("fs_list_dir", { path: cwd })
      .then(nodes => { setTree(nodes); setLoading(false); })
      .catch(() => setLoading(false));
  }, [cwd]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", minHeight: 0 }}>
      {/* Header */}
      <div style={{
        height: 48, padding: "0 8px 0 14px", flexShrink: 0,
        borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", gap: 4, background: C.bg1,
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00e5ff" strokeWidth="2" strokeLinecap="round">
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        </svg>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#f0f0f0", flex: 1, fontFamily: SANS, marginLeft: 4 }}>Files</span>

        {/* New File */}
        <button title="New File" onClick={() => setCreating("file")}
          style={{ ...iconBtn, color: "rgba(255,255,255,.4)", width: 28, height: 28 }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#fff"}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,.4)"}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
          </svg>
        </button>

        {/* New Folder */}
        <button title="New Folder" onClick={() => setCreating("folder")}
          style={{ ...iconBtn, color: "rgba(255,255,255,.4)", width: 28, height: 28 }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#fff"}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,.4)"}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            <line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>
          </svg>
        </button>

        {/* Refresh */}
        <button title="Refresh" onClick={refresh}
          style={{ ...iconBtn, color: "rgba(255,255,255,.4)", width: 28, height: 28 }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#fff"}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,.4)"}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
        </button>

        {/* Close */}
        <button onClick={onClose}
          style={{ ...iconBtn, color: "rgba(255,255,255,.3)", width: 28, height: 28, fontSize: 14 }}
          onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.color = "#f0f0f0"; el.style.background = "rgba(255,255,255,.07)"; }}
          onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.color = "rgba(255,255,255,.3)"; el.style.background = "transparent"; }}>
          ✕
        </button>
      </div>

      {/* Tree */}
      <div style={{ flex: 1, overflow: "auto", paddingTop: 6, minHeight: 0 }}>
        {creating && (
          <CreateInput parentPath={cwd} type={creating}
            onDone={() => { setCreating(null); refresh(); }} />
        )}
        {loading ? (
          <div style={{ padding: 16, color: "rgba(255,255,255,.3)", fontSize: 12, fontFamily: MONO }}>Loading...</div>
        ) : tree.length === 0 ? (
          <div style={{ padding: 16, color: "rgba(255,255,255,.3)", fontSize: 12, fontFamily: MONO }}>Empty directory</div>
        ) : (
          tree.map(node => (
            <FileItem key={node.path} node={node} depth={0}
              rootCwd={cwd} onOpenFile={onOpenFile} onRefreshParent={refresh} />
          ))
        )}
      </div>
    </div>
  );
}