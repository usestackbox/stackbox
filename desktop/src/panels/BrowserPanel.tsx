import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import BrowserPane from "../core/BrowsePane";
import { C, SANS, tbtn } from "../shared/constants";
import { IcoGlobe } from "../shared/icons";
import { useDragResize } from "../shared/hooks";

let _bseq = 0;
interface BrowserTab { id: string; url: string; }
const mkBrowserTab = (url = "https://github.com"): BrowserTab => ({ id: `bp${++_bseq}`, url });

interface BrowserPanelProps {
  open:                   boolean;
  pendingUrl:             string | null;
  onPendingUrlConsumed:   () => void;
  onClosePanel:           () => void;
}

export function BrowserPanel({ open, pendingUrl, onPendingUrlConsumed, onClosePanel }: BrowserPanelProps) {
  const [tabs,       setTabs]       = useState<BrowserTab[]>(() => [mkBrowserTab()]);
  const [activeTab,  setActiveTab]  = useState(() => tabs[0].id);
  const [mountedIds, setMountedIds] = useState<Set<string>>(() => new Set([tabs[0].id]));
  const [width,      onDragDown]    = useDragResize(480, "left", 220, 900);

  // Navigate active tab to pending URL when one arrives
  useEffect(() => {
    if (!pendingUrl) return;
    setTabs(p => p.map(t => t.id === activeTab ? { ...t, url: pendingUrl } : t));
    onPendingUrlConsumed();
  }, [pendingUrl]);

  // Lazy-mount tabs on first activation
  useEffect(() => {
    setMountedIds(p => { if (p.has(activeTab)) return p; const n = new Set(p); n.add(activeTab); return n; });
  }, [activeTab]);

  const addTab = () => {
    const t = mkBrowserTab();
    setTabs(p => [...p, t]);
    setActiveTab(t.id);
  };

  const closeTab = (id: string) => {
    setTabs(p => {
      if (p.length === 1) { onClosePanel(); return p; }
      const idx = p.findIndex(t => t.id === id);
      const n   = p.filter(t => t.id !== id);
      setActiveTab(a => a === id ? (n[Math.max(0, idx - 1)]?.id ?? n[0].id) : a);
      setMountedIds(m => { const s = new Set(m); s.delete(id); return s; });
      invoke("browser_destroy", { id }).catch(() => {});
      return n;
    });
  };

  if (!open) return null;

  return (
    <div style={{ width, flexShrink: 0, display: "flex", flexDirection: "column", background: C.bg1, borderLeft: `1px solid ${C.border}`, position: "relative" }}>
      {/* Drag handle */}
      <div onMouseDown={onDragDown}
        style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, cursor: "col-resize", zIndex: 9999, transition: "background .15s" }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = C.tealBorder}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"} />

      {/* Tab bar */}
      <div style={{ display: "flex", alignItems: "stretch", height: 35, flexShrink: 0, background: C.bg1, borderBottom: `1px solid ${C.border}`, overflowX: "auto", paddingLeft: 6 }}>
        {tabs.map(tab => {
          const isActive = tab.id === activeTab;
          const domain   = (() => { try { return new URL(tab.url).hostname.replace("www.", ""); } catch { return "new tab"; } })();
          return (
            <div key={tab.id} onClick={() => setActiveTab(tab.id)}
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "0 7px 0 10px", minWidth: 76, maxWidth: 140, cursor: "pointer", flexShrink: 0, background: isActive ? C.bg0 : "transparent", borderRight: `1px solid ${C.border}`, borderBottom: isActive ? `2px solid ${C.teal}` : "2px solid transparent" }}
              onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = C.bg2; }}
              onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
              <IcoGlobe on={isActive} />
              <span style={{ fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: isActive ? C.t0 : C.t2, fontFamily: SANS }}>{domain}</span>
              <button onClick={e => { e.stopPropagation(); closeTab(tab.id); }}
                style={{ ...tbtn, fontSize: 12, opacity: isActive ? 0.5 : 0, flexShrink: 0 }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; (e.currentTarget as HTMLElement).style.color = C.red; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = isActive ? "0.5" : "0"; (e.currentTarget as HTMLElement).style.color = C.t2; }}>×</button>
            </div>
          );
        })}
        <button onClick={addTab}
          style={{ ...tbtn, padding: "0 10px", fontSize: 16, fontWeight: 300, borderRadius: 0, flexShrink: 0 }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.tealText}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.t2}>+</button>
        <div style={{ flex: 1 }} />
        <button onClick={onClosePanel} title="Close browser"
          style={{ ...tbtn, padding: "0 10px", borderRadius: 0, borderLeft: `1px solid ${C.border}`, flexShrink: 0 }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.red}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.t2}>×</button>
      </div>

      {/* Pane area */}
      <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
        {tabs.map(tab => {
          if (!mountedIds.has(tab.id)) return null;
          return (
            <div key={tab.id} style={{ position: "absolute", inset: 0, visibility: tab.id === activeTab ? "visible" : "hidden", pointerEvents: tab.id === activeTab ? "auto" : "none" }}>
              <BrowserPane
                paneId={tab.id} isActive={tab.id === activeTab}
                onActivate={() => setActiveTab(tab.id)} onClose={closeTab}
                externalUrl={tab.id === activeTab ? pendingUrl : null}
                onExternalUrlConsumed={onPendingUrlConsumed}
                onUrlChange={(url: string) => setTabs(p => p.map(t => t.id === tab.id ? { ...t, url } : t))}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}