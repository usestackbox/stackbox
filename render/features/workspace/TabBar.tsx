// features/workspace/TabBar.tsx
import { useCallback, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { C, FS, MONO, SANS } from "../../design";
import { StripIcon } from "../../ui";
import { TermTab } from "./TermTab";
import { FileTab } from "./FileTab";
import { WinControls } from "./WinControls";
import { type WinState, type FileTab as FileTabData } from "./types";

const isMac = navigator.userAgent.toLowerCase().includes("mac");

interface TabBarProps {
  wins:             WinState[];
  fileTabs:         FileTabData[];
  activeWinId:      string | null;
  activeFileId:     string | null;
  sidebarCollapsed: boolean;
  fileTreeOpen:     boolean;
  macOffset:        boolean;
  toolbarSlot?:     React.ReactNode;
  onWinActivate:       (id: string) => void;
  onWinClose:          (id: string) => void;
  onWinRestore:        (id: string) => void;
  onAddTerminal:       () => void;
  onFileSelect:        (id: string) => void;
  onFileClose:         (id: string) => void;
  onReorderWins:       (fromId: string, toId: string) => void;
  onContextMenu:       (e: React.MouseEvent, win: WinState, idx: number) => void;
  onSidebarToggle:     () => void;
  onFileTreeToggle:    () => void;
}

const tbtn: React.CSSProperties = {
  background: "none", border: "none", color: C.t2,
  cursor: "pointer", display: "flex", alignItems: "center",
  justifyContent: "center", borderRadius: 8, lineHeight: 1, flexShrink: 0,
  transition: "color .1s, background .1s",
};

const TRAFFIC_H = 28;

export function TabBar({
  wins, fileTabs, activeWinId, activeFileId,
  sidebarCollapsed, fileTreeOpen, macOffset, toolbarSlot,
  onWinActivate, onWinClose, onWinRestore, onAddTerminal,
  onFileSelect, onFileClose, onReorderWins, onContextMenu,
  onSidebarToggle, onFileTreeToggle,
}: TabBarProps) {
  const [dragTabId,  setDragTabId]  = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragTabIdRef  = useRef<string | null>(null);
  const dragOverIdRef = useRef<string | null>(null);
  const hasFiles = fileTabs.length > 0;
  const TAB_BAR_H = macOffset ? 42 + TRAFFIC_H : 42;

  const handleDragStart = useCallback((_startX: number, id: string) => {
    dragTabIdRef.current = id;
    setDragTabId(id);
  }, []);

  const handleDragMove = useCallback((clientX: number) => {
    const els = document.querySelectorAll("[data-tab-id]");
    let found: string | null = null;
    els.forEach(el => {
      const rect = el.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right)
        found = (el as HTMLElement).dataset.tabId ?? null;
    });
    dragOverIdRef.current = found;
    setDragOverId(found);
  }, []);

  const handleDragEnd = useCallback((dragged: boolean, winId: string) => {
    if (dragged && dragTabIdRef.current && dragOverIdRef.current) {
      onReorderWins(dragTabIdRef.current, dragOverIdRef.current);
    }
    dragTabIdRef.current  = null;
    dragOverIdRef.current = null;
    setDragTabId(null);
    setDragOverId(null);
    if (!dragged) {
      const win = wins.find(w => w.id === winId);
      if (win?.minimized) onWinRestore(winId);
      else onWinActivate(winId);
    }
  }, [wins, onReorderWins, onWinActivate, onWinRestore]);

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      height: TAB_BAR_H, flexShrink: 0,
      background: C.bg1, borderBottom: `1px solid ${C.border}`,
      position: "relative", zIndex: 300, userSelect: "none",
      transition: "height .15s ease",
    }}>
      {macOffset && (
        <div data-tauri-drag-region style={{ height: TRAFFIC_H, flexShrink: 0 }} />
      )}

      <div style={{ display: "flex", alignItems: "stretch", flex: 1, padding: "0 6px", gap: 3 }}>
        {/* Brand + view toggles */}
        <div style={{
          display: "flex", alignItems: "center", gap: 5, flexShrink: 0,
          paddingLeft: 6, paddingRight: 8, alignSelf: "center",
          borderRight: `1px solid rgba(255,255,255,.08)`, marginRight: 2,
        }}>
          <span style={{
            fontSize: FS.base, fontWeight: 500, color: "rgb(126, 121, 121)",
            fontFamily: SANS, letterSpacing: "0.06em",
            userSelect: "none", paddingLeft: 2, lineHeight: "1",
          }}>Stackbox</span>

          <StripIcon title="Workspace" active={!sidebarCollapsed && !fileTreeOpen} onClick={onSidebarToggle} size={28}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" opacity="0.5"/>
              <path d="M3 5a2 2 0 0 1 2-2h4v18H5a2 2 0 0 1-2-2V5z"
                fill="currentColor" stroke="none"/>
              <line x1="9" y1="3" x2="9" y2="21" stroke="currentColor" opacity="0.5"/>
            </svg>
          </StripIcon>

          <StripIcon title="Code" active={!sidebarCollapsed && fileTreeOpen} onClick={onFileTreeToggle} size={28}>
            <span style={{
              fontSize: 12, fontWeight: 700, letterSpacing: "-0.03em",
              fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
              lineHeight: 1, userSelect: "none",
              color: "currentColor",
            }}>&lt;/&gt;</span>
          </StripIcon>
        </div>

        {/* Terminal tabs */}
        <div style={{
          display: "flex", alignItems: "stretch", gap: 0,
          overflowX: "auto", minWidth: 0, maxWidth: "55%",
          scrollbarWidth: "none",
        }}>
          {wins.map((w, idx) => (
            <TermTab
              key={w.id}
              win={w}
              idx={idx}
              isActive={activeWinId === w.id}
              hasFile={hasFiles && activeFileId !== null}
              dragTabId={dragTabId}
              dragOverId={dragOverId}
              onActivate={() => { onWinActivate(w.id); }}
              onClose={() => onWinClose(w.id)}
              onContextMenu={e => onContextMenu(e, w, idx)}
              onDragStart={handleDragStart}
              onDragMove={handleDragMove}
              onDragEnd={dragged => handleDragEnd(dragged, w.id)}
            />
          ))}

          <button
            onClick={onAddTerminal}
            title="New terminal"
            style={{ ...tbtn, width: 26, alignSelf: "stretch", borderRadius: 0, fontSize: 16, fontWeight: 300, border: "1px solid transparent", marginRight: 6 }}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLElement;
              el.style.color = C.t0; el.style.background = "rgba(255,255,255,.09)";
              el.style.borderColor = "transparent";
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLElement;
              el.style.color = C.t2; el.style.background = "transparent";
              el.style.borderColor = "transparent";
            }}
          >+</button>
        </div>

        {/* File tabs */}
        {fileTabs.length > 0 && (
          <>
            <div style={{ width: 1, height: 20, background: "rgba(255,255,255,.1)", flexShrink: 0, margin: "0 4px" }} />
            <div style={{ display: "flex", alignItems: "stretch", gap: 0, overflowX: "auto", minWidth: 0, flex: 1, scrollbarWidth: "none" }}>
              {fileTabs.map(tab => (
                <FileTab
                  key={tab.id}
                  tab={tab}
                  isActive={activeFileId === tab.id}
                  onSelect={() => onFileSelect(tab.id)}
                  onClose={() => onFileClose(tab.id)}
                />
              ))}
            </div>
          </>
        )}

        {/* Drag region spacer */}
        <div
          style={{ flex: fileTabs.length > 0 ? 0 : 1, minWidth: 20, height: "100%", cursor: "default" }}
          onMouseDown={e => {
            if (e.button === 0) getCurrentWindow().startDragging().catch(() => {});
          }}
        />

        {/* Right slot: toolbar + native window controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {toolbarSlot}
          {!isMac && <><div style={{ width: 10 }} /><WinControls /></>}
        </div>
      </div>
    </div>
  );
}