// features/workspace/WorkspaceView.tsx
import { useState, useRef, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { C, SANS, MONO } from "../../design";
import { PanelHeader, ResizeHandle } from "../../ui";
import type { Runbox } from "../../types";
import { TabBar }         from "./TabBar";
import { TabContextMenu } from "./TabContextMenu";
import {
  GAP, MIN_W, MIN_H, nextZ, tileWindows,
  type WinState, type FileTab, type SidePanel, type FilesView,
} from "./types";



const isMac = navigator.userAgent.toLowerCase().includes("mac");

interface WorkspaceViewProps {
  runbox:             Runbox;
  branch:             string;
  toolbarSlot?:       React.ReactNode;
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
  /** Render slot for the floating browser panel overlay */
  browserPanelSlot?:  React.ReactNode;
  /** Render slot for terminal pane (receives win geometry + callbacks) */
  renderTermPane:     (win: WinState, callbacks: TermPaneCallbacks) => React.ReactNode;
  /** Render slot for browser pane */
  renderBrowsePane:   (win: WinState, pendingUrl: string | null, onConsumed: () => void) => React.ReactNode;
  /** Render file editor */
  renderFileEditor:   (tab: FileTab, onClose: () => void) => React.ReactNode;
  /** Render side panels */
  renderSidePanel:    (panel: SidePanel, runbox: Runbox, branch: string, onClose: () => void) => React.ReactNode;
}

export interface TermPaneCallbacks {
  isActive:        boolean;
  onActivate:      () => void;
  onCwdChange:     (cwd: string) => void;
  onSessionChange: (sid: string) => void;
  onClose:         () => void;
  onMinimize:      () => void;
  onMaximize:      () => void;
  onDragStart:     (e: React.MouseEvent) => void;
  onResizeStart:   (e: React.MouseEvent, dir: string) => void;
  onSplitDown:     () => void;
  onSplitLeft:     () => void;
}

export function WorkspaceView({
  runbox, branch, toolbarSlot,
  sidePanel: sidePanelProp,
  sidebarCollapsed = false, fileTreeOpen = false,
  contentMarginLeft = 0,
  onSidePanelToggle, onSidebarToggle, onFileTreeToggle,
  onCwdChange, onSessionChange, onOpenDiff, onOpenFile,
  renderTermPane, renderBrowsePane, renderFileEditor, renderSidePanel,
}: WorkspaceViewProps) {
  const areaRef    = useRef<HTMLDivElement>(null);
  const labelCount = useRef(0);
  const initialized = useRef(false);
  const resizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const winsRef     = useRef<WinState[]>([]);

  const [wins,        setWins]        = useState<WinState[]>([]);
  const [activeWinId, setActiveWinId] = useState<string | null>(null);
  const [fileTabs,     setFileTabs]     = useState<FileTab[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);

  const [_sidePanel, _setSidePanel] = useState<SidePanel>(null);
  const sidePanel    = sidePanelProp !== undefined ? sidePanelProp : _sidePanel;
  const [filesView,  setFilesView]  = useState<FilesView>("list");
  const [activeDiff, setActiveDiff] = useState<any | null>(null);
  const [panelWidth, setPanelWidth] = useState(450);
  const [tabCtx,     setTabCtx]     = useState<{ x: number; y: number; win: WinState; idx: number } | null>(null);
  const [pendingBrowserUrl, setPendingBrowserUrl] = useState<Record<string, string | null>>({});
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => { winsRef.current = wins; }, [wins]);

  const dispatchResize = useCallback(() => {
    if (resizeTimer.current) clearTimeout(resizeTimer.current);
    resizeTimer.current = setTimeout(() => window.dispatchEvent(new Event("resize")), 80);
  }, []);

  // Mac fullscreen
  useEffect(() => {
    if (!isMac) return;
    getCurrentWindow().isFullscreen().then(setIsFullscreen).catch(() => {});
    const unsub = getCurrentWindow().onResized(async () => {
      try { setIsFullscreen(await getCurrentWindow().isFullscreen()); } catch {}
    });
    return () => { unsub.then(f => f()).catch(() => {}); };
  }, []);

  // Initialize first window
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

  // Resize observer — retile single visible window
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

  // Wire onOpenDiff
  useEffect(() => {
    onOpenDiff({ open: (fc: any) => {
      setActiveDiff({ id: `diff-${fc.path}`, path: fc.path, diff: fc.diff, changeType: fc.change_type, insertions: fc.insertions, deletions: fc.deletions, openedAt: Date.now() });
      _setSidePanel("files"); setFilesView("diff");
    }});
  }, [onOpenDiff]);

  const focusWin = useCallback((id: string) => {
    setActiveWinId(id);
    setWins(prev => prev.map(w => w.id === id ? { ...w, zIndex: nextZ() } : w));
  }, []);

  // Wire onOpenFile
  const openFileWin = useCallback((filePath: string) => {
    setFileTabs(prev => {
      const existing = prev.find(t => t.filePath === filePath);
      if (existing) { setActiveFileId(existing.id); return prev; }
      const id = crypto.randomUUID();
      setActiveFileId(id);
      return [...prev, { id, filePath }];
    });
  }, []);

  useEffect(() => { onOpenFile?.({ open: openFileWin }); }, [onOpenFile, openFileWin]);

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

  // Listen for browser-open-url events
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
        const id   = crypto.randomUUID();
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
      const tiles   = tileWindows(visible.length, aw, ah);
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
        const tiles   = tileWindows(visible.length, aw, ah);
        let ti = 0;
        return next.map(w => w.minimized || w.maximized ? w : { ...w, ...tiles[ti++] });
      }
      return next;
    });
    setActiveWinId(prev => {
      if (prev !== id) return prev;
      const remaining = winsRef.current.filter(w => !w.minimized && w.id !== id);
      if (remaining.length > 0) setTimeout(() => setActiveWinId(remaining[remaining.length - 1].id), 0);
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
    const areaRect = areaRef.current?.getBoundingClientRect();
    if (!areaRect) return;
    const offX = (e.clientX - areaRect.left) - win.x;
    const offY = (e.clientY - areaRect.top)  - win.y;
    const onMove = (ev: MouseEvent) => {
      const rect = areaRef.current?.getBoundingClientRect();
      if (!rect) return;
      setWins(prev => {
        const cur = prev.find(w => w.id === id); if (!cur) return prev;
        const nx = Math.max(0, Math.min(rect.width  - cur.w, (ev.clientX - rect.left) - offX));
        const ny = Math.max(0, Math.min(rect.height - cur.h, (ev.clientY - rect.top)  - offY));
        return prev.map(w => w.id === id ? { ...w, x: nx, y: ny } : w);
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
      const area = areaRef.current;
      const aw = area?.getBoundingClientRect().width  ?? 9999;
      const ah = area?.getBoundingClientRect().height ?? 9999;
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      let nx = origX, ny = origY, nw = origW, nh = origH;
      if (dir.includes("r")) nw = Math.min(aw - origX, Math.max(MIN_W, origW + dx));
      if (dir.includes("l")) { nw = Math.max(MIN_W, origW - dx); nx = origX + (origW - nw); if (nx < 0) { nw += nx; nx = 0; } }
      if (dir.includes("b")) nh = Math.min(ah - origY, Math.max(MIN_H, origH + dy));
      if (dir.includes("t")) { nh = Math.max(MIN_H, origH - dy); ny = origY + (origH - nh); if (ny < 0) { nh += ny; ny = 0; } }
      setWins(prev => prev.map(w => w.id === id ? { ...w, x: nx, y: ny, w: nw, h: nh } : w));
    };
    const onUp = () => {
      window.dispatchEvent(new Event("resize"));
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  }, [focusWin, dispatchResize]);

  // Re-tile on side panel / sidebar changes
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
    }, 220);
    return () => clearTimeout(t);
  }, [sidePanel, contentMarginLeft]);

  const splitWin = useCallback((id: string, dir: "down" | "left") => {
    setWins(prev => {
      const src = prev.find(w => w.id === id); if (!src) return prev;
      const newId = crypto.randomUUID();
      labelCount.current += 1;
      let updated: WinState, newWin: WinState;
      if (dir === "down") {
        const halfH = Math.max(MIN_H, Math.floor((src.h - GAP) / 2));
        updated = { ...src, h: halfH };
        newWin  = { ...src, id: newId, label: `w${labelCount.current}`, y: src.y + halfH + GAP, h: src.h - halfH - GAP, zIndex: nextZ(), minimized: false, maximized: false };
      } else {
        const halfW = Math.max(MIN_W, Math.floor((src.w - GAP) / 2));
        updated = { ...src, w: halfW };
        newWin  = { ...src, id: newId, label: `w${labelCount.current}`, x: src.x + halfW + GAP, w: src.w - halfW - GAP, zIndex: nextZ(), minimized: false, maximized: false };
      }
      setActiveWinId(newId);
      return [...prev.map(w => w.id === id ? updated : w), newWin];
    });
  }, []);

  const reorderWins = useCallback((fromId: string, toId: string) => {
    setWins(prev => {
      const arr = [...prev];
      const fromIdx = arr.findIndex(w => w.id === fromId);
      const toIdx   = arr.findIndex(w => w.id === toId);
      if (fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx) {
        const [moved] = arr.splice(fromIdx, 1);
        arr.splice(toIdx, 0, moved);
      }
      return arr;
    });
  }, []);

  const macOffset    = isMac && !isFullscreen;
  const hasFiles     = fileTabs.length > 0;
  const activeFileTab = fileTabs.find(t => t.id === activeFileId) ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
      <TabBar
        wins={wins}
        fileTabs={fileTabs}
        activeWinId={activeWinId}
        activeFileId={activeFileId}
        sidebarCollapsed={sidebarCollapsed}
        fileTreeOpen={fileTreeOpen}
        macOffset={macOffset}
        toolbarSlot={toolbarSlot}
        onWinActivate={id => { setActiveFileId(null); focusWin(id); }}
        onWinClose={closeWin}
        onWinRestore={restoreWin}
        onAddTerminal={addTerminal}
        onFileSelect={id => setActiveFileId(id)}
        onFileClose={closeFileTab}
        onReorderWins={reorderWins}
        onContextMenu={(e, win, idx) => setTabCtx({ x: e.clientX, y: e.clientY, win, idx })}
        onSidebarToggle={() => onSidebarToggle?.()}
        onFileTreeToggle={() => onFileTreeToggle?.()}
      />

      <div style={{
        flex: 1, minHeight: 0, display: "flex", overflow: "hidden",
        marginLeft: contentMarginLeft,
        transition: "margin-left .18s cubic-bezier(.4,0,.2,1)",
      }}>
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
          {/* File editor overlay */}
          {activeFileTab && (
            <div style={{ position: "absolute", inset: 0, zIndex: 10, background: C.bg0, display: "flex", flexDirection: "column" }}>
              {renderFileEditor(activeFileTab, () => closeFileTab(activeFileTab.id))}
            </div>
          )}

          {/* Window canvas */}
          <div ref={areaRef} style={{
            flex: 1, minWidth: 0, minHeight: 0,
            position: "relative", background: C.bg0,
            overflow: "hidden", height: "100%",
            opacity: activeFileTab ? 0 : 1,
            pointerEvents: activeFileTab ? "none" : "auto",
            transition: "opacity .1s",
          }}>
            {wins.length === 0 && (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, userSelect: "none", pointerEvents: "none" }}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.55)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
                </svg>
                <span style={{ fontSize: 18, letterSpacing: "0.06em", color: "rgba(255,255,255,.5)", fontFamily: SANS, fontWeight: 700 }}>Stackbox</span>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, marginTop: 4 }}>
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,.38)", fontFamily: SANS }}>
                    Press <span style={{ fontFamily: MONO, fontSize: 11, background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.2)", borderRadius: 4, padding: "1px 8px", color: "rgba(255,255,255,.6)" }}>+</span> to open a terminal
                  </span>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,.25)", fontFamily: SANS }}>Split · resize · arrange freely</span>
                </div>
              </div>
            )}

            {wins.map(win => (
              <div key={win.id} style={{
                position: "absolute", left: win.x, top: win.y, width: win.w, height: win.h,
                zIndex: win.zIndex,
                display: win.minimized ? "none" : "flex",
                flexDirection: "column", overflow: "hidden",
                transition: win.maximized ? "left .18s ease, top .18s ease, width .18s ease, height .18s ease" : "none",
              }}>
                {win.kind === "browser"
                  ? renderBrowsePane(win, pendingBrowserUrl[win.id] ?? null, () => setPendingBrowserUrl(p => ({ ...p, [win.id]: null })))
                  : renderTermPane(win, {
                      isActive:    activeWinId === win.id && !activeFileTab,
                      onActivate:  () => { setActiveFileId(null); focusWin(win.id); },
                      onCwdChange: cwd => {
                        setWins(prev => prev.map(w => w.id === win.id ? { ...w, cwd } : w));
                        if (activeWinId === win.id) onCwdChange(cwd);
                      },
                      onSessionChange: sid => onSessionChange?.(sid),
                      onClose:     () => closeWin(win.id),
                      onMinimize:  () => minimizeWin(win.id),
                      onMaximize:  () => maximizeWin(win.id),
                      onDragStart: e => handleDragStart(e, win.id),
                      onResizeStart: (e, dir) => handleResizeStart(e, win.id, dir),
                      onSplitDown: () => splitWin(win.id, "down"),
                      onSplitLeft: () => splitWin(win.id, "left"),
                    })
                }
              </div>
            ))}
          </div>
        </div>

        {/* Side panels */}
        {sidePanel && (
          <div style={{ width: panelWidth, flexShrink: 0, display: "flex", alignItems: "stretch", borderLeft: `1px solid ${C.border}`, animation: "slideIn .14s ease-out" }}>
            <ResizeHandle onResize={w => setPanelWidth(w)} />
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden", margin: "8px 8px 8px 4px", boxShadow: "0 4px 24px rgba(0,0,0,.45)" }}>
              {renderSidePanel(sidePanel, runbox, branch, () => onSidePanelToggle?.(sidePanel as any))}
            </div>
          </div>
        )}
      </div>

      {tabCtx && (
        <TabContextMenu
          x={tabCtx.x} y={tabCtx.y} win={tabCtx.win}
          isFirst={tabCtx.idx === 0} isLast={tabCtx.idx === wins.length - 1}
          onClose={() => setTabCtx(null)}
          onCloseTab={() => closeWin(tabCtx.win.id)}
          onRestore={tabCtx.win.minimized ? () => restoreWin(tabCtx.win.id) : undefined}
          onMoveLeft={() => moveTab(tabCtx.win.id, "left")}
          onMoveRight={() => moveTab(tabCtx.win.id, "right")}
        />
      )}

      <style>{`
        @keyframes slideIn { from { opacity:0; transform:translateX(10px); } to { opacity:1; transform:translateX(0); } }
        @keyframes sp { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}