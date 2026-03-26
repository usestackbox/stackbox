// src/core/BrowsePane.tsx
// Localhost-only preview pane. No general browsing — only shows dev servers.
import { useEffect, useRef, useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface BrowserHandle {
  navigateTo: (url: string) => void;
  currentUrl: () => string;
}

interface BrowsePanelProps {
  paneId:                 string;
  runboxId?:              string;
  isActive:               boolean;
  onActivate:             () => void;
  onClose:                (id: string) => void;
  agentRef?:              React.MutableRefObject<BrowserHandle | null>;
  onUrlChange?:           (url: string) => void;
  externalUrl?:           string | null;
  onExternalUrlConsumed?: () => void;
}

function isAllowedUrl(url: string): boolean {
  return url.startsWith("file://")
    || url.includes("localhost")
    || url.includes("127.0.0.1")
    || url.includes("0.0.0.0");
}

export default function BrowsePane({
  paneId, runboxId, isActive, onActivate, onClose,
  agentRef, onUrlChange,
  externalUrl, onExternalUrlConsumed,
}: BrowsePanelProps) {
  const slotRef      = useRef<HTMLDivElement>(null);
  const urlRef       = useRef("http://localhost:3000");
  const isActiveRef  = useRef(isActive);
  const createdRef   = useRef(false);
  // ── FIX: hold any URL that arrived before the webview existed ──────────────
  const pendingNavRef = useRef<string | null>(null);
  const [urlInput,  setUrlInput]  = useState("http://localhost:3000");
  const [loading,   setLoading]   = useState(true);
  const [connError, setConnError] = useState(false);

  useEffect(() => { isActiveRef.current = isActive; }, [isActive]);

  const getRect = useCallback(() => {
    const slot = slotRef.current;
    if (!slot) return null;
    const r = slot.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }, []);

  const navigate = useCallback(async (raw: string) => {
    const trimmed = raw.trim();
    // Don't prepend http:// if already has a scheme (http, https, file, etc.)
    const url = /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(trimmed)
      ? trimmed
      : `http://${trimmed}`;
    setConnError(false);
    urlRef.current = url;
    setUrlInput(url);
    onUrlChange?.(url);
    await invoke("browser_navigate", { id: paneId, url }).catch(() => setConnError(true));
  }, [paneId, onUrlChange]);

  // ── FIX: consume externalUrl immediately; if webview not ready, queue it ──
  useEffect(() => {
    if (!externalUrl) return;
    // Signal the parent right away so it doesn't hold a stale pendingUrl
    onExternalUrlConsumed?.();
    if (!isAllowedUrl(externalUrl)) return;
    if (createdRef.current) {
      navigate(externalUrl);
    } else {
      // Webview not yet created — store for drain after creation
      pendingNavRef.current = externalUrl;
    }
  }, [externalUrl]); // intentionally omit navigate/onExternalUrlConsumed to avoid double-fire

  // URL change from webview
  useEffect(() => {
    const unsub = listen<{ id: string; url: string }>("browser-url-changed", ({ payload }) => {
      if (payload.id !== paneId) return;
      urlRef.current = payload.url;
      setUrlInput(payload.url);
      onUrlChange?.(payload.url);
    });
    return () => { unsub.then(f => f()); };
  }, [paneId, onUrlChange]);

  // Create webview
  useEffect(() => {
    let alive = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const tryCreate = async () => {
      if (!alive || createdRef.current) return;
      await new Promise(r => requestAnimationFrame(r));
      if (!alive) return;
      const rect = getRect();
      if (!rect || rect.width < 1 || rect.height < 1) {
        retryTimer = setTimeout(tryCreate, 50); return;
      }
      try {
        await invoke("browser_create", { id: paneId, url: urlRef.current, ...rect, runboxId: runboxId ?? paneId });
        if (!alive) return;
        createdRef.current = true;
        setLoading(false);
        // ── FIX: drain any URL that arrived while we were still creating ────
        if (pendingNavRef.current) {
          navigate(pendingNavRef.current);
          pendingNavRef.current = null;
        }
        if (isActiveRef.current) invoke("browser_show", { id: paneId, ...rect }).catch(() => {});
        else invoke("browser_hide", { id: paneId }).catch(() => {});
      } catch {
        if (alive) retryTimer = setTimeout(tryCreate, 200);
      }
    };
    tryCreate();
    return () => {
      alive = false;
      if (retryTimer) clearTimeout(retryTimer);
      if (createdRef.current) {
        invoke("browser_destroy", { id: paneId }).catch(() => {});
        createdRef.current = false;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId]);

  // Reposition
  useEffect(() => {
    const slot = slotRef.current; if (!slot) return;
    const obs = new ResizeObserver(() => {
      if (!createdRef.current) return;
      const rect = getRect();
      if (!rect || rect.width < 1) return;
      if (isActiveRef.current) invoke("browser_set_bounds", { id: paneId, ...rect }).catch(() => {});
    });
    obs.observe(slot);
    return () => obs.disconnect();
  }, [paneId, getRect]);

  // Show/hide
  useEffect(() => {
    if (!createdRef.current) return;
    if (isActive) {
      const rect = getRect();
      if (rect) invoke("browser_show", { id: paneId, ...rect }).catch(() => {});
    } else {
      invoke("browser_hide", { id: paneId }).catch(() => {});
    }
  }, [isActive, paneId, getRect]);

  // Agent handle
  useEffect(() => {
    if (!agentRef) return;
    agentRef.current = { navigateTo: navigate, currentUrl: () => urlRef.current };
  }, [agentRef, navigate]);

  const reload = useCallback(() => {
    setConnError(false);
    invoke("browser_reload", { id: paneId }).catch(() => {});
  }, [paneId]);

  const portFromUrl = (url: string) => {
    try { return new URL(url).port || "80"; } catch { return ""; }
  };

  return (
    <div onClick={onActivate} style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%" }}>

      {/* Minimal toolbar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "0 8px", height: 32, flexShrink: 0,
        background: "#0e0e0e",
        borderBottom: "1px solid rgba(255,255,255,.06)",
      }}>
        {/* Port badge */}
        <div style={{
          display: "flex", alignItems: "center", gap: 5,
          padding: "3px 8px", borderRadius: 5,
          background: connError ? "rgba(200,60,60,.12)" : "rgba(80,160,80,.10)",
          border: `1px solid ${connError ? "rgba(200,60,60,.2)" : "rgba(80,160,80,.15)"}`,
          flexShrink: 0,
        }}>
          <div style={{
            width: 5, height: 5, borderRadius: "50%",
            background: connError ? "#cc5555" : "#5a9a5a",
            boxShadow: connError ? "none" : "0 0 4px #5a9a5a",
          }} />
          <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: connError ? "#cc8888" : "#88bb88" }}>
            :{portFromUrl(urlInput)}
          </span>
        </div>

        {/* URL — localhost path only */}
        <input
          value={urlInput}
          onChange={e => setUrlInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") navigate(urlInput); }}
          onClick={e => { e.stopPropagation(); (e.target as HTMLInputElement).select(); }}
          style={{
            flex: 1, background: "transparent", border: "none",
            color: "rgba(255,255,255,.45)", fontSize: 11,
            padding: "3px 0", outline: "none",
            fontFamily: "'JetBrains Mono', monospace",
            cursor: "text",
          }}
          onFocus={e => e.currentTarget.style.color = "rgba(255,255,255,.75)"}
          onBlur={e  => e.currentTarget.style.color = "rgba(255,255,255,.45)"}
        />

        {/* Reload */}
        <button onClick={e => { e.stopPropagation(); reload(); }}
          style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,.3)", fontSize: 14, padding: "2px 4px", borderRadius: 4, lineHeight: 1 }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,.7)"}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,.3)"}>
          ↻
        </button>

        {/* Close */}
        <button onClick={e => { e.stopPropagation(); onClose(paneId); }}
          style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,.25)", fontSize: 14, padding: "2px 4px", borderRadius: 4, lineHeight: 1 }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#cc5555"}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,.25)"}>
          ×
        </button>
      </div>

      {/* Loading bar */}
      {loading && (
        <div style={{ height: 1.5, background: "#111", flexShrink: 0, overflow: "hidden" }}>
          <div style={{ height: "100%", width: "40%", background: "rgba(80,160,80,.6)", animation: "bpSlide 1.1s ease-in-out infinite" }} />
        </div>
      )}

      {/* Connection error state */}
      {connError && !loading && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, background: "#0c0c0c" }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,.3)", fontFamily: "'JetBrains Mono', monospace" }}>
            {urlInput} — not reachable
          </span>
          <button onClick={reload} style={{ fontSize: 10, color: "rgba(255,255,255,.4)", background: "none", border: "1px solid rgba(255,255,255,.1)", borderRadius: 5, padding: "4px 12px", cursor: "pointer", fontFamily: "'JetBrains Mono', monospace" }}>
            retry
          </button>
        </div>
      )}

      {/* Slot */}
      <div ref={slotRef} style={{ flex: 1, minHeight: 0, minWidth: 0, background: "#0c0c0c", pointerEvents: "none" }} />
      <style>{`@keyframes bpSlide{0%{transform:translateX(-100%)}100%{transform:translateX(400%)}}`}</style>
    </div>
  );
}