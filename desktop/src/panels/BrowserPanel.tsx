// src/panels/BrowserPanel.tsx
// Floating picture-in-picture preview overlay.
// Appears over the terminal — never pushes layout.
// Draggable, resizable, pinnable. Auto-closes after 30s unless pinned.

import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import BrowsePane from "../core/BrowsePane";
import { SANS } from "../shared/constants";

let _bseq = 0;
interface PreviewTab { id: string; url: string; }
const mkTab = (url: string): PreviewTab => ({ id: `bp${++_bseq}`, url });

function restoreUrl(runboxId?: string): string {
  if (!runboxId) return "http://localhost:3000";
  try { return localStorage.getItem(`sbx-browser-url-${runboxId}`) || "http://localhost:3000"; }
  catch { return "http://localhost:3000"; }
}

interface BrowserPanelProps {
  open:                  boolean;
  pendingUrl:            string | null;
  pinned:                boolean;
  onPinnedChange:        (p: boolean) => void;
  onPendingUrlConsumed:  () => void;
  onClose:               () => void;
  runboxId?:             string;
}

const DEFAULT_W = 460;
const DEFAULT_H = 320;

export function BrowserPanel({
  open, pendingUrl, pinned, onPinnedChange,
  onPendingUrlConsumed, onClose, runboxId,
}: BrowserPanelProps) {
  const [tabs,       setTabs]       = useState<PreviewTab[]>(() => [mkTab(restoreUrl(runboxId))]);
  const [activeTab,  setActiveTab]  = useState(() => tabs[0].id);
  const [mountedIds, setMountedIds] = useState<Set<string>>(() => new Set([tabs[0].id]));

  // ── FIX: initialize position directly from window — no sentinel, no deadlock
  const [pos,  setPos]  = useState(() => ({
    x: window.innerWidth  - DEFAULT_W - 16,
    y: window.innerHeight - DEFAULT_H - 16,
  }));
  const [size, setSize] = useState({ w: DEFAULT_W, h: DEFAULT_H });

  const dragging    = useRef(false);
  const dragOffset  = useRef({ x: 0, y: 0 });
  const resizing    = useRef(false);
  const resizeStart = useRef({ mx: 0, my: 0, w: 0, h: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-close timer (30s unless pinned)
  const autoCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetAutoClose = useCallback(() => {
    if (autoCloseTimer.current) clearTimeout(autoCloseTimer.current);
    if (!pinned) {
      autoCloseTimer.current = setTimeout(() => onClose(), 30_000);
    }
  }, [pinned, onClose]);

  useEffect(() => {
    if (open && !pinned) resetAutoClose();
    return () => { if (autoCloseTimer.current) clearTimeout(autoCloseTimer.current); };
  }, [open, pinned, resetAutoClose]);

  // Clamp position when window resizes
  useEffect(() => {
    const onResize = () => {
      setPos(p => ({
        x: Math.min(p.x, window.innerWidth  - size.w - 4),
        y: Math.min(p.y, window.innerHeight - size.h - 4),
      }));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [size.w, size.h]);

  // pendingUrl — update local tab record + localStorage
  // BrowsePane owns the actual navigation and calls onPendingUrlConsumed itself
  useEffect(() => {
    if (!pendingUrl) return;
    setTabs(p => p.map(t => t.id === activeTab ? { ...t, url: pendingUrl } : t));
    if (runboxId) try { localStorage.setItem(`sbx-browser-url-${runboxId}`, pendingUrl); } catch {}
    resetAutoClose();
  }, [pendingUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lazy-mount tabs
  useEffect(() => {
    setMountedIds(p => { if (p.has(activeTab)) return p; const n = new Set(p); n.add(activeTab); return n; });
  }, [activeTab]);

  // ── Drag ──────────────────────────────────────────────────────────────────
  const onDragStart = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    dragging.current = true;
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const nx = Math.max(0, Math.min(e.clientX - dragOffset.current.x, window.innerWidth  - size.w));
      const ny = Math.max(0, Math.min(e.clientY - dragOffset.current.y, window.innerHeight - size.h));
      setPos({ x: nx, y: ny });
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

  // ── Resize (bottom-right handle) ─────────────────────────────────────────
  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    resizing.current = true;
    resizeStart.current = { mx: e.clientX, my: e.clientY, w: size.w, h: size.h };
    const onMove = (e: MouseEvent) => {
      if (!resizing.current) return;
      setSize({
        w: Math.max(280, resizeStart.current.w + e.clientX - resizeStart.current.mx),
        h: Math.max(200, resizeStart.current.h + e.clientY - resizeStart.current.my),
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

  // ── FIX: no pos sentinel — just gate on open ───────────────────────────────
  if (!open) return null;

  const portFromUrl = (url: string) => { try { return new URL(url).port || "80"; } catch { return "?"; } };
  const activeUrl   = tabs.find(t => t.id === activeTab)?.url ?? "";

  return (
    <div ref={containerRef} style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 50 }}>
      <div
        onMouseEnter={resetAutoClose}
        style={{
          position: "absolute",
          left: pos.x, top: pos.y,
          width: size.w, height: size.h,
          pointerEvents: "auto",
          display: "flex", flexDirection: "column",
          background: "#0d0d0d",
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,.10)",
          boxShadow: "0 16px 48px rgba(0,0,0,.75), 0 0 0 1px rgba(255,255,255,.04)",
          overflow: "hidden",
          animation: "floatIn .18s cubic-bezier(.2,.8,.2,1)",
        }}>

        {/* ── Title bar — drag handle ── */}
        <div
          onMouseDown={onDragStart}
          style={{
            height: 34, flexShrink: 0,
            display: "flex", alignItems: "center",
            padding: "0 10px", gap: 8,
            background: "#111",
            borderBottom: "1px solid rgba(255,255,255,.07)",
            cursor: "grab", userSelect: "none",
          }}>

          <div style={{
            width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
            background: "#5a9a5a", boxShadow: "0 0 5px #5a9a5a",
            animation: "pulse 2.4s ease-in-out infinite",
          }} />

          <span style={{ fontSize: 11, fontFamily: SANS, fontWeight: 500, color: "rgba(255,255,255,.5)", flex: 1 }}>
            Preview
            <span style={{ marginLeft: 6, fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "rgba(255,255,255,.25)" }}>
              :{portFromUrl(activeUrl)}
            </span>
          </span>

          <button
            onClick={() => { onPinnedChange(!pinned); if (!pinned && autoCloseTimer.current) clearTimeout(autoCloseTimer.current); }}
            title={pinned ? "Unpin (auto-close)" : "Pin (keep open)"}
            style={{
              background: pinned ? "rgba(255,255,255,.08)" : "none",
              border: pinned ? "1px solid rgba(255,255,255,.15)" : "1px solid transparent",
              cursor: "pointer", color: pinned ? "rgba(255,255,255,.7)" : "rgba(255,255,255,.3)",
              fontSize: 11, padding: "2px 7px", borderRadius: 5,
              fontFamily: SANS, transition: "all .12s",
            }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,.8)"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = pinned ? "rgba(255,255,255,.7)" : "rgba(255,255,255,.3)"}>
            {pinned ? "📌 pinned" : "pin"}
          </button>

          <button onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,.25)", fontSize: 15, padding: "2px 4px", borderRadius: 4, lineHeight: 1, transition: "color .1s" }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#cc5555"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,.25)"}>
            ×
          </button>
        </div>

        {/* ── Preview area ── */}
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
                  onUrlChange={(url: string) => {
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

        {/* ── Resize handle (bottom-right corner) ── */}
        <div
          onMouseDown={onResizeStart}
          style={{ position: "absolute", bottom: 0, right: 0, width: 16, height: 16, cursor: "nwse-resize", zIndex: 10 }}>
          <svg width="10" height="10" viewBox="0 0 10 10" style={{ position: "absolute", bottom: 3, right: 3, opacity: .25 }}>
            <path d="M9 1L1 9M9 5L5 9M9 9" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>
      </div>

      <style>{`
        @keyframes floatIn {
          from { opacity: 0; transform: scale(.94) translateY(8px); }
          to   { opacity: 1; transform: scale(1)  translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: .4; }
        }
      `}</style>
    </div>
  );
}