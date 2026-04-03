// features/browser/BrowserPanel.tsx
// Floating picture-in-picture preview overlay.
// Draggable, resizable, pinnable. Auto-closes after 30s unless pinned.
import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BrowsePane } from "./BrowsePane";
import { C, SANS, MONO } from "../../design";

let _bseq = 0;
interface PreviewTab { id: string; url: string; }
const mkTab = (url: string): PreviewTab => ({ id: `bp${++_bseq}`, url });

function restoreUrl(runboxId?: string): string {
  if (!runboxId) return "http://localhost:3000";
  try { return localStorage.getItem(`sbx-browser-url-${runboxId}`) || "http://localhost:3000"; }
  catch { return "http://localhost:3000"; }
}

function portFromUrl(url: string) {
  try { return new URL(url).port || "80"; } catch { return "?"; }
}

const DEFAULT_W = 460;
const DEFAULT_H = 320;

export interface BrowserPanelProps {
  open:                 boolean;
  pendingUrl:           string | null;
  pinned:               boolean;
  onPinnedChange:       (p: boolean) => void;
  onPendingUrlConsumed: () => void;
  onClose:              () => void;
  runboxId?:            string;
}

export function BrowserPanel({
  open, pendingUrl, pinned, onPinnedChange,
  onPendingUrlConsumed, onClose, runboxId,
}: BrowserPanelProps) {
  const [tabs,       setTabs]       = useState<PreviewTab[]>(() => [mkTab(restoreUrl(runboxId))]);
  const [activeTab,  setActiveTab]  = useState(() => tabs[0].id);
  const [mountedIds, setMountedIds] = useState<Set<string>>(() => new Set([tabs[0].id]));
  const [pos,  setPos]  = useState(() => ({
    x: window.innerWidth  - DEFAULT_W - 16,
    y: window.innerHeight - DEFAULT_H - 16,
  }));
  const [size, setSize] = useState({ w: DEFAULT_W, h: DEFAULT_H });

  const dragging    = useRef(false);
  const dragOffset  = useRef({ x: 0, y: 0 });
  const resizing    = useRef(false);
  const resizeStart = useRef({ mx: 0, my: 0, w: 0, h: 0 });
  const autoTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetAutoClose = useCallback(() => {
    if (autoTimer.current) clearTimeout(autoTimer.current);
    if (!pinned) autoTimer.current = setTimeout(() => onClose(), 30_000);
  }, [pinned, onClose]);

  useEffect(() => {
    if (open && !pinned) resetAutoClose();
    return () => { if (autoTimer.current) clearTimeout(autoTimer.current); };
  }, [open, pinned, resetAutoClose]);

  // Clamp on window resize
  useEffect(() => {
    const onResize = () => setPos(p => ({
      x: Math.min(p.x, window.innerWidth  - size.w - 4),
      y: Math.min(p.y, window.innerHeight - size.h - 4),
    }));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [size.w, size.h]);

  // Sync tab url when pending
  useEffect(() => {
    if (!pendingUrl) return;
    setTabs(p => p.map(t => t.id === activeTab ? { ...t, url: pendingUrl } : t));
    if (runboxId) try { localStorage.setItem(`sbx-browser-url-${runboxId}`, pendingUrl); } catch {}
    resetAutoClose();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingUrl]);

  // Lazy-mount tabs
  useEffect(() => {
    setMountedIds(p => {
      if (p.has(activeTab)) return p;
      return new Set([...p, activeTab]);
    });
  }, [activeTab]);

  // ── Drag ──────────────────────────────────────────────────────────────────
  const onDragStart = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    dragging.current = true;
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      setPos({
        x: Math.max(0, Math.min(ev.clientX - dragOffset.current.x, window.innerWidth  - size.w)),
        y: Math.max(0, Math.min(ev.clientY - dragOffset.current.y, window.innerHeight - size.h)),
      });
    };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    resetAutoClose();
  };

  // ── Resize ────────────────────────────────────────────────────────────────
  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    resizing.current = true;
    resizeStart.current = { mx: e.clientX, my: e.clientY, w: size.w, h: size.h };
    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      setSize({
        w: Math.max(280, resizeStart.current.w + ev.clientX - resizeStart.current.mx),
        h: Math.max(200, resizeStart.current.h + ev.clientY - resizeStart.current.my),
      });
    };
    const onUp = () => {
      resizing.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
  };

  const closeTab = (id: string) => {
    setTabs(p => {
      if (p.length === 1) { onClose(); return p; }
      const idx = p.findIndex(t => t.id === id);
      const n   = p.filter(t => t.id !== id);
      setActiveTab(a => a === id ? (n[Math.max(0, idx - 1)]?.id ?? n[0].id) : a);
      setMountedIds(m => { const s = new Set(m); s.delete(id); return s; });
      invoke("browser_destroy", { id }).catch(() => {});
      return n;
    });
  };

  if (!open) return null;

  const activeUrl = tabs.find(t => t.id === activeTab)?.url ?? "";

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 50 }}>
      <div
        onMouseEnter={resetAutoClose}
        style={{
          position: "absolute",
          left: pos.x, top: pos.y,
          width: size.w, height: size.h,
          pointerEvents: "auto",
          display: "flex", flexDirection: "column",
          background: C.bg1, borderRadius: C.r4,
          border: `1px solid ${C.border}`,
          boxShadow: `${C.shadowLg}, 0 0 0 1px rgba(255,255,255,.04)`,
          overflow: "hidden",
          animation: "floatIn .18s cubic-bezier(.2,.8,.2,1)",
        }}
      >
        {/* Title bar / drag handle */}
        <div
          onMouseDown={onDragStart}
          style={{
            height: 34, flexShrink: 0,
            display: "flex", alignItems: "center",
            padding: "0 10px", gap: 8,
            background: C.bg2, borderBottom: `1px solid ${C.border}`,
            cursor: "grab", userSelect: "none",
          }}
        >
          <div style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
            background: "#5a9a5a", boxShadow: "0 0 5px #5a9a5a",
            animation: "pulse 2.4s ease-in-out infinite" }} />

          <span style={{ fontSize: 11, fontFamily: SANS, fontWeight: 500, color: C.t2, flex: 1 }}>
            Preview
            <span style={{ marginLeft: 6, fontSize: 10, fontFamily: MONO, color: C.t3 }}>
              :{portFromUrl(activeUrl)}
            </span>
          </span>

          <button
            onClick={() => {
              onPinnedChange(!pinned);
              if (!pinned && autoTimer.current) clearTimeout(autoTimer.current);
            }}
            title={pinned ? "Unpin (auto-close)" : "Pin (keep open)"}
            style={{
              background: pinned ? "rgba(255,255,255,.08)" : "none",
              border: pinned ? `1px solid ${C.borderMd}` : "1px solid transparent",
              cursor: "pointer", color: pinned ? C.t1 : C.t3,
              fontSize: 11, padding: "2px 7px", borderRadius: C.r2,
              fontFamily: SANS, transition: C.shadow,
            }}
          >
            {pinned ? "📌 pinned" : "pin"}
          </button>

          <button onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer",
              color: C.t3, fontSize: 15, padding: "2px 4px", borderRadius: 4, lineHeight: 1 }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.red}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.t3}>
            ×
          </button>
        </div>

        {/* Preview area */}
        <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
          {tabs.map(tab => {
            if (!mountedIds.has(tab.id)) return null;
            return (
              <div key={tab.id} style={{
                position: "absolute", inset: 0,
                visibility:    tab.id === activeTab ? "visible" : "hidden",
                pointerEvents: tab.id === activeTab ? "auto"    : "none",
              }}>
                <BrowsePane
                  paneId={tab.id}
                  runboxId={runboxId}
                  isActive={tab.id === activeTab}
                  onActivate={() => { setActiveTab(tab.id); resetAutoClose(); }}
                  onClose={closeTab}
                  externalUrl={tab.id === activeTab ? pendingUrl : null}
                  onExternalUrlConsumed={onPendingUrlConsumed}
                  onUrlChange={url => {
                    setTabs(p => p.map(t => t.id === tab.id ? { ...t, url } : t));
                    if (runboxId && (url.includes("localhost") || url.includes("127.0.0.1"))) {
                      try { localStorage.setItem(`sbx-browser-url-${runboxId}`, url); } catch {}
                    }
                    resetAutoClose();
                  }}
                />
              </div>
            );
          })}
        </div>

        {/* Resize handle (bottom-right) */}
        <div
          onMouseDown={onResizeStart}
          style={{ position: "absolute", bottom: 0, right: 0, width: 16, height: 16,
            cursor: "nwse-resize", zIndex: 10 }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10"
            style={{ position: "absolute", bottom: 3, right: 3, opacity: .25 }}>
            <path d="M9 1L1 9M9 5L5 9M9 9" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>
      </div>

      <style>{`
        @keyframes floatIn {
          from { opacity:0; transform:scale(.94) translateY(8px); }
          to   { opacity:1; transform:scale(1)   translateY(0); }
        }
        @keyframes pulse {
          0%,100% { opacity:1; }
          50%      { opacity:.4; }
        }
      `}</style>
    </div>
  );
}