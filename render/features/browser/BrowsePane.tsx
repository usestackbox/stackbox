import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
// features/browser/BrowsePane.tsx
// Localhost-only preview pane. No general browsing — only shows dev servers.
import { useCallback, useEffect, useRef, useState } from "react";
import { C, MONO } from "../../design";

export interface BrowserHandle {
  navigateTo: (url: string) => void;
  currentUrl: () => string;
}

export interface BrowsePaneProps {
  paneId: string;
  runboxId?: string;
  isActive: boolean;
  onActivate: () => void;
  onClose: (id: string) => void;
  agentRef?: React.MutableRefObject<BrowserHandle | null>;
  onUrlChange?: (url: string) => void;
  externalUrl?: string | null;
  onExternalUrlConsumed?: () => void;
}

function isAllowedUrl(url: string): boolean {
  return (
    url.startsWith("file://") ||
    url.includes("localhost") ||
    url.includes("127.0.0.1") ||
    url.includes("0.0.0.0")
  );
}

function portFromUrl(url: string): string {
  try {
    return new URL(url).port || "80";
  } catch {
    return "";
  }
}

export function BrowsePane({
  paneId,
  runboxId,
  isActive,
  onActivate,
  onClose,
  agentRef,
  onUrlChange,
  externalUrl,
  onExternalUrlConsumed,
}: BrowsePaneProps) {
  const slotRef = useRef<HTMLDivElement>(null);
  const urlRef = useRef("http://localhost:3000");
  const isActiveRef = useRef(isActive);
  const createdRef = useRef(false);
  const pendingNavRef = useRef<string | null>(null);
  const [urlInput, setUrlInput] = useState("http://localhost:3000");
  const [loading, setLoading] = useState(true);
  const [connError, setConnError] = useState(false);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  const getRect = useCallback(() => {
    const slot = slotRef.current;
    if (!slot) return null;
    const r = slot.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }, []);

  const navigate = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      const url = /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
      setConnError(false);
      urlRef.current = url;
      setUrlInput(url);
      onUrlChange?.(url);
      await invoke("browser_navigate", { id: paneId, url }).catch(() => setConnError(true));
    },
    [paneId, onUrlChange]
  );

  // Consume externalUrl; queue if webview not ready
  useEffect(() => {
    if (!externalUrl) return;
    onExternalUrlConsumed?.();
    if (!isAllowedUrl(externalUrl)) return;
    if (createdRef.current) navigate(externalUrl);
    else pendingNavRef.current = externalUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalUrl]);

  // URL change events from Tauri webview
  useEffect(() => {
    const unsub = listen<{ id: string; url: string }>("browser-url-changed", ({ payload }) => {
      if (payload.id !== paneId) return;
      urlRef.current = payload.url;
      setUrlInput(payload.url);
      onUrlChange?.(payload.url);
    });
    return () => {
      unsub.then((f) => f());
    };
  }, [paneId, onUrlChange]);

  // Create webview with retry
  useEffect(() => {
    let alive = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const tryCreate = async () => {
      if (!alive || createdRef.current) return;
      await new Promise((r) => requestAnimationFrame(r));
      if (!alive) return;
      const rect = getRect();
      if (!rect || rect.width < 1 || rect.height < 1) {
        retryTimer = setTimeout(tryCreate, 50);
        return;
      }
      try {
        await invoke("browser_create", {
          id: paneId,
          url: urlRef.current,
          ...rect,
          runboxId: runboxId ?? paneId,
        });
        if (!alive) return;
        createdRef.current = true;
        setLoading(false);
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

  // Reposition on resize
  useEffect(() => {
    const slot = slotRef.current;
    if (!slot) return;
    const obs = new ResizeObserver(() => {
      if (!createdRef.current) return;
      const rect = getRect();
      if (!rect || rect.width < 1) return;
      if (isActiveRef.current)
        invoke("browser_set_bounds", { id: paneId, ...rect }).catch(() => {});
    });
    obs.observe(slot);
    return () => obs.disconnect();
  }, [paneId, getRect]);

  // Show / hide based on active state
  useEffect(() => {
    if (!createdRef.current) return;
    if (isActive) {
      const rect = getRect();
      if (rect) invoke("browser_show", { id: paneId, ...rect }).catch(() => {});
    } else {
      invoke("browser_hide", { id: paneId }).catch(() => {});
    }
  }, [isActive, paneId, getRect]);

  // Expose agent handle
  useEffect(() => {
    if (!agentRef) return;
    agentRef.current = { navigateTo: navigate, currentUrl: () => urlRef.current };
  }, [agentRef, navigate]);

  const reload = useCallback(() => {
    setConnError(false);
    invoke("browser_reload", { id: paneId }).catch(() => {});
  }, [paneId]);

  const port = portFromUrl(urlInput);
  const dotBg = connError ? "#cc5555" : "#5a9a5a";

  return (
    <div
      onClick={onActivate}
      style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%" }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 8px",
          height: 32,
          flexShrink: 0,
          background: C.bg0,
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        {/* Port badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "3px 8px",
            borderRadius: 5,
            flexShrink: 0,
            background: connError ? C.redBg : "rgba(80,160,80,.10)",
            border: connError ? `1px solid ${C.redBorder}` : "1px solid rgba(80,160,80,.15)",
          }}
        >
          <div
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: dotBg,
              boxShadow: connError ? "none" : `0 0 4px ${dotBg}`,
            }}
          />
          <span
            style={{ fontSize: 10, fontFamily: MONO, color: connError ? "#cc8888" : "#88bb88" }}
          >
            :{port}
          </span>
        </div>

        {/* URL input */}
        <input
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") navigate(urlInput);
          }}
          onClick={(e) => {
            e.stopPropagation();
            (e.target as HTMLInputElement).select();
          }}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            color: C.t2,
            fontSize: 11,
            padding: "3px 0",
            outline: "none",
            fontFamily: MONO,
            cursor: "text",
          }}
          onFocus={(e) => (e.currentTarget.style.color = C.t1)}
          onBlur={(e) => (e.currentTarget.style.color = C.t2)}
        />

        {/* Reload */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            reload();
          }}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: C.t3,
            fontSize: 14,
            padding: "2px 4px",
            borderRadius: 4,
            lineHeight: 1,
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = C.t0)}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = C.t3)}
        >
          ↻
        </button>

        {/* Close */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose(paneId);
          }}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: C.t3,
            fontSize: 14,
            padding: "2px 4px",
            borderRadius: 4,
            lineHeight: 1,
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = C.red)}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = C.t3)}
        >
          ×
        </button>
      </div>

      {/* Loading bar */}
      {loading && (
        <div style={{ height: 1.5, background: C.bg2, flexShrink: 0, overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: "40%",
              background: "rgba(80,160,80,.6)",
              animation: "bpSlide 1.1s ease-in-out infinite",
            }}
          />
        </div>
      )}

      {/* Connection error */}
      {connError && !loading && (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            background: C.bg0,
          }}
        >
          <span style={{ fontSize: 11, color: C.t2, fontFamily: MONO }}>
            {urlInput} — not reachable
          </span>
          <button
            onClick={reload}
            style={{
              fontSize: 10,
              color: C.t2,
              background: "none",
              border: `1px solid ${C.border}`,
              borderRadius: 5,
              padding: "4px 12px",
              cursor: "pointer",
              fontFamily: MONO,
            }}
          >
            retry
          </button>
        </div>
      )}

      {/* Webview slot */}
      <div
        ref={slotRef}
        style={{ flex: 1, minHeight: 0, minWidth: 0, background: C.bg0, pointerEvents: "none" }}
      />

      <style>
        {"@keyframes bpSlide{0%{transform:translateX(-100%)}100%{transform:translateX(400%)}}"}
      </style>
    </div>
  );
}
