// src/runbox/WorkspaceView.tsx
import { useState, useRef, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import RunPane from "../core/RunPane";
import BrowsePane from "../core/BrowsePane";
import { DiffViewer } from "./DiffViewer";
import { FileChangeList } from "../panels/FileChangeList";
import { GitWorktreePanel } from "../panels/Gitworktreepanel";
import MemoryPanel from "../panels/MemoryPanel";
import { C, MONO, SANS, tbtn } from "../shared/constants";
import type { Runbox, DiffTab } from "../shared/types";
import { IcoBrain, IcoFiles, IcoGit } from "../shared/icons";
import { FileEditorPane } from "../panels/Workspacepanel";
import { fileColor } from "../panels/Filestructurepanel";

const GAP   = 8;
const MIN_W = 280;
const MIN_H = 180;

interface WinState {
  id:        string;
  label:     string;
  kind:      "terminal" | "browser";
  x:         number;
  y:         number;
  w:         number;
  h:         number;
  minimized: boolean;
  maximized: boolean;
  preMaxX?:  number;
  preMaxY?:  number;
  preMaxW?:  number;
  preMaxH?:  number;
  cwd:       string;
  zIndex:    number;
}

interface FileTab {
  id:       string;
  filePath: string;
}

type SidePanel = "files" | "git" | "memory" | null;
type FilesView = "list" | "diff";

interface WorkspaceViewProps {
  runbox:             Runbox;
  branch:             string;
  toolbarSlot?:       React.ReactNode;
  activeSessionId?:   string | null;
  runboxes?:          Array<{ id: string; name: string }>;
  sidePanel?:         SidePanel;
  sidebarCollapsed?:  boolean;
  fileTreeOpen?:      boolean;
  contentMarginLeft?: number;
  onSidePanelToggle?: (panel: "files" | "git" | "memory") => void;
  onSidebarToggle?:   () => void;
  onFileTreeToggle?:  () => void;
  onCwdChange:        (cwd: string) => void;
  onSessionChange?:   (sid: string) => void;
  onOpenDiff:         (ref: { open: (fc: any) => void }) => void;
  onOpenFile?:        (ref: { open: (path: string) => void }) => void;
}

function tileWindows(count: number, aw: number, ah: number) {
  if (count === 0) return [];
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const w    = Math.floor((aw - GAP * (cols + 1)) / cols);
  const h    = Math.floor((ah - GAP * (rows + 1)) / rows);
  return Array.from({ length: count }, (_, i) => ({
    x: GAP + (i % cols) * (w + GAP),
    y: GAP + Math.floor(i / cols) * (h + GAP),
    w, h,
  }));
}

function winLabel(win: WinState) {
  if (win.kind === "browser") return win.label ?? "browser";
  return win.cwd.split(/[/\\]/).filter(Boolean).pop() ?? "~";
}

let _topZ = 10;
const nextZ = () => ++_topZ;

// ── Strip icon button ─────────────────────────────────────────────────────────
export function StripIcon({ children, title, active, onClick }: {
  children: React.ReactNode; title: string; active?: boolean; onClick: () => void;
}) {
  const [hov, setHov] = useState(false);
  const lit = active || hov;
  return (
    <button title={title}
      onMouseDown={e => e.stopPropagation()}
      onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        width: 30, height: 30, flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: lit ? "rgba(0,229,255,.15)" : "transparent",
        border: `1px solid ${lit ? "rgba(0,229,255,.3)" : "transparent"}`,
        borderRadius: 8, cursor: "pointer", transition: "all .12s",
        color: lit ? "#00e5ff" : C.t2,
      }}>{children}</button>
  );
}

// ── Window control button ─────────────────────────────────────────────────────
function WinBtn({ children, title, hoverBg, hoverColor, onClick }: {
  children: React.ReactNode; title: string; hoverBg: string; hoverColor: string; onClick: () => void;
}) {
  return (
    <button title={title} onClick={onClick}
      style={{ width: 28, height: 28, borderRadius: 7, border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: C.t1, transition: "all .12s", flexShrink: 0 }}
      onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = hoverBg; el.style.color = hoverColor; }}
      onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.color = C.t1; }}>
      {children}
    </button>
  );
}

// ── Panel header ──────────────────────────────────────────────────────────────
function PanelHeader({ title, icon, onClose }: { title: string; icon?: React.ReactNode; onClose: () => void }) {
  return (
    <div style={{
      height: 48, padding: "0 12px 0 14px", flexShrink: 0,
      borderBottom: `1px solid ${C.border}`,
      display: "flex", alignItems: "center", gap: 8, background: C.bg1,
    }}>
      {icon && <span style={{ flexShrink: 0, opacity: .75 }}>{icon}</span>}
      <span style={{ fontSize: 13, fontWeight: 600, color: C.t0, flex: 1, fontFamily: SANS }}>{title}</span>
      <button
        onMouseDown={e => e.stopPropagation()}
        onClick={onClose}
        style={{ ...tbtn, width: 28, height: 28, borderRadius: 8, fontSize: 14, color: C.t2 }}
        onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = C.redBg; el.style.color = C.red; }}
        onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.color = C.t2; }}>✕</button>
    </div>
  );
}

// ── Panel resize handle ───────────────────────────────────────────────────────
function PanelResizeHandle({ onResize }: { onResize: (w: number) => void }) {
  const dragging = useRef(false);
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault(); dragging.current = true;
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const w = window.innerWidth - e.clientX - 48;
      if (w > 200 && w < 780) onResize(w);
    };
    const onUp = () => { dragging.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  };
  return (
    <div onMouseDown={onMouseDown}
      style={{ width: 4, flexShrink: 0, cursor: "col-resize", background: "transparent", transition: "background .1s" }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = C.borderMd}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"} />
  );
}

// ── Tab X close button ────────────────────────────────────────────────────────
function TabCloseBtn({ onClose }: { onClose: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onMouseDown={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); onClose(); }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      title="Close"
      style={{
        width: 16, height: 16, borderRadius: 4, border: "none",
        background: hov ? "rgba(239,68,68,.25)" : "transparent",
        cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: hov ? "#f87171" : "rgba(255,255,255,.35)",
        flexShrink: 0, padding: 0,
        transition: "background .1s, color .1s",
      }}>
      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
        <line x1="4" y1="4" x2="20" y2="20"/><line x1="20" y1="4" x2="4" y2="20"/>
      </svg>
    </button>
  );
}

// ── Terminal tab context menu ─────────────────────────────────────────────────
function TabContextMenu({ x, y, win, isFirst, isLast, onClose, onCloseTab, onRestore, onMoveLeft, onMoveRight }: {
  x: number; y: number; win: WinState;
  isFirst: boolean; isLast: boolean;
  onClose: () => void; onCloseTab: () => void; onRestore?: () => void;
  onMoveLeft: () => void; onMoveRight: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }, 50);
    return () => clearTimeout(t);
  }, [onClose]);

  const left = Math.min(x, window.innerWidth  - 200);
  const top  = Math.min(y, window.innerHeight - 180);

  const items: { label: string; action: () => void; danger?: boolean; disabled?: boolean }[] = [
    ...(win.minimized ? [{ label: "Restore", action: () => { onRestore?.(); onClose(); } }] : []),
    { label: "Move Left",  action: () => { onMoveLeft();  onClose(); }, disabled: isFirst },
    { label: "Move Right", action: () => { onMoveRight(); onClose(); }, disabled: isLast  },
    { label: "Close",      action: () => { onCloseTab();  onClose(); }, danger: true },
  ];

  return (
    <div ref={ref} style={{
      position: "fixed", zIndex: 9999, left, top,
      background: "rgba(18,18,22,0.97)", backdropFilter: "blur(16px)",
      border: "1px solid rgba(255,255,255,.1)", borderRadius: 8,
      boxShadow: "0 12px 40px rgba(0,0,0,.7)", padding: "4px 0", minWidth: 170, fontFamily: MONO,
    }}>
      <div style={{ padding: "5px 12px 7px", fontSize: 10, color: "rgba(255,255,255,.3)", borderBottom: "1px solid rgba(255,255,255,.06)", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {winLabel(win)}
      </div>
      {items.map((item, i) => (
        <div key={i} onClick={item.disabled ? undefined : item.action}
          style={{ padding: "7px 12px", cursor: item.disabled ? "default" : "pointer", fontSize: 12, color: item.disabled ? "rgba(255,255,255,.2)" : item.danger ? "#f87171" : "rgba(255,255,255,.75)", transition: "background .08s" }}
          onMouseEnter={e => { if (!item.disabled) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,.06)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
          {item.label}
        </div>
      ))}
    </div>
  );
}

export function WorkspaceView({
  runbox, branch, toolbarSlot, runboxes,
  sidePanel: sidePanelProp,
  sidebarCollapsed, fileTreeOpen,
  contentMarginLeft = 0,
  onSidePanelToggle, onSidebarToggle, onFileTreeToggle,
  onCwdChange, onSessionChange, onOpenDiff, onOpenFile,
}: WorkspaceViewProps) {
  const areaRef    = useRef<HTMLDivElement>(null);
  const labelCount = useRef(0);

  const [wins,        setWins]        = useState<WinState[]>([]);
  const [activeWinId, setActiveWinId] = useState<string | null>(null);

  const [fileTabs,     setFileTabs]     = useState<FileTab[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);

  const [_sidePanel, _setSidePanel] = useState<SidePanel>(null);
  const sidePanel    = sidePanelProp !== undefined ? sidePanelProp : _sidePanel;
  const setSidePanel = (v: SidePanel) => { _setSidePanel(v); };
  const [filesView,  setFilesView]  = useState<FilesView>("list");
  const [activeDiff, setActiveDiff] = useState<DiffTab | null>(null);
  const [panelWidth, setPanelWidth] = useState(450);
  const [tabCtx,     setTabCtx]     = useState<{ x: number; y: number; win: WinState; idx: number } | null>(null);
  const [dragTabId,  setDragTabId]  = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [pendingBrowserUrl, setPendingBrowserUrl] = useState<Record<string, string | null>>({});
  const dragTabIdRef  = useRef<string | null>(null);
  const dragOverIdRef = useRef<string | null>(null);
  const initialized   = useRef(false);
  const resizeTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const winsRef     = useRef<WinState[]>([]);
  const fileTabsRef = useRef<FileTab[]>([]);
  useEffect(() => { winsRef.current = wins; }, [wins]);
  useEffect(() => { fileTabsRef.current = fileTabs; }, [fileTabs]);

  const dispatchResize = useCallback(() => {
    if (resizeTimer.current) clearTimeout(resizeTimer.current);
    resizeTimer.current = setTimeout(() => window.dispatchEvent(new Event("resize")), 80);
  }, []);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const area = areaRef.current; if (!area) return;
    const aw = area.offsetWidth || 800, ah = area.offsetHeight || 600;
    labelCount.current = 1;
    const id = crypto.randomUUID();
    setWins([{ id, label: "w1", kind: "terminal", x: GAP, y: GAP, w: aw - GAP * 2, h: ah - GAP * 2, minimized: false, maximized: false, cwd: runbox.cwd, zIndex: nextZ() }]);
    setActiveWinId(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const area = areaRef.current; if (!area) return;
    const ro = new ResizeObserver(() => {
      const aw = area.offsetWidth, ah = area.offsetHeight;
      setWins(prev => {
        const visible = prev.filter(w => !w.minimized && !w.maximized);
        if (visible.length !== 1) return prev;
        return prev.map(w => w.minimized || w.maximized ? w : { ...w, x: GAP, y: GAP, w: aw - GAP * 2, h: ah - GAP * 2 });
      });
      setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
    });
    ro.observe(area);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    onOpenDiff({ open: (fc: any) => {
      setActiveDiff({ id: `diff-${fc.path}`, path: fc.path, diff: fc.diff, changeType: fc.change_type, insertions: fc.insertions, deletions: fc.deletions, openedAt: Date.now() });
      setSidePanel("files"); setFilesView("diff");
    }});
  }, [onOpenDiff]);

  const focusWin = useCallback((id: string) => {
    setActiveWinId(id);
    setWins(prev => prev.map(w => w.id === id ? { ...w, zIndex: nextZ() } : w));
  }, []);

  const openFileWin = useCallback((filePath: string) => {
    const existing = fileTabsRef.current.find(t => t.filePath === filePath);
    if (existing) { setActiveFileId(existing.id); return; }
    const id = crypto.randomUUID();
    setFileTabs(prev => [...prev, { id, filePath }]);
    setActiveFileId(id);
  }, []);

  useEffect(() => {
    onOpenFile?.({ open: openFileWin });
  }, [onOpenFile, openFileWin]);

  const closeFileTab = useCallback((id: string) => {
    setFileTabs(prev => {
      const next = prev.filter(t => t.id !== id);
      setActiveFileId(cur => {
        if (cur !== id) return cur;
        if (next.length === 0) return null;
        const idx = prev.findIndex(t => t.id === id);
        return next[Math.min(idx, next.length - 1)].id;
      });
      return next;
    });
  }, []);

  useEffect(() => {
    if (!activeDiff) return;
    const unsub = listen<any[]>("git:live-diff", ({ payload }) => {
      const f = payload.find((f: any) => f.path === activeDiff.path);
      if (!f) return;
      setActiveDiff(prev => prev ? { ...prev, diff: f.diff, changeType: f.change_type, insertions: f.insertions, deletions: f.deletions } : null);
    });
    return () => { unsub.then(fn => fn()); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDiff?.path]);

  useEffect(() => {
    const unsub = listen<string>("browser-open-url", ({ payload }) => {
      const url = payload.trim();
      if (!url.startsWith("http") && !url.startsWith("file://")) return;
      const isLocal = url.startsWith("file://") || url.includes("localhost") || url.includes("127.0.0.1") || url.includes("0.0.0.0");
      if (!isLocal) { window.open(url, "_blank"); return; }
      setWins(prev => {
        const existing = prev.find(w => w.kind === "browser");
        if (existing) {
          setPendingBrowserUrl(p => ({ ...p, [existing.id]: url }));
          setActiveWinId(existing.id);
          return prev.map(w => w.id === existing.id ? { ...w, zIndex: nextZ() } : w);
        }
        const area = areaRef.current;
        const id = crypto.randomUUID();
        setPendingBrowserUrl(p => ({ ...p, [id]: url }));
        setActiveWinId(id);
        return [...prev, { id, label: "browser", kind: "browser" as const, x: GAP, y: GAP, w: area ? area.offsetWidth - GAP * 2 : 800, h: area ? area.offsetHeight - GAP * 2 : 600, minimized: false, maximized: false, cwd: runbox.cwd, zIndex: nextZ() }];
      });
    });
    return () => { unsub.then(f => f()); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runbox.id]);

  const addTerminal = useCallback(() => {
    const area = areaRef.current; if (!area) return;
    const aw = area.offsetWidth, ah = area.offsetHeight;
    labelCount.current += 1;
    const id = crypto.randomUUID();
    setWins(prev => {
      const all: WinState[] = [...prev, { id, label: `w${labelCount.current}`, kind: "terminal", x: 0, y: 0, w: 400, h: 300, minimized: false, maximized: false, cwd: runbox.cwd, zIndex: nextZ() }];
      const visible = all.filter(w => !w.minimized && !w.maximized);
      const tiles = tileWindows(visible.length, aw, ah);
      let ti = 0;
      return all.map(w => w.minimized || w.maximized ? w : { ...w, ...tiles[ti++] });
    });
    setActiveWinId(id);
  }, [runbox.cwd]);

  const closeWin = useCallback((id: string) => {
    const area = areaRef.current;
    setWins(prev => {
      const next = prev.filter(w => w.id !== id);
      if (next.length === 0) { labelCount.current = 0; return next; }
      if (area) {
        const aw = area.offsetWidth, ah = area.offsetHeight;
        const visible = next.filter(w => !w.minimized && !w.maximized);
        const tiles = tileWindows(visible.length, aw, ah);
        let ti = 0;
        return next.map(w => w.minimized || w.maximized ? w : { ...w, ...tiles[ti++] });
      }
      return next;
    });
    setActiveWinId(prev => {
      if (prev !== id) return prev;
      setWins(cur => {
        const remaining = cur.filter(w => !w.minimized);
        if (remaining.length > 0) { const next = remaining[remaining.length - 1]; setTimeout(() => setActiveWinId(next.id), 0); }
        return cur;
      });
      return null;
    });
  }, []);

  const minimizeWin = useCallback((id: string) => {
    setWins(prev => prev.map(w => {
      if (w.id !== id) return w;
      if (w.maximized) return { ...w, maximized: false, x: w.preMaxX ?? GAP, y: w.preMaxY ?? GAP, w: w.preMaxW ?? 400, h: w.preMaxH ?? 300 };
      return { ...w, minimized: true };
    }));
    setActiveWinId(prev => prev === id ? null : prev);
  }, []);

  const restoreWin = useCallback((id: string) => {
    setWins(prev => prev.map(w => w.id === id ? { ...w, minimized: false, zIndex: nextZ() } : w));
    setActiveWinId(id);
    setTimeout(() => window.dispatchEvent(new Event("resize")), 100);
  }, []);

  const maximizeWin = useCallback((id: string) => {
    const area = areaRef.current; if (!area) return;
    setWins(prev => prev.map(w => {
      if (w.id !== id) return w;
      if (w.maximized) return { ...w, maximized: false, x: w.preMaxX ?? GAP, y: w.preMaxY ?? GAP, w: w.preMaxW ?? 400, h: w.preMaxH ?? 300 };
      return { ...w, maximized: true, preMaxX: w.x, preMaxY: w.y, preMaxW: w.w, preMaxH: w.h, x: 0, y: 0, w: area.offsetWidth, h: area.offsetHeight, zIndex: nextZ() };
    }));
    setActiveWinId(id);
    setTimeout(() => window.dispatchEvent(new Event("resize")), 200);
  }, []);

  const moveTab = useCallback((id: string, dir: "left" | "right") => {
    setWins(prev => {
      const arr = [...prev];
      const idx = arr.findIndex(w => w.id === id); if (idx < 0) return prev;
      const newIdx = dir === "left" ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= arr.length) return prev;
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      return arr;
    });
  }, []);

  const handleDragStart = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault(); focusWin(id);
    const win = winsRef.current.find(w => w.id === id);
    if (!win || win.maximized) return;
    const startX = e.clientX - win.x, startY = e.clientY - win.y;
    const area = areaRef.current;
    const onMove = (ev: MouseEvent) => {
      setWins(prev => {
        const cur = prev.find(w => w.id === id); if (!cur) return prev;
        const aw = area?.offsetWidth ?? 9999, ah = area?.offsetHeight ?? 9999;
        return prev.map(w => w.id === id ? { ...w, x: Math.max(0, Math.min(aw - cur.w, ev.clientX - startX)), y: Math.max(0, Math.min(ah - cur.h, ev.clientY - startY)) } : w);
      });
    };
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  }, [focusWin]);

  const handleResizeStart = useCallback((e: React.MouseEvent, id: string, dir: string) => {
    e.preventDefault(); focusWin(id);
    const win = winsRef.current.find(w => w.id === id);
    if (!win || win.maximized) return;
    const startX = e.clientX, startY = e.clientY;
    const origX = win.x, origY = win.y, origW = win.w, origH = win.h;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      let nx = origX, ny = origY, nw = origW, nh = origH;
      if (dir.includes("r")) nw = Math.max(MIN_W, origW + dx);
      if (dir.includes("l")) { nw = Math.max(MIN_W, origW - dx); nx = origX + (origW - nw); }
      if (dir.includes("b")) nh = Math.max(MIN_H, origH + dy);
      if (dir.includes("t")) { nh = Math.max(MIN_H, origH - dy); ny = origY + (origH - nh); }
      setWins(prev => prev.map(w => w.id === id ? { ...w, x: nx, y: ny, w: nw, h: nh } : w));
    };
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  }, [focusWin, dispatchResize]);

  const toggleSide = useCallback((panel: NonNullable<SidePanel>) => {
    if (onSidePanelToggle) { onSidePanelToggle(panel); return; }
    if (panel === sidePanel) { setSidePanel(null); setActiveDiff(null); setFilesView("list"); return; }
    setSidePanel(panel);
    if (panel !== "files") { setActiveDiff(null); setFilesView("list"); }
  }, [sidePanel, onSidePanelToggle]);

  useEffect(() => {
    const area = areaRef.current; if (!area) return;
    const t = setTimeout(() => {
      const aw = area.offsetWidth, ah = area.offsetHeight;
      if (!aw || !ah) return;
      setWins(prev => {
        const visible = prev.filter(w => !w.minimized && !w.maximized);
        if (visible.length === 0) return prev;
        const tiles = tileWindows(visible.length, aw, ah);
        let ti = 0;
        return prev.map(w => w.minimized || w.maximized ? w : { ...w, ...tiles[ti++] });
      });
      window.dispatchEvent(new Event("resize"));
    }, 180);
    return () => clearTimeout(t);
  }, [sidePanel]);

  const handleToolbarSidebarToggle = useCallback(() => {
    if (fileTreeOpen) onFileTreeToggle?.();
    onSidebarToggle?.();
  }, [fileTreeOpen, onFileTreeToggle, onSidebarToggle]);

  const handleToolbarFileTreeToggle = useCallback(() => {
    onFileTreeToggle?.();
  }, [onFileTreeToggle]);

  const hasFiles      = fileTabs.length > 0;
  const activeFileTab = fileTabs.find(t => t.id === activeFileId) ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>

      {/* ── Tab bar — FULL WIDTH ── */}
      <div style={{
        display: "flex", alignItems: "center", height: 42, flexShrink: 0,
        background: C.bg1, borderBottom: `1px solid ${C.border}`,
        padding: "0 6px", gap: 3,
        position: "relative", zIndex: 300, userSelect: "none",
      }}>

        {/* Left: brand + toggles */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0, paddingRight: 8, borderRight: `1px solid rgba(255,255,255,.08)`, marginRight: 2 }}>
          <span style={{ fontSize: 22, fontWeight: 400, color: "#ffffff", fontFamily: '"VT323", monospace', letterSpacing: "0.08em", userSelect: "none", paddingLeft: 2, lineHeight: "1" }}>
            Stackbox
          </span>
          <StripIcon title="Toggle Runboxes" active={!sidebarCollapsed && !fileTreeOpen} onClick={handleToolbarSidebarToggle}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/>
            </svg>
          </StripIcon>
          <StripIcon title="Toggle File Tree" active={!sidebarCollapsed && fileTreeOpen} onClick={handleToolbarFileTreeToggle}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
          </StripIcon>
        </div>

        {/* ── Terminal tabs ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 3, overflowX: "auto", minWidth: 0, maxWidth: "55%", scrollbarWidth: "none" }}>
          {wins.map((w, idx) => {
            const isActive   = activeWinId === w.id && !hasFiles;
            const isDragOver = dragOverId === w.id && dragTabId !== w.id;
            const iconColor  = isActive ? "#ffffff" : "rgba(255,255,255,0.65)";

            return (
              <div key={w.id}
                onMouseDown={e => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  const startX = e.clientX;
                  let dragging = false;
                  const onMove = (mv: MouseEvent) => {
                    if (!dragging && Math.abs(mv.clientX - startX) > 6) { dragging = true; dragTabIdRef.current = w.id; setDragTabId(w.id); }
                    if (dragging) {
                      const els = document.querySelectorAll("[data-tab-id]");
                      let found: string | null = null;
                      els.forEach(el => { const rect = el.getBoundingClientRect(); if (mv.clientX >= rect.left && mv.clientX <= rect.right) found = (el as HTMLElement).dataset.tabId ?? null; });
                      dragOverIdRef.current = found; setDragOverId(found);
                    }
                  };
                  const onUp = () => {
                    if (dragging && dragTabIdRef.current && dragOverIdRef.current) {
                      const fromId = dragTabIdRef.current, toId = dragOverIdRef.current;
                      setWins(prev => {
                        const arr = [...prev];
                        const fromIdx = arr.findIndex(x => x.id === fromId), toIdx = arr.findIndex(x => x.id === toId);
                        if (fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx) { const [moved] = arr.splice(fromIdx, 1); arr.splice(toIdx, 0, moved); }
                        return arr;
                      });
                    } else if (!dragging) {
                      setActiveFileId(null);
                      w.minimized ? restoreWin(w.id) : focusWin(w.id);
                    }
                    dragTabIdRef.current = null; dragOverIdRef.current = null; setDragTabId(null); setDragOverId(null);
                    window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp);
                  };
                  window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
                }}
                data-tab-id={w.id}
                onContextMenu={e => { e.preventDefault(); setTabCtx({ x: e.clientX, y: e.clientY, win: w, idx }); }}
                title={w.cwd}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "5px 6px 5px 10px", height: 30, borderRadius: 8,
                  cursor: dragTabId ? "grabbing" : "default", flexShrink: 0,
                  background: activeWinId === w.id && !activeFileId ? C.bg3 : isDragOver ? "rgba(0,229,255,.1)" : "transparent",
                  border: `1px solid ${activeWinId === w.id && !activeFileId ? C.borderMd : isDragOver ? "rgba(0,229,255,.4)" : "transparent"}`,
                  opacity: w.minimized ? 0.55 : dragTabId === w.id ? 0.4 : 1,
                  transition: "all .1s", userSelect: "none",
                }}
                onMouseEnter={e => { if (!(activeWinId === w.id && !activeFileId) && !dragTabId) (e.currentTarget as HTMLElement).style.background = C.bg2; }}
                onMouseLeave={e => { if (!(activeWinId === w.id && !activeFileId) && !isDragOver) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>

                {w.minimized && (
                  <span style={{ width: 5, height: 5, borderRadius: "50%", flexShrink: 0, background: "#fbbf24", boxShadow: "0 0 5px rgba(251,191,36,.6)" }} />
                )}

                {!w.minimized && (w.kind === "browser" ? (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2" style={{ flexShrink: 0 }}>
                    <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                  </svg>
                ) : (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
                  </svg>
                ))}

                <span style={{
                  fontSize: 12, fontFamily: MONO,
                  color: activeWinId === w.id && !activeFileId ? "#ffffff" : w.minimized ? "#fbbf24" : "rgba(255,255,255,0.7)",
                  fontWeight: activeWinId === w.id && !activeFileId ? 600 : 400,
                  maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {winLabel(w)}
                </span>

                <TabCloseBtn onClose={() => closeWin(w.id)} />
              </div>
            );
          })}

          {/* New terminal button */}
          <button onClick={addTerminal} title="New terminal"
            style={{ ...tbtn, width: 30, height: 30, borderRadius: 8, fontSize: 18, fontWeight: 300, border: `1px solid transparent`, flexShrink: 0 }}
            onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.color = C.t0; el.style.background = C.bg3; el.style.borderColor = C.border; }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.color = C.t2; el.style.background = "transparent"; el.style.borderColor = "transparent"; }}>
            +
          </button>
        </div>

        {/* ── Separator + File tabs ── */}
        {fileTabs.length > 0 && (
          <>
            <div style={{ width: 1, height: 20, background: "rgba(255,255,255,.1)", flexShrink: 0, margin: "0 4px" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 3, overflowX: "auto", minWidth: 0, flex: 1, scrollbarWidth: "none" }}>
              {fileTabs.map(tab => {
                const isActive   = activeFileId === tab.id;
                const fileName   = tab.filePath.split(/[/\\]/).pop() ?? tab.filePath;
                const iconStroke = isActive ? "#00e5ff" : fileColor(fileName, false);

                return (
                  <div key={tab.id}
                    onClick={() => setActiveFileId(tab.id)}
                    title={tab.filePath}
                    style={{
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "5px 6px 5px 10px", height: 30, borderRadius: 8,
                      cursor: "pointer", flexShrink: 0,
                      background: isActive ? "rgba(0,229,255,.12)" : "transparent",
                      border: `1px solid ${isActive ? "rgba(0,229,255,.35)" : "transparent"}`,
                      transition: "all .1s", userSelect: "none",
                    }}
                    onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = C.bg2; }}
                    onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>

                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
                      stroke={iconStroke} strokeWidth="2" style={{ flexShrink: 0 }}>
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                    </svg>

                    <span style={{
                      fontSize: 12, fontFamily: MONO,
                      color: isActive ? "#00e5ff" : "rgba(255,255,255,0.7)",
                      fontWeight: isActive ? 600 : 400,
                      maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {fileName}
                    </span>

                    <TabCloseBtn onClose={() => closeFileTab(tab.id)} />
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Drag zone */}
        <div style={{ flex: fileTabs.length > 0 ? 0 : 1, minWidth: 20, height: "100%", cursor: "default" }}
          onMouseDown={e => { if (e.button === 0) getCurrentWindow().startDragging().catch(() => {}); }} />

        {/* Right: toolbar + window controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {toolbarSlot}
          <div style={{ display: "flex", alignItems: "center", gap: 1, marginLeft: 4, paddingLeft: 6, borderLeft: `1px solid rgba(255,255,255,.08)` }}>
            <WinBtn title="Minimize"         hoverBg="rgba(255,255,255,.1)"  hoverColor="#fff"    onClick={() => getCurrentWindow().minimize().catch(() => {})}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="4" y1="12" x2="20" y2="12"/></svg>
            </WinBtn>
            <WinBtn title="Maximize/Restore" hoverBg="rgba(255,255,255,.1)"  hoverColor="#fff"    onClick={() => getCurrentWindow().toggleMaximize().catch(() => {})}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
            </WinBtn>
            <WinBtn title="Close"            hoverBg="rgba(239,68,68,.25)" hoverColor="#f87171" onClick={() => getCurrentWindow().close().catch(() => {})}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="4" y1="4" x2="20" y2="20"/><line x1="20" y1="4" x2="4" y2="20"/></svg>
            </WinBtn>
          </div>
        </div>
      </div>

      {/* ── Content area ── */}
      <div style={{
        flex: 1, minHeight: 0, display: "flex",
        marginLeft: contentMarginLeft,
        transition: "margin-left .18s cubic-bezier(.4,0,.2,1)",
      }}>

        {/* Main content */}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", position: "relative" }}>

          {activeFileTab && (
            <div style={{ position: "absolute", inset: 0, zIndex: 10, background: C.bg0, display: "flex", flexDirection: "column" }}>
              <FileEditorPane path={activeFileTab.filePath} onClose={() => closeFileTab(activeFileTab.id)} />
            </div>
          )}

          <div
            ref={areaRef}
            style={{
              flex: 1, minWidth: 0, minHeight: 0,
              position: "relative", background: C.bg0, overflow: "hidden",
              opacity: activeFileTab ? 0 : 1,
              pointerEvents: activeFileTab ? "none" : "auto",
              transition: "opacity .1s",
            }}>
            {wins.map(win => (
              win.kind === "browser" ? (
                <div key={win.id} style={{ position: "absolute", left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.zIndex, display: win.minimized ? "none" : "block", transition: win.maximized ? "left .18s ease, top .18s ease, width .18s ease, height .18s ease" : "none" }}>
                  <BrowsePane paneId={win.id} runboxId={runbox.id} isActive={activeWinId === win.id} onActivate={() => focusWin(win.id)} onClose={() => closeWin(win.id)} externalUrl={pendingBrowserUrl[win.id] ?? null} onExternalUrlConsumed={() => setPendingBrowserUrl(p => ({ ...p, [win.id]: null }))} />
                </div>
              ) : (
                <div key={win.id} style={{ position: "absolute", left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.zIndex, display: win.minimized ? "none" : "block", transition: win.maximized ? "left .18s ease, top .18s ease, width .18s ease, height .18s ease" : "none" }}>
                  <RunPane runboxCwd={runbox.cwd} runboxId={runbox.id} runboxName={runbox.name} sessionId={`${runbox.id}-${win.id}`} label={win.label}
                    onCwdChange={cwd => { setWins(prev => prev.map(w => w.id === win.id ? { ...w, cwd } : w)); if (activeWinId === win.id) onCwdChange(cwd); }}
                    isActive={activeWinId === win.id && !activeFileTab} onActivate={() => { setActiveFileId(null); focusWin(win.id); }} onSessionChange={sid => onSessionChange?.(sid)}
                    onClose={() => closeWin(win.id)} onMinimize={() => minimizeWin(win.id)} onMaximize={() => maximizeWin(win.id)}
                    onDragStart={(e: React.MouseEvent) => handleDragStart(e, win.id)} onResizeStart={(e: React.MouseEvent, dir: string) => handleResizeStart(e, win.id, dir)}
                    onSplitDown={() => {
                      const area = areaRef.current; if (!area) return;
                      setWins(prev => {
                        const src = prev.find(w => w.id === win.id); if (!src) return prev;
                        const halfH = Math.max(MIN_H, Math.floor((src.h - GAP) / 2));
                        const newId = crypto.randomUUID();
                        labelCount.current += 1;
                        const newWin: WinState = { ...src, id: newId, label: `w${labelCount.current}`, y: src.y + halfH + GAP, h: src.h - halfH - GAP, zIndex: nextZ(), minimized: false, maximized: false };
                        setActiveWinId(newId);
                        return [...prev.map(w => w.id === win.id ? { ...w, h: halfH } : w), newWin];
                      });
                    }}
                    onSplitLeft={() => {
                      const area = areaRef.current; if (!area) return;
                      setWins(prev => {
                        const src = prev.find(w => w.id === win.id); if (!src) return prev;
                        const halfW = Math.max(MIN_W, Math.floor((src.w - GAP) / 2));
                        const newId = crypto.randomUUID();
                        labelCount.current += 1;
                        const newWin: WinState = { ...src, id: newId, label: `w${labelCount.current}`, x: src.x + halfW + GAP, w: src.w - halfW - GAP, zIndex: nextZ(), minimized: false, maximized: false };
                        setActiveWinId(newId);
                        return [...prev.map(w => w.id === win.id ? { ...w, w: halfW } : w), newWin];
                      });
                    }}
                  />
                </div>
              )
            ))}
          </div>
        </div>

        {/* Side panel: Files */}
        {sidePanel === "files" && (
          <div style={{ width: panelWidth, flexShrink: 0, display: "flex", alignItems: "stretch", borderLeft: `1px solid ${C.border}`, animation: "slideIn .14s ease-out" }}>
            <PanelResizeHandle onResize={setPanelWidth} />
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: filesView === "diff" ? C.bg0 : C.bg1, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden", margin: "8px 8px 8px 4px", boxShadow: "0 4px 24px rgba(0,0,0,.45)" }}>
              {filesView === "list" && (
                <>
                  <PanelHeader title="Changed Files" icon={<IcoFiles on />} onClose={() => { onSidePanelToggle?.("files"); setActiveDiff(null); setFilesView("list"); }} />
                  <div style={{ flex: 1, overflow: "auto" }}>
                    <FileChangeList runboxId={runbox.id} runboxCwd={runbox.cwd} onFileClick={fc => { setActiveDiff({ id: `diff-${fc.path}`, path: fc.path, diff: fc.diff, changeType: fc.change_type, insertions: fc.insertions, deletions: fc.deletions, openedAt: Date.now() }); setFilesView("diff"); }} />
                  </div>
                </>
              )}
              {filesView === "diff" && activeDiff && <DiffViewer tab={activeDiff} onClose={() => { setActiveDiff(null); setFilesView("list"); }} />}
            </div>
          </div>
        )}

        {/* Side panel: Git / Memory */}
        {sidePanel && sidePanel !== "files" && (
          <div style={{ width: panelWidth, flexShrink: 0, display: "flex", alignItems: "stretch", borderLeft: `1px solid ${C.border}`, animation: "slideIn .14s ease-out" }}>
            <PanelResizeHandle onResize={setPanelWidth} />
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden", margin: "8px 8px 8px 4px", boxShadow: "0 4px 24px rgba(0,0,0,.45)" }}>
              {sidePanel === "git"    && <GitWorktreePanel runboxCwd={runbox.cwd} runboxId={runbox.id} branch={branch} onClose={() => onSidePanelToggle?.("git")} />}
              {sidePanel === "memory" && <MemoryPanel runboxId={runbox.id} runboxName={runbox.name} onClose={() => onSidePanelToggle?.("memory")} />}
            </div>
          </div>
        )}
      </div>

      {tabCtx && (
        <TabContextMenu x={tabCtx.x} y={tabCtx.y} win={tabCtx.win} isFirst={tabCtx.idx === 0} isLast={tabCtx.idx === wins.length - 1}
          onClose={() => setTabCtx(null)} onCloseTab={() => closeWin(tabCtx.win.id)}
          onRestore={tabCtx.win.minimized ? () => restoreWin(tabCtx.win.id) : undefined}
          onMoveLeft={() => moveTab(tabCtx.win.id, "left")} onMoveRight={() => moveTab(tabCtx.win.id, "right")} />
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=VT323&display=swap');
        @keyframes slideIn     { from { opacity:0; transform:translateX(10px);  } to { opacity:1; transform:translateX(0); } }
        @keyframes slideInLeft { from { opacity:0; transform:translateX(-10px); } to { opacity:1; transform:translateX(0); } }
        @keyframes sp { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}