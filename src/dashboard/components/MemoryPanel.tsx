/**
 * MemoryPanel.tsx
 * Standalone memory panel — reads from memory.rs + db.rs via Tauri invoke.
 * Drop into your project and wire from RunboxManager.tsx.
 * Does NOT touch RunPanel.tsx or lib.rs internals.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

// ── Colour tokens (mirrors RunboxManager) ────────────────────────────────────
const C = {
  bg0: "#0d0d0d", bg1: "#141414", bg2: "#1a1a1a",
  bg3: "#222222", bg4: "#2a2a2a",
  border: "rgba(255,255,255,.07)", borderHi: "rgba(255,255,255,.14)",
  text0: "#f0f0f0", text1: "#b0b0b0", text2: "#555555", text3: "#333333",
  green: "#3fb950", red: "#e05252", blue: "#79b8ff", yellow: "#fbbf24",
  purple: "#c084fc",
};

// ── Types (mirrors memory.rs + db.rs row structs) ─────────────────────────────
export interface Memory {
  id:         string;
  runbox_id:  string;
  session_id: string;
  agent:      string;
  content:    string;
  pinned:     boolean;
  timestamp:  number;
}

export interface DbSession {
  id:         string;
  runbox_id:  string;
  pane_id:    string;
  agent:      string;
  cwd:        string;
  started_at: number;
  ended_at:   number | null;
  exit_code:  number | null;
  log_path:   string | null;
}

export interface FileChange {
  id:          number;
  session_id:  string;
  runbox_id:   string;
  file_path:   string;
  change_type: string;
  diff:        string | null;
  timestamp:   number;
}

type Tab = "memories" | "sessions" | "files";

// ── Helpers ───────────────────────────────────────────────────────────────────
function reltime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000)  return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}

function agentColor(agent: string): string {
  const map: Record<string, string> = {
    claude: C.blue, gemini: "#85e89d", codex: "#f97583",
    cursor: "#b392f0", kimi: "#ffdf5d", iflow: "#56d364",
  };
  return map[agent.toLowerCase()] ?? C.text2;
}

const tbtn: React.CSSProperties = {
  background: "none", border: "none", color: C.text2, cursor: "pointer",
  padding: "2px 5px", borderRadius: 4, fontSize: 12,
  display: "flex", alignItems: "center", gap: 4,
};

// ── MemoryCard ────────────────────────────────────────────────────────────────
function MemoryCard({ mem, onDelete, onPin }: {
  mem: Memory;
  onDelete: (id: string) => void;
  onPin:    (id: string, pinned: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const short = mem.content.length > 160 && !expanded;
  return (
    <div style={{
      background: mem.pinned ? "rgba(121,184,255,.05)" : C.bg2,
      border: `1px solid ${mem.pinned ? "rgba(121,184,255,.18)" : C.border}`,
      borderRadius: 8, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6,
    }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{
          width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
          background: agentColor(mem.agent),
          boxShadow: `0 0 5px ${agentColor(mem.agent)}88`,
        }} />
        <span style={{ fontSize: 11, color: agentColor(mem.agent), fontWeight: 600, fontFamily: "-apple-system,system-ui,sans-serif" }}>
          {mem.agent}
        </span>
        {mem.pinned && (
          <span style={{ fontSize: 9, color: C.blue, fontFamily: "-apple-system,system-ui,sans-serif",
            background: "rgba(121,184,255,.12)", border: `1px solid rgba(121,184,255,.2)`,
            borderRadius: 3, padding: "1px 5px", letterSpacing: ".05em" }}>PINNED</span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: C.text3, fontFamily: "-apple-system,system-ui,sans-serif" }}>
          {reltime(mem.timestamp)}
        </span>
      </div>

      {/* Content */}
      <p style={{
        margin: 0, fontSize: 12, color: C.text1, lineHeight: 1.65,
        fontFamily: "ui-monospace,'SF Mono',monospace",
        whiteSpace: "pre-wrap", wordBreak: "break-word",
        maxHeight: short ? 80 : "none", overflow: "hidden",
      }}>
        {short ? mem.content.slice(0, 160) + "…" : mem.content}
      </p>
      {mem.content.length > 160 && (
        <button onClick={() => setExpanded(e => !e)} style={{ ...tbtn, color: C.blue, fontSize: 11 }}>
          {expanded ? "Show less" : "Show more"}
        </button>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
        <button onClick={() => onPin(mem.id, !mem.pinned)} style={{ ...tbtn, color: mem.pinned ? C.blue : C.text2 }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.blue}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = mem.pinned ? C.blue : C.text2}>
          {mem.pinned ? "📌 Unpin" : "📌 Pin"}
        </button>
        <span style={{ flex: 1 }} />
        <button onClick={() => onDelete(mem.id)} style={{ ...tbtn, color: C.text3 }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.red}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.text3}>
          × Delete
        </button>
      </div>
    </div>
  );
}

// ── AddMemoryForm ─────────────────────────────────────────────────────────────
function AddMemoryForm({ runboxId, sessionId, onAdded }: {
  runboxId: string; sessionId: string; onAdded: () => void;
}) {
  const [open,    setOpen]    = useState(false);
  const [content, setContent] = useState("");
  const [agent,   setAgent]   = useState("claude");
  const [loading, setLoading] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (open) setTimeout(() => taRef.current?.focus(), 30); }, [open]);

  const submit = async () => {
    if (!content.trim()) return;
    setLoading(true);
    try {
      await invoke("memory_add", {
        runboxId, sessionId, agent, content: content.trim(),
      });
      setContent(""); setOpen(false); onAdded();
    } catch (e) {
      console.error("[memory] add failed:", e);
    } finally { setLoading(false); }
  };

  if (!open) return (
    <button onClick={() => setOpen(true)} style={{
      display: "flex", alignItems: "center", gap: 6, width: "100%",
      padding: "8px 12px", background: "transparent",
      border: `1px dashed ${C.border}`, borderRadius: 7,
      color: C.text2, fontSize: 12, cursor: "pointer",
      fontFamily: "-apple-system,system-ui,sans-serif",
    }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = C.borderHi; (e.currentTarget as HTMLElement).style.color = C.text1; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = C.border; (e.currentTarget as HTMLElement).style.color = C.text2; }}>
      <span style={{ fontSize: 15, fontWeight: 300 }}>+</span> Add memory
    </button>
  );

  return (
    <div style={{ background: C.bg2, border: `1px solid ${C.borderHi}`, borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      <textarea
        ref={taRef}
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder="What should be remembered…"
        rows={3}
        style={{
          background: C.bg0, border: `1px solid ${C.border}`, borderRadius: 6,
          color: C.text0, fontSize: 12, padding: "8px 10px", resize: "vertical",
          fontFamily: "ui-monospace,'SF Mono',monospace", outline: "none", lineHeight: 1.6,
        }}
        onFocus={e => e.currentTarget.style.borderColor = C.borderHi}
        onBlur={e => e.currentTarget.style.borderColor = C.border}
        onKeyDown={e => { if (e.key === "Escape") setOpen(false); }}
      />
      {/* Agent selector */}
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        {["claude","gemini","codex","cursor","kimi","iflow","custom"].map(a => (
          <button key={a} onClick={() => setAgent(a)} style={{
            padding: "3px 9px", borderRadius: 5, fontSize: 11, cursor: "pointer",
            background: agent === a ? C.bg4 : "transparent",
            border: `1px solid ${agent === a ? C.borderHi : C.border}`,
            color: agent === a ? C.text0 : C.text2,
            fontFamily: "-apple-system,system-ui,sans-serif",
          }}>{a}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={() => setOpen(false)} style={{ ...tbtn, color: C.text2, padding: "6px 12px" }}>Cancel</button>
        <button onClick={submit} disabled={loading || !content.trim()} style={{
          flex: 1, padding: "7px 0", background: loading ? C.bg3 : C.text0,
          border: "none", borderRadius: 6, color: "#131313", fontSize: 12,
          fontWeight: 700, cursor: loading ? "default" : "pointer",
          fontFamily: "-apple-system,system-ui,sans-serif",
        }}>{loading ? "Saving…" : "Save memory"}</button>
      </div>
    </div>
  );
}

// ── SessionList ───────────────────────────────────────────────────────────────
function SessionList({ runboxId }: { runboxId: string }) {
  const [sessions, setSessions] = useState<DbSession[]>([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    setLoading(true);
    invoke<DbSession[]>("db_sessions_for_runbox", { runboxId })
      .then(setSessions)
      .catch(e => console.error("[db] sessions:", e))
      .finally(() => setLoading(false));
  }, [runboxId]);

  if (loading) return <Spinner />;
  if (!sessions.length) return <Empty text="No sessions recorded yet." />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {sessions.map(s => (
        <div key={s.id} style={{
          background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 8,
          padding: "9px 12px", display: "flex", flexDirection: "column", gap: 4,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{
              width: 5, height: 5, borderRadius: "50%",
              background: s.ended_at ? C.text3 : C.green,
              boxShadow: s.ended_at ? "none" : `0 0 4px ${C.green}`,
              flexShrink: 0,
            }} />
            <span style={{ fontSize: 11, color: agentColor(s.agent), fontWeight: 600, fontFamily: "-apple-system,system-ui,sans-serif" }}>{s.agent}</span>
            <span style={{ fontSize: 10, color: C.text2, fontFamily: "ui-monospace,'SF Mono',monospace", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {s.pane_id} · {s.cwd}
            </span>
            <span style={{ fontSize: 10, color: C.text3, flexShrink: 0, fontFamily: "-apple-system,system-ui,sans-serif" }}>{reltime(s.started_at)}</span>
          </div>
          {s.ended_at && (
            <span style={{ fontSize: 10, color: C.text3, fontFamily: "-apple-system,system-ui,sans-serif" }}>
              ended {reltime(s.ended_at)} · exit {s.exit_code ?? "?"}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ── FileChangeList ────────────────────────────────────────────────────────────
function FileChangeList({ runboxId }: { runboxId: string }) {
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    invoke<FileChange[]>("db_file_changes_for_runbox", { runboxId })
      .then(setChanges)
      .catch(e => console.error("[db] file_changes:", e))
      .finally(() => setLoading(false));
  }, [runboxId]);

  if (loading) return <Spinner />;
  if (!changes.length) return <Empty text="No file changes recorded yet." />;

  const typeColor: Record<string, string> = {
    created: C.green, modified: C.yellow, deleted: C.red,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {changes.map(fc => (
        <div key={fc.id} style={{
          background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 7,
          padding: "8px 12px", display: "flex", flexDirection: "column", gap: 3,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: ".07em",
              color: typeColor[fc.change_type] ?? C.text2,
              fontFamily: "-apple-system,system-ui,sans-serif",
              background: `${typeColor[fc.change_type] ?? C.text2}18`,
              border: `1px solid ${typeColor[fc.change_type] ?? C.text2}33`,
              borderRadius: 3, padding: "1px 5px",
              textTransform: "uppercase",
            }}>{fc.change_type}</span>
            <span style={{ fontSize: 11, color: C.text1, fontFamily: "ui-monospace,'SF Mono',monospace", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fc.file_path}</span>
            <span style={{ fontSize: 10, color: C.text3, flexShrink: 0, fontFamily: "-apple-system,system-ui,sans-serif" }}>{reltime(fc.timestamp)}</span>
          </div>
          {fc.diff && (
            <pre style={{
              margin: 0, fontSize: 10, color: C.text2, lineHeight: 1.5,
              fontFamily: "ui-monospace,'SF Mono',monospace",
              background: C.bg0, borderRadius: 4, padding: "5px 8px",
              maxHeight: 80, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all",
            }}>{fc.diff}</pre>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Small shared atoms ────────────────────────────────────────────────────────
function Spinner() {
  return (
    <div style={{ padding: "28px 0", display: "flex", justifyContent: "center" }}>
      <div style={{
        width: 18, height: 18, borderRadius: "50%",
        border: `2px solid ${C.border}`, borderTopColor: C.blue,
        animation: "spin .7s linear infinite",
      }} />
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{ padding: "28px 14px", textAlign: "center", fontSize: 12, color: C.text3, fontFamily: "-apple-system,system-ui,sans-serif" }}>
      {text}
    </div>
  );
}

// ── MemoryPanel (exported) ────────────────────────────────────────────────────
export default function MemoryPanel({ runboxId, runboxName, onClose }: {
  runboxId:   string;
  runboxName: string;
  onClose:    () => void;
}) {
  const [tab,      setTab]      = useState<Tab>("memories");
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  // Fake session id for manually-added memories (no active PTY session context here)
  const manualSessionId = `manual-${runboxId}`;

  const loadMemories = useCallback(() => {
    setLoading(true);
    setError(null);
    invoke<Memory[]>("memory_list", { runboxId })
      .then(data => {
        // Pinned first, then by timestamp desc
        const sorted = [...data].sort((a, b) => {
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
          return b.timestamp - a.timestamp;
        });
        setMemories(sorted);
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [runboxId]);

  useEffect(() => { loadMemories(); }, [loadMemories]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await invoke("memory_delete", { id });
      setMemories(prev => prev.filter(m => m.id !== id));
    } catch (e) { console.error("[memory] delete:", e); }
  }, []);

  const handlePin = useCallback(async (id: string, pinned: boolean) => {
    try {
      await invoke("memory_pin", { id, pinned });
      setMemories(prev => {
        const updated = prev.map(m => m.id === id ? { ...m, pinned } : m);
        return [...updated].sort((a, b) => {
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
          return b.timestamp - a.timestamp;
        });
      });
    } catch (e) { console.error("[memory] pin:", e); }
  }, []);

  const tabStyle = (t: Tab): React.CSSProperties => ({
    flex: 1, padding: "7px 0", background: "none", border: "none",
    borderBottom: `2px solid ${tab === t ? C.blue : "transparent"}`,
    color: tab === t ? C.text0 : C.text2,
    fontSize: 11, fontWeight: tab === t ? 600 : 400,
    cursor: "pointer", fontFamily: "-apple-system,system-ui,sans-serif",
    letterSpacing: ".04em", textTransform: "uppercase",
    transition: "color .15s",
  });

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      background: C.bg1, borderLeft: `1px solid ${C.border}`,
    }}>
      {/* Header */}
      <div style={{
        padding: "11px 14px 0", flexShrink: 0,
        borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.text0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "-apple-system,system-ui,sans-serif" }}>
            {runboxName}
          </span>
          <button onClick={onClose} style={{ ...tbtn, fontSize: 16, color: C.text2 }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.text0}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.text2}>×</button>
        </div>
        {/* Tabs */}
        <div style={{ display: "flex" }}>
          <button style={tabStyle("memories")} onClick={() => setTab("memories")}>Memories</button>
          <button style={tabStyle("sessions")} onClick={() => setTab("sessions")}>Sessions</button>
          <button style={tabStyle("files")}    onClick={() => setTab("files")}>Files</button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 12px 16px" }}>
        {tab === "memories" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <AddMemoryForm
              runboxId={runboxId}
              sessionId={manualSessionId}
              onAdded={loadMemories}
            />
            {loading && <Spinner />}
            {!loading && error && (
              <div style={{ fontSize: 12, color: C.red, padding: "8px 0", fontFamily: "-apple-system,system-ui,sans-serif" }}>
                {error}
              </div>
            )}
            {!loading && !error && memories.length === 0 && <Empty text="No memories yet. Add one above." />}
            {!loading && memories.map(m => (
              <MemoryCard key={m.id} mem={m} onDelete={handleDelete} onPin={handlePin} />
            ))}
          </div>
        )}
        {tab === "sessions" && <SessionList runboxId={runboxId} />}
        {tab === "files"    && <FileChangeList runboxId={runboxId} />}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}