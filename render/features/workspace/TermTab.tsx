// features/workspace/TermTab.tsx
import { useState } from "react";
import { C, MONO } from "../../design";
import { winLabel, type WinState } from "./types";

interface TermTabProps {
  win:        WinState;
  idx:        number;
  isActive:   boolean;
  hasFile:    boolean;
  dragTabId:  string | null;
  dragOverId: string | null;
  onActivate:      () => void;
  onClose:         () => void;
  onContextMenu:   (e: React.MouseEvent) => void;
  onDragStart:     (startX: number, id: string) => void;
  onDragMove:      (clientX: number) => void;
  onDragEnd:       (dragged: boolean) => void;
}

export function TermTab({
  win, isActive, hasFile, dragTabId, dragOverId,
  onActivate, onClose, onContextMenu,
  onDragStart, onDragMove, onDragEnd,
}: TermTabProps) {
  const [hovered, setHovered] = useState(false);
  const isDragOver = dragOverId === win.id && dragTabId !== win.id;
  const isDragging = dragTabId === win.id;
  const active     = isActive && !hasFile;

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    let dragging = false;
    const onMove = (mv: MouseEvent) => {
      if (!dragging && Math.abs(mv.clientX - startX) > 6) { dragging = true; onDragStart(startX, win.id); }
      if (dragging) onDragMove(mv.clientX);
    };
    const onUp = () => {
      onDragEnd(dragging);
      if (!dragging) onActivate();
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const bg = active
    ? "rgba(255,255,255,.07)"
    : isDragOver
    ? "rgba(255,255,255,.05)"
    : hovered && !dragTabId
    ? "rgba(255,255,255,.04)"
    : "transparent";

  return (
    <div
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-tab-id={win.id}
      onContextMenu={e => { e.preventDefault(); onContextMenu(e); }}
      title={win.cwd}
      style={{
        display: "flex", alignItems: "center", gap: 4,
        padding: hovered && !active ? "0 4px 0 8px" : "0 6px 0 10px",
        height: "100%", borderRadius: 0,
        cursor: dragTabId ? "grabbing" : "default", flexShrink: 0,
        background: bg,
        borderRight: "1px solid rgba(255,255,255,.06)",
        borderTop: "none", borderBottom: "none", borderLeft: "none",
        opacity: win.minimized ? 0.55 : isDragging ? 0.4 : 1,
        transition: "background .1s, padding .12s, max-width .12s",
        userSelect: "none",
        maxWidth: hovered && !active ? 100 : 140,
        overflow: "hidden",
      }}
    >
      {win.minimized && (
        <span style={{ width: 5, height: 5, borderRadius: "2px", flexShrink: 0, background: "rgba(255,255,255,.4)" }} />
      )}

      {!win.minimized && (win.kind === "browser" ? (
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0,
          color: active ? "#fff" : "rgba(255,255,255,.35)" }}>
          <circle cx="12" cy="12" r="10"/>
          <line x1="2" y1="12" x2="22" y2="12"/>
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
        </svg>
      ) : (
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.2"
          strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, color: active ? "#fff" : "rgba(255,255,255,.35)" }}>
          <polyline points="4 17 10 11 4 5"/>
          <line x1="12" y1="19" x2="20" y2="19"/>
        </svg>
      ))}

      <span style={{
        fontSize: 12, fontFamily: MONO,
        color: active ? "#fff" : hovered ? "rgba(255,255,255,.65)" : "rgba(255,255,255,.38)",
        fontWeight: active ? 500 : 400,
        flex: 1, minWidth: 0,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        transition: "color .1s",
      }}>
        {winLabel(win)}
      </span>

      {/* Close — hidden until hover or active, red on hover */}
      <button
        onMouseDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); onClose(); }}
        style={{
          flexShrink: 0, width: 14, height: 14,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "transparent", border: "none", borderRadius: 3,
          cursor: "pointer", padding: 0,
          opacity: hovered || active ? 1 : 0,
          color: "rgba(255,255,255,.45)",
          transition: "opacity .1s, background .1s, color .1s",
          pointerEvents: hovered || active ? "all" : "none",
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,.25)";
          (e.currentTarget as HTMLElement).style.color = "#f87171";
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLElement).style.background = "transparent";
          (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,.45)";
        }}
      >
        <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <line x1="2" y1="2" x2="8" y2="8"/>
          <line x1="8" y1="2" x2="2" y2="8"/>
        </svg>
      </button>
    </div>
  );
}