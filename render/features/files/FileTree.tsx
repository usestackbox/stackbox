import { invoke } from "@tauri-apps/api/core";
// features/files/FileTree.tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MONO, SANS } from "../../design";
import { CreateInput } from "./CreateInput";
import { FileIcon } from "./FileIcon";

interface FsEntry {
  name: string;
  path: string;
  is_dir: boolean;
  ext?: string;
}

type CtxMenuItem =
  | { label: string; shortcut?: string; danger?: boolean; onClick: () => void }
  | "separator";

interface CtxMenuState {
  x: number;
  y: number;
  entry: FsEntry;
}

function CtxMenu({
  menu,
  onClose,
  items,
}: { menu: CtxMenuState; onClose: () => void; items: CtxMenuItem[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const t = setTimeout(() => {
      document.addEventListener("mousedown", onDown);
      document.addEventListener("keydown", onKey);
    }, 50);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const x = Math.min(menu.x, window.innerWidth - 180);
  const y = Math.min(menu.y, window.innerHeight - 180);

  return createPortal(
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        top: y,
        left: x,
        zIndex: 99999,
        minWidth: 175,
        background: "rgba(18,20,24,0.96)",
        backdropFilter: "blur(28px)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 9,
        padding: 4,
        boxShadow: "0 24px 64px rgba(0,0,0,.75), inset 0 1px 0 rgba(255,255,255,.06)",
        fontFamily: SANS,
        userSelect: "none",
        opacity: visible ? 1 : 0,
        transform: visible ? "scale(1) translateY(0)" : "scale(0.95) translateY(-6px)",
        transformOrigin: "top left",
        transition: "opacity .14s ease, transform .14s cubic-bezier(.16,1,.3,1)",
      }}
    >
      <div
        style={{
          padding: "3px 10px 5px",
          fontSize: 9,
          fontFamily: MONO,
          fontWeight: 700,
          letterSpacing: ".1em",
          color: "rgba(255,255,255,.22)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {menu.entry.name.toUpperCase()}
      </div>
      <div style={{ height: 1, background: "rgba(255,255,255,.07)", marginBottom: 3 }} />
      {items.map((item, i) =>
        item === "separator" ? (
          <div
            key={i}
            style={{ height: 1, background: "rgba(255,255,255,.07)", margin: "3px 0" }}
          />
        ) : (
          <CtxItem key={item.label} {...item} onClose={onClose} />
        )
      )}
    </div>,
    document.body
  );
}

function CtxItem({
  label,
  shortcut,
  danger,
  onClick,
  onClose,
}: {
  label: string;
  shortcut?: string;
  danger?: boolean;
  onClick: () => void;
  onClose: () => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onClick={() => {
        onClick();
        onClose();
      }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex",
        alignItems: "center",
        padding: "0 10px",
        height: 28,
        borderRadius: 6,
        cursor: "pointer",
        background: hov
          ? danger
            ? "rgba(239,68,68,.18)"
            : "rgba(255,255,255,.08)"
          : "transparent",
        color: danger ? (hov ? "#fca5a5" : "#f87171") : hov ? "#ffffff" : "rgba(255,255,255,.78)",
        transition: "background .08s, color .08s",
        userSelect: "none",
        whiteSpace: "nowrap",
        gap: 8,
      }}
    >
      <span style={{ fontSize: 12, fontFamily: SANS, fontWeight: 400, flex: 1 }}>{label}</span>
      {shortcut && (
        <span
          style={{
            fontSize: 10,
            fontFamily: MONO,
            color: hov ? "rgba(255,255,255,.35)" : "rgba(255,255,255,.2)",
          }}
        >
          {shortcut}
        </span>
      )}
    </div>
  );
}

// ── TreeRow ───────────────────────────────────────────────────────────────────
function TreeRow({
  entry,
  depth,
  expanded,
  selected,
  onToggle,
  onSelect,
  onOpen,
  onContextMenu,
}: {
  entry: FsEntry;
  depth: number;
  expanded: boolean;
  selected: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onOpen: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const [hov, setHov] = useState(false);

  // folders: soft teal, nested folders: slightly dimmer
  // files: plain light gray — no bold, no bright colors
  const color = entry.is_dir
    ? depth === 0
      ? "rgba(120,200,200,.9)"
      : "rgba(120,200,200,.65)"
    : "rgba(180,185,195,.75)";

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
        if (entry.is_dir) onToggle();
        else onOpen();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!entry.is_dir) onOpen();
      }}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex",
        alignItems: "center",
        paddingLeft: 8 + depth * 14,
        paddingRight: 8,
        height: 25,
        cursor: "pointer",
        background: selected ? "rgba(9,71,113,.55)" : hov ? "rgba(255,255,255,.05)" : "transparent",
        userSelect: "none",
        gap: 5,
      }}
    >
      <span
        style={{
          width: 12,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {entry.is_dir && (
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="rgba(150,160,170,.7)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform .12s",
            }}
          >
            <polyline points="9 6 15 12 9 18" />
          </svg>
        )}
      </span>
      <FileIcon name={entry.name} isDir={entry.is_dir} />
      <span
        style={{
          fontSize: 13.5,
          fontFamily: SANS,
          fontWeight: 400,
          color: selected ? "rgba(220,230,240,.95)" : hov ? "rgba(210,220,230,.85)" : color,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flex: 1,
          transition: "color .08s",
        }}
      >
        {entry.name}
      </span>
    </div>
  );
}

// ── TreeNode ──────────────────────────────────────────────────────────────────
function TreeNode({
  path,
  name,
  depth,
  selectedPath,
  onSelect,
  onOpen,
  creatingIn,
  onCreatingDone,
  onCreatingCancel,
  onContextMenu,
  refreshKey,
}: {
  path: string;
  name: string;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string, isDir: boolean) => void;
  onOpen: (path: string) => void;
  creatingIn?: { type: "file" | "folder"; parentPath: string } | null;
  onCreatingDone?: () => void;
  onCreatingCancel?: () => void;
  onContextMenu: (e: React.MouseEvent, entry: FsEntry) => void;
  refreshKey?: number;
}) {
  const [open, setOpen] = useState(depth === 0);
  const [children, setChildren] = useState<FsEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const entries = await invoke<FsEntry[]>("fs_list_dir", { path });
      setChildren(
        [...entries].sort((a, b) => {
          if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
          return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        })
      );
    } catch {
      setChildren([]);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    if (refreshKey && open) load();
  }, [refreshKey]); // eslint-disable-line
  useEffect(() => {
    if (creatingIn?.parentPath === path && !open) {
      setOpen(true);
      if (children === null) load();
    }
  }, [creatingIn?.parentPath]); // eslint-disable-line
  useEffect(() => {
    if (open && children === null) load();
  }, [open]); // eslint-disable-line

  const toggle = () => {
    if (!open && children === null) load();
    setOpen((v) => !v);
  };
  const showCreate = creatingIn?.parentPath === path;

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
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu(e, { name, path, is_dir: true });
        }}
      />
      {open && (
        <>
          {loading && children === null && (
            <div
              style={{
                paddingLeft: 8 + (depth + 1) * 14 + 30,
                height: 22,
                display: "flex",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  width: 10,
                  height: 10,
                  border: "1.5px solid rgba(255,255,255,.15)",
                  borderTopColor: "#3fb68b",
                  borderRadius: "50%",
                  animation: "fsp-spin .7s linear infinite",
                }}
              />
            </div>
          )}
          {showCreate && (
            <CreateInput
              parentPath={path}
              type={creatingIn?.type}
              depth={depth + 1}
              onDone={() => {
                onCreatingDone?.();
                load();
              }}
              onCancel={() => onCreatingCancel?.()}
            />
          )}
          {children?.map((child) =>
            child.is_dir ? (
              <TreeNode
                key={child.path}
                path={child.path}
                name={child.name}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelect={onSelect}
                onOpen={onOpen}
                creatingIn={creatingIn}
                onCreatingDone={onCreatingDone}
                onCreatingCancel={onCreatingCancel}
                onContextMenu={onContextMenu}
                refreshKey={refreshKey}
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
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onContextMenu(e, child);
                }}
              />
            )
          )}
          {!loading && children?.length === 0 && !showCreate && (
            <div
              style={{
                paddingLeft: 8 + (depth + 1) * 14 + 28,
                height: 22,
                display: "flex",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  color: "rgba(255,255,255,.2)",
                  fontFamily: SANS,
                  fontStyle: "italic",
                }}
              >
                empty
              </span>
            </div>
          )}
        </>
      )}
    </>
  );
}

// ── FileTree (exported) ───────────────────────────────────────────────────────
export function FileTree({
  cwd,
  selectedPath,
  refreshKey,
  creating,
  onSelect,
  onOpen,
  onRefresh,
  onCreatingDone,
  onCreatingCancel,
  onContextMenu,
}: {
  cwd: string;
  selectedPath: string | null;
  refreshKey: number;
  creating?: { type: "file" | "folder"; parentPath: string } | null;
  onSelect: (path: string, isDir: boolean) => void;
  onOpen: (path: string) => void;
  onRefresh: () => void;
  onCreatingDone?: () => void;
  onCreatingCancel?: () => void;
  onContextMenu?: (e: React.MouseEvent, entry: FsEntry) => void;
}) {
  const [rootName, setRootName] = useState("");

  useEffect(() => {
    const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
    setRootName(parts[parts.length - 1] ?? cwd);
  }, [cwd]);

  const handleCtx = useCallback(
    (e: React.MouseEvent, entry: FsEntry) => {
      onContextMenu?.(e, entry);
    },
    [onContextMenu]
  );

  return (
    <>
      <TreeNode
        key={cwd}
        path={cwd}
        name={rootName}
        depth={0}
        selectedPath={selectedPath}
        onSelect={onSelect}
        onOpen={onOpen}
        creatingIn={creating}
        onCreatingDone={onCreatingDone}
        onCreatingCancel={onCreatingCancel}
        onContextMenu={handleCtx}
        refreshKey={refreshKey}
      />
      <style>{"@keyframes fsp-spin { to { transform: rotate(360deg); } }"}</style>
    </>
  );
}
