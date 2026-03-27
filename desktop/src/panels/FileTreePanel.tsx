// src/panels/FileTreePanel.tsx
import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { C, MONO, SANS } from "../shared/constants";

interface FsEntry {
  name:     string;
  path:     string;
  is_dir:   boolean;
  ext?:     string;
}

// ── Shared style ──────────────────────────────────────────────────────────────
const iconBtn: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  padding: "1px 3px", borderRadius: 3,
  display: "flex", alignItems: "center", justifyContent: "center",
  transition: "color .1s",
};

// ── File-type color map ───────────────────────────────────────────────────────
function fileColor(name: string, isDir: boolean): string {
  if (isDir) return "#c8d3e0";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "#3b82f6", tsx: "#3b82f6",
    js: "#f7c948", jsx: "#f7c948", mjs: "#f7c948",
    css: "#a78bfa", scss: "#a78bfa",
    html: "#f97316", htm: "#f97316",
    json: "#94a3b8", yaml: "#94a3b8", yml: "#94a3b8", toml: "#94a3b8",
    md: "#94a3b8", mdx: "#94a3b8",
    rs: "#f97316",
    py: "#3b82f6",
    go: "#22d3ee",
    sh: "#4ade80", bash: "#4ade80",
    png: "#ec4899", jpg: "#ec4899", jpeg: "#ec4899", svg: "#ec4899", gif: "#ec4899", webp: "#ec4899",
    lock: "#64748b", gitignore: "#64748b",
  };
  return map[ext] ?? "#8b9ab5";
}

// ── File icon SVG ─────────────────────────────────────────────────────────────
function FileIcon({ name, isDir, open }: { name: string; isDir: boolean; open?: boolean }) {
  const color = fileColor(name, isDir);
  if (isDir) return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      {open
        ? <path d="M5 19a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1M5 19h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2z"/>
        : <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      }
    </svg>
  );
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  );
}

// ── Inline create input ───────────────────────────────────────────────────────
function CreateInput({ parentPath, type, depth = 0, onDone }: {
  parentPath: string;
  type:       "file" | "folder";
  depth?:     number;
  onDone:     () => void;
}) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) { onDone(); return; }
    const sep = parentPath.includes("\\") ? "\\" : "/";
    const fullPath = `${parentPath}${sep}${trimmed}`;
    try {
      if (type === "folder") await invoke("fs_create_dir",  { path: fullPath });
      else                   await invoke("fs_create_file", { path: fullPath });
    } catch (e) { alert(`Create failed: ${e}`); }
    onDone();
  };

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      paddingLeft: 8 + depth * 14 + 28,
      paddingRight: 8, paddingTop: 3, paddingBottom: 3,
    }}>
      <FileIcon name={type === "folder" ? "folder" : (name || "file")} isDir={type === "folder"} />
      <input
        ref={inputRef}
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter")  submit();
          if (e.key === "Escape") onDone();
        }}
        onBlur={submit}
        placeholder={type === "folder" ? "folder name" : "file name"}
        style={{
          flex: 1,
          background: "rgba(255,255,255,.07)",
          border: "1px solid rgba(255,255,255,.3)",
          borderRadius: 4, color: "#e6edf3",
          fontSize: 12, fontFamily: MONO,
          padding: "2px 7px", outline: "none",
        }}
      />
    </div>
  );
}

// ── Tree Row ──────────────────────────────────────────────────────────────────
function TreeRow({
  entry, depth, expanded, selected,
  onToggle, onSelect, onOpen,
}: {
  entry:    FsEntry;
  depth:    number;
  expanded: boolean;
  selected: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onOpen:   () => void;
}) {
  const [hov, setHov] = useState(false);
  const color = fileColor(entry.name, entry.is_dir);

  return (
    <div
      onClick={() => { onSelect(); if (entry.is_dir) onToggle(); else onOpen(); }}
      onDoubleClick={() => { if (!entry.is_dir) onOpen(); }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", alignItems: "center",
        paddingLeft: 8 + depth * 14,
        paddingRight: 8,
        height: 26,
        cursor: "pointer",
        borderRadius: 6,
        background: selected ? "#2630377e" : hov ? "rgba(54,69,79,.45)" : "transparent",
        border: `1px solid ${selected ? "rgba(54,69,79,.8)" : "transparent"}`,
        transition: "background .08s, border-color .08s",
        userSelect: "none",
        gap: 6,
      }}
    >
      <span style={{ width: 12, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {entry.is_dir && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#8b9ab5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform .15s" }}>
            <polyline points="9 6 15 12 9 18"/>
          </svg>
        )}
      </span>

      <FileIcon name={entry.name} isDir={entry.is_dir} open={expanded} />

      <span style={{
        fontSize: 12, fontFamily: MONO,
        color: selected ? "#c8d3e0" : hov ? "#c8d3e0" : color,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        flex: 1,
        fontWeight: entry.is_dir ? 500 : 400,
        transition: "color .08s",
      }}>
        {entry.name}
      </span>
    </div>
  );
}

// ── Tree Node (recursive) ─────────────────────────────────────────────────────
function TreeNode({
  path, name, depth, selectedPath, onSelect, onOpen, creating, onCreatingDone,
}: {
  path:           string;
  name:           string;
  depth:          number;
  selectedPath:   string | null;
  onSelect:       (path: string, isDir: boolean) => void;
  onOpen:         (path: string) => void;
  creating?:      "file" | "folder" | null;
  onCreatingDone?: () => void;
}) {
  const [open,     setOpen]     = useState(depth === 0);
  const [children, setChildren] = useState<FsEntry[] | null>(null);
  const [loading,  setLoading]  = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const entries = await invoke<FsEntry[]>("fs_list_dir", { path });
      const sorted = [...entries].sort((a, b) => {
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });
      setChildren(sorted);
    } catch {
      setChildren([]);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    if (open) load();
  }, []);

  const toggle = () => {
    if (!open && children === null) load();
    setOpen(v => !v);
  };

  // If this is the root node (depth 0) and creating is set, show input at top
  const showRootCreate = depth === 0 && creating && onCreatingDone;

  return (
    <>
      <TreeRow
        entry={{ name, path, is_dir: true }}
        depth={depth}
        expanded={open}
        selected={selectedPath === path}
        onToggle={toggle}
        onSelect={() => onSelect(path, true)}
        onOpen={() => {}}
      />
      {open && (
        <>
          {loading && (
            <div style={{ paddingLeft: 8 + (depth + 1) * 14 + 6 + 12 + 6, height: 24, display: "flex", alignItems: "center" }}>
              <div style={{ width: 10, height: 10, border: `1.5px solid rgba(255,255,255,.15)`, borderTopColor: "#3fb68b", borderRadius: "50%", animation: "spin .7s linear infinite" }} />
            </div>
          )}
          {/* Root-level create input */}
          {showRootCreate && (
            <CreateInput
              parentPath={path}
              type={creating!}
              depth={depth + 1}
              onDone={() => { onCreatingDone!(); load(); }}
            />
          )}
          {!loading && children?.map(child =>
            child.is_dir ? (
              <TreeNode
                key={child.path}
                path={child.path}
                name={child.name}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelect={onSelect}
                onOpen={onOpen}
              />
            ) : (
              <TreeRow
                key={child.path}
                entry={child}
                depth={depth + 1}
                expanded={false}
                selected={selectedPath === child.path}
                onToggle={() => {}}
                onSelect={() => onSelect(child.path, false)}
                onOpen={() => onOpen(child.path)}
              />
            )
          )}
          {!loading && children?.length === 0 && !showRootCreate && (
            <div style={{ paddingLeft: 8 + (depth + 1) * 14 + 30, height: 22, display: "flex", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "#4a5568", fontFamily: SANS, fontStyle: "italic" }}>empty</span>
            </div>
          )}
        </>
      )}
    </>
  );
}

// ── Toolbar button ────────────────────────────────────────────────────────────
function TBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: 26, height: 26, border: "none", cursor: "pointer",
        background: hov ? "rgba(255,255,255,.08)" : "transparent",
        borderRadius: 6,
        color: hov ? "#e6edf3" : "#8b9ab5",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "background .1s, color .1s", flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

// ── Root component ────────────────────────────────────────────────────────────
export default function FileTreePanel({
  cwd,
  onClose,
  onOpenFile,
}: {
  cwd:        string;
  onClose:    () => void;
  onOpenFile: (path: string) => void;
}) {
  const [selected,   setSelected]   = useState<string | null>(null);
  const [rootName,   setRootName]   = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [creating,   setCreating]   = useState<"file" | "folder" | null>(null);

  useEffect(() => {
    const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
    setRootName(parts[parts.length - 1] ?? cwd);
  }, [cwd]);

  const handleSelect  = (path: string, _isDir: boolean) => setSelected(path);
  const handleOpen    = (path: string) => { setSelected(path); onOpenFile(path); };
  const handleRefresh = () => setRefreshKey(k => k + 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg1 }}>

      {/* Header */}
      <div style={{
        height: 40, flexShrink: 0,
        display: "flex", alignItems: "center",
        padding: "0 8px 0 12px",
        borderBottom: `1px solid ${C.border}`,
        gap: 4,
      }}>
        <span style={{
          flex: 1,
          fontSize: 11, fontWeight: 700,
          letterSpacing: ".12em",
          fontFamily: MONO,
          color: "#e6edf3",
          userSelect: "none",
        }}>
          FILES
        </span>

        {/* New File */}
        <button title="New File"
          onClick={() => setCreating("file")}
          style={{ ...iconBtn, color: "rgba(255,255,255,.4)", width: 28, height: 28 }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#fff"}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,.4)"}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h7"/>
            <polyline points="12 2 12 8 18 8"/>
            <circle cx="18" cy="18" r="4.5" fill="#0d1117" stroke="currentColor" strokeWidth="1.8"/>
            <line x1="18" y1="15.5" x2="18" y2="20.5" strokeWidth="2.2"/>
            <line x1="15.5" y1="18" x2="20.5" y2="18" strokeWidth="2.2"/>
          </svg>
        </button>

        {/* New Folder */}
        <button title="New Folder"
          onClick={() => setCreating("folder")}
          style={{ ...iconBtn, color: "rgba(255,255,255,.4)", width: 28, height: 28 }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#fff"}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,.4)"}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v2"/>
            <path d="M3 7v11a2 2 0 0 0 2 2h7"/>
            <circle cx="18" cy="18" r="4.5" fill="#0d1117" stroke="currentColor" strokeWidth="1.8"/>
            <line x1="18" y1="15.5" x2="18" y2="20.5" strokeWidth="2.2"/>
            <line x1="15.5" y1="18" x2="20.5" y2="18" strokeWidth="2.2"/>
          </svg>
        </button>

        {/* Refresh */}
        <TBtn title="Refresh" onClick={handleRefresh}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
        </TBtn>

        {/* Close */}
        <TBtn title="Close" onClick={onClose}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </TBtn>
      </div>

      {/* Tree */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 4px 12px" }}>
        <TreeNode
          key={`${cwd}-${refreshKey}`}
          path={cwd}
          name={rootName}
          depth={0}
          selectedPath={selected}
          onSelect={handleSelect}
          onOpen={handleOpen}
          creating={creating}
          onCreatingDone={() => { setCreating(null); handleRefresh(); }}
        />
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}