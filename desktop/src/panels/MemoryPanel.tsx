// src/panels/MemoryPanel.tsx — Supercontext V3
import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { C, MONO, SANS } from "../shared/constants";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Memory {
  id: string; runbox_id: string; session_id: string;
  content: string; pinned: boolean; timestamp: number;
  branch: string; commit_type: string; tags: string;
  parent_id: string; agent_name: string;
  memory_type: string; importance: number; resolved: boolean;
  decay_at: number; scope: string; agent_type: string;
  // V3
  level: string; agent_id: string; key: string;
}

type Tab = "LOCKED" | "PREFERRED" | "TEMPORARY" | "SESSION" | "all" | "context";

// ── Level metadata ─────────────────────────────────────────────────────────────

const LEVEL_META: Record<string, { label: string; icon: string; color: string; bg: string; desc: string }> = {
  LOCKED:    { label: "Locked",    icon: "🔒", color: "#e8c87a", bg: "rgba(232,200,122,.07)", desc: "Hard constraints. Set by you. Agents can never violate these." },
  PREFERRED: { label: "Preferred", icon: "◎",  color: "#6898c0", bg: "rgba(104,152,192,.07)", desc: "Persistent facts. Key-versioned — writing port=3456 resolves old port=3000." },
  TEMPORARY: { label: "Temporary", icon: "⏳", color: "#8a9ab0", bg: "rgba(138,154,176,.07)", desc: "Agent working notes. Private per agent. Auto-expires when session ends." },
  SESSION:   { label: "Sessions",  icon: "⌛", color: "#9080c0", bg: "rgba(144,128,192,.07)", desc: "End-of-session summaries. Last 3 per agent kept. Agents see each other's." },
  all:       { label: "All",       icon: "≡",  color: C.t2,      bg: "transparent",           desc: "All memories across all levels." },
  context:   { label: "Context",   icon: "↺",  color: "#9080c0", bg: "transparent",           desc: "What agents receive when they call memory_context()." },
};

const AGENT_COLOR: Record<string, { fg: string; bg: string }> = {
  "claude-code": { fg: "#a88840", bg: "rgba(168,136,64,.10)" },
  "codex":       { fg: "#4a8f55", bg: "rgba(74,143,85,.10)"  },
  "gemini":      { fg: "#4a78a8", bg: "rgba(74,120,168,.10)" },
  "cursor":      { fg: "#8850a8", bg: "rgba(136,80,168,.10)" },
  "copilot":     { fg: "#4a68a8", bg: "rgba(74,104,168,.10)" },
  "human":       { fg: "#585858", bg: "rgba(88,88,88,.10)"   },
};
const agentStyle = (at: string) => AGENT_COLOR[at?.toLowerCase()] ?? { fg: "#555", bg: "rgba(85,85,85,.10)" };

function reltime(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60_000)     return "just now";
  if (d < 3_600_000)  return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

function effectiveLevel(m: Memory): string {
  if (m.level && m.level !== "") return m.level;
  // Derive from V2 memory_type for legacy rows
  const mt = m.memory_type || "";
  if (mt === "goal")        return "LOCKED";
  if (mt === "session")     return "SESSION";
  if (mt === "blocker")     return "TEMPORARY";
  if (mt === "environment" || mt === "codebase" || mt === "failure") return "PREFERRED";
  return "PREFERRED";
}

const tbtn: React.CSSProperties = {
  background: "none", border: "none", color: C.t2, cursor: "pointer",
  padding: "3px 8px", borderRadius: 6, fontSize: 11,
  display: "flex", alignItems: "center", gap: 3,
  fontFamily: SANS, transition: "all .1s",
};

// ── Level badge ────────────────────────────────────────────────────────────────

function LevelBadge({ level }: { level: string }) {
  const m = LEVEL_META[level]; if (!m) return null;
  return (
    <span style={{ fontSize: 9, fontFamily: MONO, padding: "2px 7px", borderRadius: 5, color: m.color, background: m.bg, border: `1px solid ${m.color}33`, letterSpacing: ".04em", display: "inline-flex", alignItems: "center", gap: 3 }}>
      {m.icon} {m.label.toUpperCase()}
    </span>
  );
}

// ── Health bar ─────────────────────────────────────────────────────────────────

function HealthBar({ memories }: { memories: Memory[] }) {
  const locked    = memories.filter(m => effectiveLevel(m) === "LOCKED" && !m.resolved);
  const preferred = memories.filter(m => effectiveLevel(m) === "PREFERRED" && !m.resolved);
  const sessions  = memories.filter(m => effectiveLevel(m) === "SESSION" && !m.resolved);
  if (locked.length === 0 && preferred.length === 0) return null;

  const stats = [
    { v: locked.length,    label: "locked rules",   color: "#e8c87a" },
    { v: preferred.length, label: "preferred facts", color: "#6898c0" },
    { v: sessions.length,  label: "sessions",        color: "#9080c0" },
  ].filter(s => s.v > 0);

  return (
    <div style={{ margin: "6px 10px 0", padding: "9px 12px", background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 10, flexShrink: 0 }}>
      <div style={{ fontSize: 9, fontFamily: MONO, letterSpacing: ".10em", color: C.t3, marginBottom: 7 }}>MEMORY HEALTH</div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        {stats.map(({ v, label, color }) => (
          <div key={label} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: 17, fontFamily: MONO, fontWeight: 700, color, letterSpacing: "-.02em" }}>{v}</span>
            <span style={{ fontSize: 9, color: C.t2, fontFamily: MONO }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── MemCard V3 ─────────────────────────────────────────────────────────────────

function MemCard({ mem, onDelete, onPin, onEdit, isLocked }: {
  mem: Memory;
  onDelete: (id: string) => void;
  onPin: (id: string, p: boolean) => void;
  onEdit: (id: string, c: string) => void;
  isLocked: boolean;
}) {
  const [expanded,    setExpanded]    = useState(false);
  const [editing,     setEditing]     = useState(false);
  const [editContent, setEditContent] = useState(mem.content);
  const [saving,      setSaving]      = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setEditContent(mem.content); }, [mem.content]);
  useEffect(() => { if (editing) setTimeout(() => taRef.current?.focus(), 20); }, [editing]);

  const level   = effectiveLevel(mem);
  const meta    = LEVEL_META[level] ?? LEVEL_META["PREFERRED"];
  const isLong  = mem.content.length > 280;
  const as_     = agentStyle(mem.agent_type || mem.agent_name || "human");

  const saveEdit = async () => {
    setSaving(true);
    try { await onEdit(mem.id, editContent.trim()); setEditing(false); }
    finally { setSaving(false); }
  };

  const borderLeft = level === "LOCKED"    ? "3px solid rgba(232,200,122,.5)"
    : level === "TEMPORARY" ? "3px solid rgba(138,154,176,.4)"
    : undefined;

  return (
    <div style={{ background: meta.bg, border: `1px solid ${meta.color}22`, borderLeft, borderRadius: 10, padding: "11px 13px", display: "flex", flexDirection: "column", gap: 8 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
        <LevelBadge level={level} />
        {mem.key && mem.key.length > 0 && level === "PREFERRED" && (
          <span style={{ fontSize: 9, fontFamily: MONO, color: C.t3, background: C.bg4, border: `1px solid ${C.border}`, borderRadius: 5, padding: "2px 6px" }}>
            key:{mem.key}
          </span>
        )}
        {mem.resolved && (
          <span style={{ fontSize: 9, fontFamily: MONO, color: "#70c878", background: "rgba(112,200,120,.10)", border: "1px solid rgba(112,200,120,.25)", borderRadius: 5, padding: "2px 7px" }}>✓ resolved</span>
        )}
        {mem.pinned && <span style={{ fontSize: 10 }}>📌</span>}
        <span style={{ flex: 1 }} />
        {(mem.agent_id || mem.agent_type || mem.agent_name) && (() => {
          const label = mem.agent_id
            ? mem.agent_id.split(":")[0]
            : (mem.agent_type || mem.agent_name);
          return (
            <span style={{ fontSize: 9, fontFamily: MONO, fontWeight: 600, color: as_.fg, background: as_.bg, border: `1px solid ${as_.fg}44`, borderRadius: 5, padding: "2px 6px" }}>
              {label}
            </span>
          );
        })()}
        <span style={{ fontSize: 10, fontFamily: MONO, color: C.t3 }}>{reltime(mem.timestamp)}</span>
      </div>

      {/* Content */}
      {editing ? (
        <textarea ref={taRef} value={editContent} onChange={e => setEditContent(e.target.value)}
          rows={Math.max(3, editContent.split("\n").length + 1)}
          onKeyDown={e => {
            if (e.key === "Escape") { setEditing(false); setEditContent(mem.content); }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveEdit();
          }}
          style={{ background: C.bg0, border: `1px solid ${C.borderHi}`, borderRadius: 8, color: C.t0, fontSize: 12.5, padding: "9px 11px", resize: "vertical", fontFamily: MONO, outline: "none", lineHeight: 1.65, width: "100%", boxSizing: "border-box" }} />
      ) : (
        <p style={{ margin: 0, fontSize: 12.5, color: C.t1, lineHeight: 1.65, fontFamily: MONO, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: isLong && !expanded ? 200 : "none", overflow: "hidden" }}>
          {mem.content}
        </p>
      )}
      {!editing && isLong && (
        <button onClick={() => setExpanded(v => !v)} style={{ ...tbtn, padding: 0, fontSize: 10, color: "#6090d0", alignSelf: "flex-start" }}>
          {expanded ? "↑ less" : "↓ more"}
        </button>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
        {editing ? (
          <>
            <button onClick={saveEdit} disabled={saving} style={{ ...tbtn, background: C.bg4, border: `1px solid ${C.borderMd}`, color: saving ? C.t2 : C.t0 }}>{saving ? "Saving…" : "✓ Save"}</button>
            <button onClick={() => { setEditing(false); setEditContent(mem.content); }} style={{ ...tbtn, color: C.t2 }}>Cancel</button>
          </>
        ) : (
          <>
            {!isLocked && (
              <>
                <button onClick={() => setEditing(true)} style={{ ...tbtn, color: C.t2 }} onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.t0} onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.t2}>Edit</button>
                <button onClick={() => onPin(mem.id, !mem.pinned)} style={{ ...tbtn, color: C.t2 }} onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.t0} onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.t2}>{mem.pinned ? "Unpin" : "Pin"}</button>
              </>
            )}
          </>
        )}
        <span style={{ flex: 1 }} />
        <button onClick={() => onDelete(mem.id)} style={{ ...tbtn, color: C.t3 }} onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.red} onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.t3}>Delete</button>
      </div>
    </div>
  );
}

// ── Add Locked form ────────────────────────────────────────────────────────────

function AddLockedForm({ runboxId, onAdded }: { runboxId: string; onAdded: () => void }) {
  const [open,    setOpen]    = useState(false);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (open) setTimeout(() => taRef.current?.focus(), 30); }, [open]);

  const submit = async () => {
    if (!content.trim()) return;
    setLoading(true);
    try {
      await invoke("memory_add_locked", { runboxId, sessionId: `panel-${runboxId}`, content: content.trim() });
      setContent(""); setOpen(false); onAdded();
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  if (!open) return (
    <button onClick={() => setOpen(true)} style={{ width: "100%", padding: "9px 14px", borderRadius: 9, background: "transparent", border: `1px dashed rgba(232,200,122,.3)`, color: "#e8c87a", fontSize: 11, fontFamily: SANS, cursor: "pointer", transition: "all .15s", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
      onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = "rgba(232,200,122,.07)"; el.style.borderColor = "rgba(232,200,122,.5)"; }}
      onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.borderColor = "rgba(232,200,122,.3)"; }}>
      🔒 Add locked rule
    </button>
  );

  return (
    <div style={{ background: "rgba(232,200,122,.06)", border: `1px solid rgba(232,200,122,.25)`, borderRadius: 11, padding: 13, display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ fontSize: 10, fontFamily: MONO, color: "#e8c87a", letterSpacing: ".06em" }}>🔒 NEW LOCKED RULE</div>
      <textarea ref={taRef} value={content} onChange={e => setContent(e.target.value)}
        placeholder={"UI is black/white only — client requirement\nnever touch login-app/app.js\nno new npm dependencies"}
        rows={3}
        onKeyDown={e => { if (e.key === "Escape") { setOpen(false); setContent(""); } if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}
        style={{ background: C.bg0, border: `1px solid rgba(232,200,122,.3)`, borderRadius: 8, color: C.t0, fontSize: 12.5, padding: "9px 11px", resize: "vertical", fontFamily: MONO, outline: "none", lineHeight: 1.65, width: "100%", boxSizing: "border-box" }} />
      <div style={{ display: "flex", gap: 7 }}>
        <button onClick={() => { setOpen(false); setContent(""); }} style={{ padding: "7px 13px", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.t2, fontSize: 11, fontFamily: SANS, cursor: "pointer" }}>Cancel</button>
        <button onClick={submit} disabled={loading || !content.trim()} style={{ flex: 1, padding: "7px 0", borderRadius: 8, border: "none", background: content.trim() && !loading ? "#e8c87a" : C.bg4, color: content.trim() && !loading ? "#111" : C.t2, fontSize: 12, fontWeight: 600, fontFamily: SANS, cursor: content.trim() && !loading ? "pointer" : "default", transition: "all .15s" }}>
          {loading ? "Saving…" : "🔒 Lock it"}
        </button>
      </div>
    </div>
  );
}

// ── Add Preferred form ─────────────────────────────────────────────────────────

function AddPreferredForm({ runboxId, onAdded }: { runboxId: string; onAdded: () => void }) {
  const [open,    setOpen]    = useState(false);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (open) setTimeout(() => taRef.current?.focus(), 30); }, [open]);

  const submit = async () => {
    if (!content.trim()) return;
    setLoading(true);
    try {
      await invoke("memory_remember", {
        runboxId,
        sessionId: `panel-${runboxId}`,
        agentId:   `human:panel-${runboxId}`,
        agentName: "human",
        content:   content.trim(),
        level:     "PREFERRED",
      });
      setContent(""); setOpen(false); onAdded();
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  if (!open) return (
    <button onClick={() => setOpen(true)} style={{ width: "100%", padding: "9px 14px", borderRadius: 9, background: "transparent", border: `1px dashed ${C.border}`, color: C.t2, fontSize: 11, fontFamily: SANS, cursor: "pointer", transition: "all .15s", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
      onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = C.bg2; el.style.borderColor = C.borderMd; el.style.color = C.t0; }}
      onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.borderColor = C.border; el.style.color = C.t2; }}>
      <span style={{ fontSize: 16, fontWeight: 300 }}>+</span> Add fact
    </button>
  );

  return (
    <div style={{ background: "rgba(104,152,192,.06)", border: `1px solid rgba(104,152,192,.25)`, borderRadius: 11, padding: 13, display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ fontSize: 10, fontFamily: MONO, color: "#6898c0", letterSpacing: ".06em" }}>◎ NEW PREFERRED FACT</div>
      <div style={{ fontSize: 10, color: C.t3, fontFamily: MONO }}>Key=value for env: port=3456, node=v18. One atomic fact per save.</div>
      <textarea ref={taRef} value={content} onChange={e => setContent(e.target.value)}
        placeholder={"port=3456\npython not available — use node/npm\napi base url=https://api.example.com/v2"}
        rows={3}
        onKeyDown={e => { if (e.key === "Escape") { setOpen(false); setContent(""); } if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}
        style={{ background: C.bg0, border: `1px solid rgba(104,152,192,.3)`, borderRadius: 8, color: C.t0, fontSize: 12.5, padding: "9px 11px", resize: "vertical", fontFamily: MONO, outline: "none", lineHeight: 1.65, width: "100%", boxSizing: "border-box" }} />
      <div style={{ display: "flex", gap: 7 }}>
        <button onClick={() => { setOpen(false); setContent(""); }} style={{ padding: "7px 13px", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.t2, fontSize: 11, fontFamily: SANS, cursor: "pointer" }}>Cancel</button>
        <button onClick={submit} disabled={loading || !content.trim()} style={{ flex: 1, padding: "7px 0", borderRadius: 8, border: "none", background: content.trim() && !loading ? "#6898c0" : C.bg4, color: content.trim() && !loading ? "#fff" : C.t2, fontSize: 12, fontWeight: 600, fontFamily: SANS, cursor: content.trim() && !loading ? "pointer" : "default", transition: "all .15s" }}>
          {loading ? "Saving…" : "◎ Save fact"}
        </button>
      </div>
    </div>
  );
}

// ── Context preview ────────────────────────────────────────────────────────────

function ContextPreview({ runboxId }: { runboxId: string }) {
  const [context, setContext] = useState("");
  const [task,    setTask]    = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (t: string) => {
    setLoading(true);
    try { setContext(await invoke<string>("memory_get_context", { runboxId, task: t || null }) || "No context yet."); }
    catch { setContext("Failed to load context."); }
    finally { setLoading(false); }
  }, [runboxId]);

  useEffect(() => { load(""); }, [load]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, height: "100%", padding: "8px 10px 0" }}>
      <div style={{ fontSize: 9, fontFamily: MONO, letterSpacing: ".10em", color: C.t3 }}>WHAT AGENTS RECEIVE — memory_context(task=…)</div>
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        <input value={task} onChange={e => setTask(e.target.value)} placeholder="task (optional — improves ranking)" onKeyDown={e => e.key === "Enter" && load(task)}
          style={{ flex: 1, background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 8, color: C.t0, fontSize: 11, padding: "7px 10px", outline: "none", fontFamily: MONO }} />
        <button onClick={() => load(task)} disabled={loading} style={{ padding: "7px 12px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg3, color: loading ? C.t2 : C.t0, fontSize: 11, fontFamily: SANS, cursor: loading ? "default" : "pointer" }}>{loading ? "…" : "↺"}</button>
      </div>
      <div style={{ flex: 1, overflow: "auto", paddingBottom: 16 }}>
        <pre style={{ margin: 0, fontSize: 11.5, fontFamily: MONO, color: C.t1, lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word", background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px" }}>{context}</pre>
      </div>
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────────

export default function MemoryPanel({ runboxId, runboxName, onClose }: { runboxId: string; runboxName: string; onClose: () => void }) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [dbReady,  setDbReady]  = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [tab,      setTab]      = useState<Tab>("LOCKED");
  const [search,   setSearch]   = useState("");
  const [toast,    setToast]    = useState<{ msg: string; color: string } | null>(null);

  const showToast = useCallback((msg: string, color = "#70c878") => {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // Wait for DB ready
  useEffect(() => {
    let cancelled = false;
    const readyUnsub = listen<void>("memory-ready", () => { if (!cancelled) setDbReady(true); });
    const errorUnsub = listen<string>("memory-error", ({ payload }) => { if (!cancelled) { setError(`Memory error: ${payload}`); setLoading(false); } });
    let attempt = 0;
    const DELAYS = [300, 600, 1000, 1500, 2000, 2500, 3000, 3000, 3000, 3000];
    (async () => {
      while (!cancelled) {
        try { await invoke("memory_list", { runboxId }); if (!cancelled) setDbReady(true); return; }
        catch (e) {
          const msg = String(e).toLowerCase();
          if (msg.includes("not initialised") && attempt < DELAYS.length) { await new Promise(r => setTimeout(r, DELAYS[attempt++])); }
          else if (!msg.includes("not initialised")) { if (!cancelled) { setError(String(e)); setLoading(false); } return; }
          else { if (!cancelled) { setError("Memory took too long. Click Retry."); setLoading(false); } return; }
        }
      }
    })();
    return () => { cancelled = true; readyUnsub.then(f => f()); errorUnsub.then(f => f()); };
  }, [runboxId, retryKey]);

  const loadAll = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [mine, global] = await Promise.all([
        invoke<Memory[]>("memory_list", { runboxId }),
        invoke<Memory[]>("memory_list", { runboxId: "__global__" }),
      ]);
      setMemories([...mine, ...global]);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [runboxId]);

  useEffect(() => { if (dbReady) loadAll(); }, [dbReady, loadAll]);

  useEffect(() => {
    if (!dbReady) return;
    const u = listen<{ runbox_id: string }>("memory-added", ({ payload }) => {
      if (payload.runbox_id === runboxId || payload.runbox_id === "__global__") loadAll();
    });
    return () => { u.then(fn => fn()); };
  }, [dbReady, runboxId, loadAll]);

  const handleDelete = useCallback(async (id: string) => {
    await invoke("memory_delete", { id });
    setMemories(p => p.filter(m => m.id !== id));
  }, []);

  const handlePin = useCallback(async (id: string, pinned: boolean) => {
    await invoke("memory_pin", { id, pinned });
    setMemories(p => p.map(m => m.id === id ? { ...m, pinned } : m));
  }, []);

  const handleEdit = useCallback(async (id: string, content: string) => {
    await invoke("memory_update", { id, content });
    setMemories(p => p.map(m => m.id === id ? { ...m, content } : m));
  }, []);

  // Per-level filtered lists
  const byLevel = (l: string) => memories.filter(m => effectiveLevel(m) === l && !m.resolved);
  const locked    = byLevel("LOCKED");
  const preferred = byLevel("PREFERRED");
  const temporary = byLevel("TEMPORARY");
  const session   = byLevel("SESSION");

  const tabMemories: Record<Tab, Memory[]> = {
    LOCKED:    locked,
    PREFERRED: preferred,
    TEMPORARY: temporary,
    SESSION:   session,
    all:       memories.filter(m => !m.resolved),
    context:   [],
  };

  const visible = tab === "context"
    ? []
    : (tabMemories[tab] ?? []).filter(m =>
        !search.trim() || [m.content, m.tags, m.key, m.agent_id].join(" ").toLowerCase().includes(search.toLowerCase())
      );

  const TABS: { id: Tab; icon: string; label: string; count?: number; color?: string }[] = [
    { id: "LOCKED",    icon: "🔒", label: "Locked",    count: locked.length,    color: "#e8c87a" },
    { id: "PREFERRED", icon: "◎",  label: "Preferred", count: preferred.length, color: "#6898c0" },
    { id: "TEMPORARY", icon: "⏳", label: "Temporary", count: temporary.length, color: "#8a9ab0" },
    { id: "SESSION",   icon: "⌛", label: "Sessions",  count: session.length,   color: "#9080c0" },
    { id: "all",       icon: "≡",  label: "All",       count: memories.filter(m => !m.resolved).length },
    { id: "context",   icon: "↺",  label: "Context",   color: "#9080c0" },
  ];

  if (!dbReady) return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg1, alignItems: "center", justifyContent: "center", gap: 12, padding: "0 24px" }}>
      {!error
        ? (<><div style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${C.border}`, borderTopColor: C.t1, animation: "spin .7s linear infinite" }} /><span style={{ fontSize: 12, color: C.t2, fontFamily: SANS }}>Initialising memory…</span></>)
        : (<><span style={{ fontSize: 11, color: C.t2, fontFamily: SANS, textAlign: "center", lineHeight: 1.6 }}>{error}</span><button onClick={() => { setError(null); setDbReady(false); setLoading(true); setRetryKey(k => k + 1); }} style={{ padding: "6px 14px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg2, color: C.t1, fontSize: 11, fontFamily: SANS, cursor: "pointer" }}>Retry</button></>)
      }
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg1 }}>

      {/* Header */}
      <div style={{ padding: "12px 14px 11px", flexShrink: 0, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.t0, flex: 1, fontFamily: SANS, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{runboxName}</span>
        {loading && <div style={{ width: 12, height: 12, borderRadius: "50%", border: `2px solid ${C.border}`, borderTopColor: C.t1, animation: "spin .7s linear infinite", flexShrink: 0 }} />}
        <button onClick={onClose} style={{ background: "none", border: "none", color: C.t2, cursor: "pointer", padding: "4px 6px", borderRadius: 8, fontSize: 14 }}
          onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = C.bg3; el.style.color = C.t0; }}
          onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.color = C.t2; }}>✕</button>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{ margin: "6px 10px 0", padding: "8px 11px", background: `${toast.color}18`, border: `1px solid ${toast.color}44`, borderRadius: 8, fontSize: 11, color: toast.color, fontFamily: SANS, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{ flex: 1, lineHeight: 1.4 }}>{toast.msg}</span>
          <button onClick={() => setToast(null)} style={{ background: "none", border: "none", color: toast.color, cursor: "pointer", fontSize: 14, padding: 0 }}>×</button>
        </div>
      )}

      {/* Health bar */}
      <HealthBar memories={memories} />

      {/* Tabs */}
      <div style={{ padding: "8px 10px 0", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 3 }}>
          {TABS.map(({ id, icon, label, count, color }) => {
            const on = tab === id;
            return (
              <button key={id} onClick={() => setTab(id)} style={{ padding: "6px 2px", borderRadius: 7, border: `1px solid ${on ? (color ?? C.borderMd) + "66" : C.border}`, background: on ? (color ? `${color}18` : C.bg3) : "transparent", color: on ? (color ?? C.t0) : C.t2, fontSize: 10, fontFamily: MONO, cursor: "pointer", transition: "all .1s", display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                <span>{icon} {label}</span>
                {count !== undefined && count > 0 && <span style={{ fontSize: 9, color: on ? (color ?? C.t1) : C.t3 }}>{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab description */}
      {LEVEL_META[tab] && tab !== "context" && (
        <div style={{ padding: "5px 12px", flexShrink: 0, fontSize: 10, color: C.t3, fontFamily: SANS, borderBottom: `1px solid ${C.border}` }}>
          {LEVEL_META[tab].desc}
        </div>
      )}

      {/* Context tab */}
      {tab === "context" ? (
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <ContextPreview runboxId={runboxId} />
        </div>
      ) : (
        <>
          {/* Search */}
          <div style={{ padding: "8px 10px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
            <div style={{ position: "relative" }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={C.t2} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" style={{ width: "100%", boxSizing: "border-box", background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 8, color: C.t0, fontSize: 11, padding: "7px 28px 7px 28px", outline: "none", fontFamily: MONO }} />
              {search && <button onClick={() => setSearch("")} style={{ position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: C.t2, fontSize: 13, padding: 0 }}>×</button>}
            </div>
          </div>

          {/* Cards */}
          <div style={{ flex: 1, overflowY: "auto", padding: "10px 10px 16px", display: "flex", flexDirection: "column", gap: 7 }}>

            {/* Write form — only on LOCKED and PREFERRED tabs */}
            {tab === "LOCKED"    && <AddLockedForm    runboxId={runboxId} onAdded={() => { loadAll(); showToast("🔒 Locked rule added"); }} />}
            {tab === "PREFERRED" && <AddPreferredForm runboxId={runboxId} onAdded={() => { loadAll(); showToast("◎ Fact saved"); }} />}

            {/* Temporary read-only note */}
            {tab === "TEMPORARY" && (
              <div style={{ padding: "8px 12px", background: "rgba(138,154,176,.07)", border: `1px solid rgba(138,154,176,.2)`, borderRadius: 9, fontSize: 10, color: C.t3, fontFamily: SANS, lineHeight: 1.5 }}>
                Agents write TEMPORARY facts during tasks. They auto-expire when the session ends. Read-only from the panel.
              </div>
            )}
            {tab === "SESSION" && (
              <div style={{ padding: "8px 12px", background: "rgba(144,128,192,.07)", border: `1px solid rgba(144,128,192,.2)`, borderRadius: 9, fontSize: 10, color: C.t3, fontFamily: SANS, lineHeight: 1.5 }}>
                End-of-session summaries written by agents. Last 3 per agent kept. All agents see each other's summaries.
              </div>
            )}

            {loading && (
              <div style={{ padding: "32px 0", display: "flex", justifyContent: "center" }}>
                <div style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${C.border}`, borderTopColor: C.t1, animation: "spin .7s linear infinite" }} />
              </div>
            )}
            {!loading && error && (
              <div style={{ padding: "12px 14px", background: "rgba(200,80,80,.08)", border: `1px solid rgba(200,80,80,.18)`, borderRadius: 10, fontSize: 12, color: C.red, fontFamily: SANS }}>{error}</div>
            )}
            {!loading && !error && visible.length === 0 && (
              <div style={{ padding: "40px 0", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 22, opacity: .3 }}>{LEVEL_META[tab]?.icon ?? "○"}</span>
                <span style={{ fontSize: 12, color: C.t2, fontFamily: SANS }}>
                  {search ? "No memories match." : `No ${LEVEL_META[tab]?.label ?? ""} memories yet.`}
                </span>
              </div>
            )}
            {!loading && !error && visible.map(mem => (
              <MemCard key={mem.id} mem={mem}
                onDelete={handleDelete} onPin={handlePin} onEdit={handleEdit}
                isLocked={effectiveLevel(mem) === "LOCKED"} />
            ))}
          </div>
        </>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}