// src/shared/NotificationSystem.tsx
//
// Two exports:
//   <NotificationBell runboxes={...} />  — drop into sidebar header
//   <NotificationToasts />              — drop once at root level (fixed overlay)
//
// Shared state lives in a module-level store so both components stay in sync
// without needing React context.

import { useState, useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { C, MONO, SANS, PORT } from "./constants";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AppNotification {
  id:         string;
  runboxId:   string;
  runboxName: string;
  agentName:  string;
  summary:    string;
  kind:       "done" | "failed";
  ts:         number;
  read:       boolean;
}

// ─── Module-level store (shared between Bell + Toasts) ────────────────────────

type Listener = (notes: AppNotification[]) => void;
let _notes: AppNotification[] = [];
const _listeners = new Set<Listener>();

function notify(next: AppNotification[]) {
  _notes = next;
  _listeners.forEach(fn => fn(next));
}

export function pushNote(note: Omit<AppNotification, "id" | "ts" | "read">) {
  const n: AppNotification = {
    ...note,
    id:   crypto.randomUUID(),
    ts:   Date.now(),
    read: false,
  };
  notify([n, ..._notes].slice(0, 50));
  return n;
}

function markAllRead() {
  notify(_notes.map(n => ({ ...n, read: true })));
}

function clearAll() {
  notify([]);
}

function useNotifications() {
  const [notes, setNotes] = useState<AppNotification[]>(_notes);
  useEffect(() => {
    const fn: Listener = v => setNotes([...v]);
    _listeners.add(fn);
    return () => { _listeners.delete(fn); };
  }, []);
  return notes;
}

// ─── PTY session tracker ──────────────────────────────────────────────────────
// Listens to real Tauri PTY events — pty://agent/{sid} (shell→agent upgrade)
// and pty://ended/{sid} (session over). This is the reliable signal: it fires
// every time regardless of whether the agent posts to the SSE bus.

export interface PtySessionInfo {
  sessionId:   string;   // same as what RunPane uses: `${runboxId}-${winId}`
  runboxId:    string;
  runboxName:  string;
}

interface RunboxRef { id: string; name: string; }

// Called once from WorkspaceView — registers sessions and wires up listeners.
export function usePtyNotifier(sessions: PtySessionInfo[]) {
  // sessionId → agent display name (set when pty://agent fires)
  const agentMap = useRef<Map<string, string>>(new Map());
  // sessionId → runbox info
  const infoMap  = useRef<Map<string, PtySessionInfo>>(new Map());

  // Keep infoMap fresh whenever sessions list changes
  useEffect(() => {
    infoMap.current.clear();
    sessions.forEach(s => infoMap.current.set(s.sessionId, s));
  }, [sessions]);

  // Subscribe to pty://agent/{sid} for every session — marks it as an agent
  useEffect(() => {
    if (sessions.length === 0) return;
    const cleanups: Array<() => void> = [];

    sessions.forEach(s => {
      let unsub: (() => void) | null = null;
      listen<string>(`pty://agent/${s.sessionId}`, ({ payload }) => {
        // payload = agent display name e.g. "Claude Code"
        agentMap.current.set(s.sessionId, payload || "agent");
      }).then(fn => { unsub = fn; cleanups.push(fn); });
    });

    return () => cleanups.forEach(fn => fn());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions.map(s => s.sessionId).join(",")]);

  // Subscribe to pty://ended/{sid} for every session
  useEffect(() => {
    if (sessions.length === 0) return;
    const cleanups: Array<() => void> = [];

    sessions.forEach(s => {
      listen<void>(`pty://ended/${s.sessionId}`, () => {
        const agentName = agentMap.current.get(s.sessionId);
        // Only notify if this session was an agent (shell exits are ignored)
        if (!agentName) return;

        const info = infoMap.current.get(s.sessionId);
        pushNote({
          runboxId:   info?.runboxId   ?? s.runboxId,
          runboxName: info?.runboxName ?? s.runboxName,
          agentName,
          summary:    "",   // will be filled in by memory toast if available
          kind:       "done",
        });

        // Clean up: this session is over
        agentMap.current.delete(s.sessionId);
      }).then(fn => cleanups.push(fn));
    });

    return () => cleanups.forEach(fn => fn());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions.map(s => s.sessionId).join(",")]);
}

// Also listen globally for the memory-added event — if a notification was just
// pushed with no summary, backfill it with the memory summary.
export function useMemorySummaryBackfill() {
  useEffect(() => {
    // memory-added carries { runbox_id, summary }
    const unsub = listen<any>("memory-added", ({ payload }) => {
      const rbId   = payload?.runbox_id ?? payload?.runboxId;
      const text   = payload?.summary   ?? payload?.content ?? "";
      if (!rbId || !text) return;

      // Update the most-recent notification for this runbox that has no summary
      _notes = _notes.map((n, i) => {
        if (i === 0 && n.runboxId === rbId && !n.summary) {
          return { ...n, summary: String(text).slice(0, 160) };
        }
        return n;
      });
      _listeners.forEach(fn => fn(_notes));
    });
    return () => { unsub.then(f => f()); };
  }, []);
}

// ─── Legacy SSE monitor kept as secondary (optional) ──────────────────────────
function useAgentMonitor(_runboxes: RunboxRef[]) {
  // Intentionally empty — replaced by usePtyNotifier which is more reliable.
  // Kept so the NotificationBell signature doesn't change.
}

// ─── Bell icon (put in sidebar header) ───────────────────────────────────────

export function NotificationBell({
  runboxes,
  onOpen,
}: {
  runboxes: RunboxRef[];
  onOpen:   () => void;
}) {
  const notes  = useNotifications();
  const unread = notes.filter(n => !n.read).length;

  useAgentMonitor(runboxes);

  return (
    <button
      title="Notifications"
      onClick={() => { markAllRead(); onOpen(); }}
      style={{
        position:   "relative",
        background: "none",
        border:     "none",
        cursor:     "pointer",
        padding:    "5px 6px",
        display:    "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 7,
        color: unread > 0 ? C.t0 : C.t2,
        transition: "color .12s, background .12s",
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.color = C.t0;
        el.style.background = C.bg3;
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.color = unread > 0 ? C.t0 : C.t2;
        el.style.background = "transparent";
      }}
    >
      {/* Bell SVG */}
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        {unread > 0 && (
          <circle cx="18" cy="5" r="4" fill={C.green} stroke={C.bg1} strokeWidth="1.5"/>
        )}
      </svg>

      {/* Badge */}
      {unread > 0 && (
        <span style={{
          position:   "absolute",
          top:        1,
          right:      1,
          minWidth:   14,
          height:     14,
          borderRadius: 7,
          background: C.green,
          color:      "#fff",
          fontSize:   9,
          fontWeight: 700,
          fontFamily: MONO,
          display:    "flex",
          alignItems: "center",
          justifyContent: "center",
          padding:    "0 3px",
          lineHeight: 1,
          border:     `1.5px solid ${C.bg1}`,
          pointerEvents: "none",
        }}>
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </button>
  );
}

// ─── Notification panel (slide-down from bell) ────────────────────────────────

export function NotificationPanel({
  open,
  anchorRef,
  onClose,
}: {
  open:      boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose:   () => void;
}) {
  const notes  = useNotifications();
  const ref    = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 52, left: 12 });

  useEffect(() => {
    if (open && anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 6, left: rect.left });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", esc);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      style={{
        position:   "fixed",
        top:        pos.top,
        left:       pos.left,
        width:      300,
        maxHeight:  420,
        background: "#141418",
        border:     `1px solid ${C.borderMd}`,
        borderRadius: 14,
        boxShadow:  "0 16px 48px rgba(0,0,0,.7), 0 0 0 0.5px rgba(255,255,255,.05)",
        display:    "flex",
        flexDirection: "column",
        zIndex:     99999,
        overflow:   "hidden",
        animation:  "sbFadeUp .16s ease",
      }}
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{
        display:    "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding:    "11px 14px 9px",
        borderBottom: `1px solid ${C.border}`,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.t0, fontFamily: SANS }}>
          Notifications
        </span>
        {notes.length > 0 && (
          <button
            onClick={clearAll}
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: 10, color: C.t2, fontFamily: SANS,
              padding: "2px 6px", borderRadius: 5,
              transition: "color .1s",
            }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.t0}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.t2}
          >
            Clear all
          </button>
        )}
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {notes.length === 0 ? (
          <div style={{
            padding: "32px 14px",
            textAlign: "center",
            fontSize: 12,
            color: C.t3,
            fontFamily: SANS,
          }}>
            No notifications yet
          </div>
        ) : (
          notes.map(n => (
            <NoteRow key={n.id} note={n} />
          ))
        )}
      </div>
    </div>
  );
}

function NoteRow({ note }: { note: AppNotification }) {
  const elapsed = useElapsed(note.ts);
  const isErr = note.kind === "failed";

  return (
    <div style={{
      padding:      "10px 14px",
      borderBottom: `1px solid ${C.border}`,
      display:      "flex",
      gap:          10,
      alignItems:   "flex-start",
    }}>
      {/* Icon */}
      <div style={{
        width:        22,
        height:       22,
        borderRadius: "50%",
        background:   isErr ? C.redBg : C.greenBg,
        border:       `1px solid ${isErr ? C.red : C.green}44`,
        display:      "flex",
        alignItems:   "center",
        justifyContent: "center",
        flexShrink:   0,
        marginTop:    1,
      }}>
        {isErr ? (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
            stroke={C.red} strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
            stroke={C.green} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 11, fontFamily: SANS, fontWeight: 600,
          color: C.t0, marginBottom: 2,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {note.runboxName}
          </span>
          <span style={{ fontSize: 10, color: C.t3, fontFamily: MONO, flexShrink: 0, marginLeft: 8 }}>
            {elapsed}
          </span>
        </div>
        <div style={{
          fontSize: 11, color: C.t1, fontFamily: SANS,
          lineHeight: 1.5,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical" as any,
        }}>
          {note.summary || (isErr ? "Agent encountered an error" : "Agent finished task")}
        </div>
        <div style={{ fontSize: 10, color: C.t3, fontFamily: MONO, marginTop: 3 }}>
          {note.agentName}
        </div>
      </div>
    </div>
  );
}

// ─── Floating toast (bottom-right) ───────────────────────────────────────────

export function NotificationToasts() {
  const notes   = useNotifications();
  const [toasts, setToasts] = useState<(AppNotification & { visible: boolean })[]>([]);
  const seenIds = useRef<Set<string>>(new Set());

  // Backfill summaries from memory-added events (runs once since this is a singleton)
  useMemorySummaryBackfill();

  // Detect newly added notes and add them as toasts
  useEffect(() => {
    for (const n of notes) {
      if (!seenIds.current.has(n.id)) {
        seenIds.current.add(n.id);
        setToasts(prev => [...prev, { ...n, visible: true }]);

        // Auto-dismiss after 6 s
        setTimeout(() => {
          setToasts(prev => prev.map(t => t.id === n.id ? { ...t, visible: false } : t));
          // Remove from DOM after exit animation
          setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== n.id));
          }, 380);
        }, 6000);
      }
    }
  }, [notes]);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, visible: false } : t));
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 380);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div style={{
      position:      "fixed",
      bottom:        20,
      right:         20,
      zIndex:        999999,
      display:       "flex",
      flexDirection: "column",
      gap:           10,
      pointerEvents: "none",
    }}>
      {toasts.map(toast => (
        <Toast key={toast.id} toast={toast} onDismiss={dismiss} />
      ))}

      <style>{`
        @keyframes toastIn  { from{opacity:0;transform:translateX(24px) scale(.97)} to{opacity:1;transform:translateX(0) scale(1)} }
        @keyframes toastOut { from{opacity:1;transform:translateX(0) scale(1)} to{opacity:0;transform:translateX(24px) scale(.97)} }
        @keyframes toastProgress { from{width:100%} to{width:0%} }
      `}</style>
    </div>
  );
}

function Toast({
  toast,
  onDismiss,
}: {
  toast:     AppNotification & { visible: boolean };
  onDismiss: (id: string) => void;
}) {
  const isErr   = toast.kind === "failed";
  const elapsed = useElapsed(toast.ts);

  return (
    <div
      style={{
        width:         320,
        background:    "#17171c",
        border:        `1px solid ${isErr ? C.red + "44" : C.green + "44"}`,
        borderRadius:  14,
        boxShadow:     "0 12px 40px rgba(0,0,0,.75), 0 0 0 0.5px rgba(255,255,255,.05)",
        overflow:      "hidden",
        pointerEvents: "all",
        cursor:        "default",
        animation:     toast.visible
          ? "toastIn .28s cubic-bezier(.16,1,.3,1) forwards"
          : "toastOut .35s cubic-bezier(.4,0,1,1) forwards",
        position:      "relative",
      }}
    >
      {/* Progress bar */}
      {toast.visible && (
        <div style={{
          position:   "absolute",
          bottom:     0,
          left:       0,
          height:     2,
          background: isErr ? C.red : C.green,
          opacity:    0.5,
          animation:  "toastProgress 6s linear forwards",
        }} />
      )}

      {/* Content */}
      <div style={{ padding: "12px 14px 14px", display: "flex", gap: 11, alignItems: "flex-start" }}>
        {/* Icon circle */}
        <div style={{
          width:          32,
          height:         32,
          borderRadius:   "50%",
          background:     isErr ? C.redBg : C.greenBg,
          border:         `1px solid ${isErr ? C.red : C.green}55`,
          display:        "flex",
          alignItems:     "center",
          justifyContent: "center",
          flexShrink:     0,
        }}>
          {isErr ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
              stroke={C.red} strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
              stroke={C.green} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          )}
        </div>

        {/* Text */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            display:     "flex",
            alignItems:  "center",
            justifyContent: "space-between",
            marginBottom: 3,
          }}>
            <span style={{
              fontSize:   12,
              fontWeight: 700,
              color:      C.t0,
              fontFamily: SANS,
              overflow:   "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
            }}>
              {isErr ? "Agent failed" : "Agent finished"} · {toast.runboxName}
            </span>
            <span style={{
              fontSize:  10,
              color:     C.t3,
              fontFamily: MONO,
              marginLeft: 8,
              flexShrink: 0,
            }}>
              {elapsed}
            </span>
          </div>

          {toast.summary ? (
            <div style={{
              fontSize:  11,
              color:     C.t1,
              fontFamily: SANS,
              lineHeight: 1.55,
              overflow:  "hidden",
              display:   "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical" as any,
            }}>
              {toast.summary}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: C.t2, fontFamily: SANS }}>
              {isErr ? "Encountered an error" : "Task completed successfully"}
            </div>
          )}
        </div>

        {/* Dismiss */}
        <button
          onClick={() => onDismiss(toast.id)}
          style={{
            background: "none",
            border:     "none",
            cursor:     "pointer",
            color:      C.t3,
            padding:    "2px 4px",
            borderRadius: 5,
            fontSize:   14,
            lineHeight: 1,
            flexShrink: 0,
            transition: "color .1s",
          }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.t0}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.t3}
        >
          ×
        </button>
      </div>
    </div>
  );
}

// ─── Helper: live elapsed time ────────────────────────────────────────────────

function useElapsed(ts: number): string {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const id = setInterval(() => forceUpdate(n => n + 1), 15000);
    return () => clearInterval(id);
  }, []);

  const d = Date.now() - ts;
  if (d < 5000)       return "just now";
  if (d < 60_000)     return `${Math.floor(d / 1000)}s ago`;
  if (d < 3600_000)   return `${Math.floor(d / 60_000)}m ago`;
  return `${Math.floor(d / 3600_000)}h ago`;
}