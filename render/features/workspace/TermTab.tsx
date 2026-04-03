// features/workspace/TermTab.tsx
import { useRef, useState } from "react";
import { C, MONO } from "../../design";
import { TabCloseBtn } from "../../ui";
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
  const isDragOver = dragOverId === win.id && dragTabId !== win.id;
  const isDragging = dragTabId === win.id;

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

  return (
    <div
      onMouseDown={handleMouseDown}
      data-tab-id={win.id}
      onContextMenu={e => { e.preventDefault(); onContextMenu(e); }}
      title={win.cwd}
      style={{
        display: "flex", alignItems: "center", gap: 5,
        padding: "5px 6px 5px 10px", height: 30, borderRadius: 8,
        cursor: dragTabId ? "grabbing" : "default", flexShrink: 0,
        background: isActive && !hasFile ? "rgba(255,255,255,.07)" : isDragOver ? "rgba(255,255,255,.05)" : "transparent",
        border: "1px solid transparent",
        opacity: win.minimized ? 0.55 : isDragging ? 0.4 : 1,
        transition: "background .1s", userSelect: "none",
      }}
      onMouseEnter={e => {
        if (!(isActive && !hasFile) && !dragTabId)
          (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,.05)";
      }}
      onMouseLeave={e => {
        if (!(isActive && !hasFile) && !isDragOver)
          (e.currentTarget as HTMLElement).style.background = "transparent";
      }}
    >
      {win.minimized && (
        <span style={{ width: 5, height: 5, borderRadius: "50%", flexShrink: 0, background: "rgba(255,255,255,.4)" }} />
      )}

      {!win.minimized && (win.kind === "browser" ? (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0,
          color: isActive && !hasFile ? "#fff" : "rgba(255,255,255,.4)" }}>
          <circle cx="12" cy="12" r="10"/>
          <line x1="2" y1="12" x2="22" y2="12"/>
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
        </svg>
      ) : (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.2"
          strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, color: isActive && !hasFile ? "#fff" : "rgba(255,255,255,.4)" }}>
          <polyline points="4 17 10 11 4 5"/>
          <line x1="12" y1="19" x2="20" y2="19"/>
        </svg>
      ))}

      <span style={{
        fontSize: 12, fontFamily: MONO,
        color: isActive && !hasFile ? "#ffffff" : "rgba(255,255,255,.4)",
        fontWeight: isActive && !hasFile ? 500 : 400,
        maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {winLabel(win)}
      </span>

      <TabCloseBtn onClose={onClose} />
    </div>
  );
}