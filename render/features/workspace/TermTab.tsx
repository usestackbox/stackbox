// features/workspace/TermTab.tsx
import { useState } from "react";
import { MONO } from "../../design";
import { winLabel, AGENT_META, type WinState } from "./types";

// ── Font Awesome 6 — inject once ─────────────────────────────────────────────
if (typeof document !== "undefined" && !document.getElementById("fa-cdn-v6")) {
  const link = document.createElement("link");
  link.id   = "fa-cdn-v6";
  link.rel  = "stylesheet";
  link.href = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css";
  document.head.appendChild(link);
}

interface TermTabProps {
  win:        WinState;
  idx:        number;
  isActive:   boolean;
  hasFile:    boolean;
  dragTabId:  string | null;
  dragOverId: string | null;
  onActivate:    () => void;
  onClose:       () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart:   (startX: number, id: string) => void;
  onDragMove:    (clientX: number) => void;
  onDragEnd:     (dragged: boolean) => void;
}

// ── Font Awesome icon class per agent ─────────────────────────────────────────
// All icons render white; opacity dims when tab is inactive.
const AGENT_FA: Record<string, string> = {
  claude:  "fa-solid fa-diamond",       // Anthropic diamond
  codex:   "fa-brands fa-openai",       // OpenAI Codex — brand icon
  openai:  "fa-brands fa-openai",       // OpenAI — brand icon
  gemini:  "fa-solid fa-gem",           // Gemini sparkle gem
  cursor:  "fa-solid fa-arrow-pointer", // Cursor — pointer arrow
  copilot: "fa-brands fa-github",       // GitHub Copilot — GitHub brand
  aider:   "fa-solid fa-robot",         // Aider robot
};

// ── AgentIcon ─────────────────────────────────────────────────────────────────
function AgentIcon({ agentKey, active }: { agentKey: string; active: boolean }) {
  const cls = AGENT_FA[agentKey] ?? "fa-solid fa-circle-dot";
  return (
    <i
      className={cls}
      style={{
        fontSize:   10,
        width:      10,
        flexShrink: 0,
        textAlign:  "center",
        color:      active ? "#ffffff" : "rgba(255,255,255,0.35)",
        transition: "color .1s",
      }}
    />
  );
}

// ── TermTab ───────────────────────────────────────────────────────────────────
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
      if (!dragging && Math.abs(mv.clientX - startX) > 6) {
        dragging = true;
        onDragStart(startX, win.id);
      }
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

  // Agent key: prefer detectedAgent (runtime), fall back to agentCmd (startup config)
  const agent   = win.detectedAgent ?? (win.agentCmd ?? null);
  const isAgent = !!agent && win.kind === "terminal";

  const labelColor = active ? "#ffffff" : hovered ? "rgba(255,255,255,.65)" : "rgba(255,255,255,.38)";

  return (
    <div
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-tab-id={win.id}
      onContextMenu={e => { e.preventDefault(); onContextMenu(e); }}
      title={isAgent ? (AGENT_META[agent!]?.label ?? agent!) : win.cwd}
      style={{
        display:     "flex",
        alignItems:  "center",
        gap:         5,
        padding:     hovered && !active ? "0 4px 0 8px" : "0 6px 0 10px",
        height:      "100%",
        borderRadius: 0,
        cursor:      dragTabId ? "grabbing" : "default",
        flexShrink:  0,
        background:  bg,
        borderRight: "1px solid rgba(255,255,255,.06)",
        border:      "none",
        opacity:     win.minimized ? 0.55 : isDragging ? 0.4 : 1,
        transition:  "background .1s, padding .12s, max-width .12s",
        userSelect:  "none",
        maxWidth:    hovered && !active ? 120 : 160,
        overflow:    "hidden",
      }}
    >
      {/* Minimized indicator dot */}
      {win.minimized && (
        <span style={{
          width: 5, height: 5, borderRadius: "2px",
          flexShrink: 0, background: "rgba(255,255,255,.4)",
        }} />
      )}

      {/* Leading icon */}
      {!win.minimized && (
        isAgent ? (
          <AgentIcon agentKey={agent!} active={active} />
        ) : win.kind === "browser" ? (
          <i
            className="fa-solid fa-globe"
            style={{
              fontSize: 9, width: 9, flexShrink: 0,
              color: active ? "#ffffff" : "rgba(255,255,255,.35)",
              transition: "color .1s",
            }}
          />
        ) : (
          <i
            className="fa-solid fa-chevron-right"
            style={{
              fontSize: 8, width: 8, flexShrink: 0,
              color: active ? "#ffffff" : "rgba(255,255,255,.35)",
              transition: "color .1s",
            }}
          />
        )
      )}

      {/* Tab label */}
      <span style={{
        fontSize:     12,
        fontFamily:   MONO,
        color:        labelColor,
        fontWeight:   active ? 500 : 400,
        flex:         1,
        minWidth:     0,
        overflow:     "hidden",
        textOverflow: "ellipsis",
        whiteSpace:   "nowrap",
        transition:   "color .1s",
      }}>
        {winLabel(win)}
      </span>

      {/* Close button */}
      <button
        onMouseDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); onClose(); }}
        style={{
          flexShrink:    0,
          width:         14,
          height:        14,
          display:       "flex",
          alignItems:    "center",
          justifyContent: "center",
          background:    "transparent",
          border:        "none",
          borderRadius:  3,
          cursor:        "pointer",
          padding:       0,
          opacity:       hovered || active ? 1 : 0,
          color:         "rgba(255,255,255,.45)",
          transition:    "opacity .1s, background .1s, color .1s",
          pointerEvents: hovered || active ? "all" : "none",
        }}
        onMouseEnter={e => {
          const el = e.currentTarget as HTMLElement;
          el.style.background = "rgba(239,68,68,.25)";
          el.style.color      = "#f87171";
        }}
        onMouseLeave={e => {
          const el = e.currentTarget as HTMLElement;
          el.style.background = "transparent";
          el.style.color      = "rgba(255,255,255,.45)";
        }}
      >
        <i className="fa-solid fa-xmark" style={{ fontSize: 8, pointerEvents: "none" }} />
      </button>
    </div>
  );
}