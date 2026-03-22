// src/panels/MemoryPanel.tsx — Supercontext V2
import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { C, MONO, SANS } from "../shared/constants";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Memory {
  id: string; runbox_id: string; session_id: string;
  content: string; pinned: boolean; timestamp: number;
  branch: string; commit_type: string; tags: string;
  parent_id: string; agent_name: string;
  memory_type: string; importance: number; resolved: boolean;
  decay_at: number; scope: string; agent_type: string;
  _scope?: string;
}

type MemTab = "goal" | "session" | "blocker" | "failure" | "environment" | "codebase" | "all" | "context";
type MemType = "goal" | "environment" | "codebase" | "blocker" | "failure" | "session";

// ── Metadata ──────────────────────────────────────────────────────────────────

const TYPE_META: Record<string, { label: string; icon: string; color: string; bg: string; desc: string }> = {
  goal:        { label: "Goal",     icon: "◎", color: "#e8c87a", bg: "rgba(232,200,122,.08)", desc: "What we are building — survives all sessions." },
  session:     { label: "Session",  icon: "⌛", color: "#8a9ab0", bg: "rgba(138,154,176,.07)", desc: "End-of-session summaries. Auto-generated on crash." },
  blocker:     { label: "Blockers", icon: "⚠",  color: "#d06050", bg: "rgba(208,96,80,.07)",   desc: "Unsolved dead ends. Resolve when fixed." },
  failure:     { label: "Failures", icon: "⚡", color: "#c06868", bg: "rgba(192,104,104,.07)", desc: "Resolved errors + fixes. Never decays — permanent lessons." },
  environment: { label: "Env",      icon: "⚙",  color: "#6898c0", bg: "rgba(104,152,192,.07)", desc: "Machine facts in key=value format. Unverified after 30 days." },
  codebase:    { label: "Code",     icon: "◈",  color: "#70a880", bg: "rgba(112,168,128,.07)", desc: "File/function map. Invalidated by file watcher." },
};

const AGENT_COLOR: Record<string, { fg: string; bg: string }> = {
  "claude-code": { fg: "#a88840", bg: "rgba(168,136,64,.10)" },
  "codex":       { fg: "#4a8f55", bg: "rgba(74,143,85,.10)"  },
  "gemini":      { fg: "#4a78a8", bg: "rgba(74,120,168,.10)" },
  "cursor":      { fg: "#8850a8", bg: "rgba(136,80,168,.10)" },
  "copilot":     { fg: "#4a68a8", bg: "rgba(74,104,168,.10)" },
  "human":       { fg: "#585858", bg: "rgba(88,88,88,.10)"   },
  "git":         { fg: "#505050", bg: "rgba(80,80,80,.10)"   },
};
const agentStyle = (at: string) => AGENT_COLOR[at?.toLowerCase()] ?? { fg: "#555", bg: "rgba(85,85,85,.10)" };

function reltime(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60_000)     return "just now";
  if (d < 3_600_000)  return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

function effectiveType(m: Memory): string {
  if (m.memory_type && m.memory_type !== "general") return m.memory_type;
  const t = m.tags.toLowerCase();
  if (t.includes("goal"))    return "goal";
  if (t.includes("session")) return "session";
  if (t.includes("blocker")) return "blocker";
  if (t.includes("failure")) return "failure";
  if (t.includes("environment") || t.split(",").some(p => p.trim() === "env")) return "environment";
  if (t.includes("codebase")) return "codebase";
  return "general";
}

const tbtn: React.CSSProperties = {
  background: "none", border: "none", color: C.t2, cursor: "pointer",
  padding: "3px 8px", borderRadius: 6, fontSize: 11,
  display: "flex", alignItems: "center", gap: 3,
  fontFamily: SANS, transition: "all .1s",
};

// ── Small components ──────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: string }) {
  const m = TYPE_META[type]; if (!m) return null;
  return (
    <span style={{ fontSize: 9, fontFamily: MONO, padding: "2px 7px", borderRadius: 5, color: m.color, background: m.bg, border: `1px solid ${m.color}33`, letterSpacing: ".04em", display: "inline-flex", alignItems: "center", gap: 3 }}>
      {m.icon} {m.label.toUpperCase()}
    </span>
  );
}

function ImpBadge({ imp }: { imp: number }) {
  if (imp < 70) return null;
  const c = imp >= 95 ? "#e8c87a" : imp >= 85 ? "#a0b8a0" : "#8090a8";
  return <span style={{ fontSize: 9, fontFamily: MONO, padding: "2px 6px", borderRadius: 5, color: c, background: `${c}18`, border: `1px solid ${c}33` }}>{imp}</span>;
}

// ── Feedback proxy ────────────────────────────────────────────────────────────

function FeedbackProxy({ memories }: { memories: Memory[] }) {
  const blockers  = memories.filter(m => effectiveType(m) === "blocker");
  const resolved  = blockers.filter(m => m.resolved);
  const failures  = memories.filter(m => effectiveType(m) === "failure");
  const stale     = blockers.filter(m => !m.resolved && (Date.now() - m.timestamp) > 30 * 86_400_000);
  const unverEnv  = memories.filter(m => effectiveType(m) === "environment" && m.tags.includes("unverified"));
  const resolveRate = blockers.length > 0 ? Math.round((resolved.length / blockers.length) * 100) : null;
  if (blockers.length === 0 && failures.length === 0) return null;

  const stats: { v: string | number; label: string; color: string }[] = [
    ...(resolveRate !== null ? [{ v: `${resolveRate}%`, label: "resolve rate", color: resolveRate >= 70 ? "#70c878" : resolveRate >= 40 ? "#c8b870" : "#c87070" }] : []),
    { v: failures.length, label: "lessons saved", color: "#e8c87a" },
    ...(stale.length > 0    ? [{ v: stale.length,   label: "stale blockers", color: "#c8a070" }] : []),
    ...(unverEnv.length > 0 ? [{ v: unverEnv.length, label: "unverified env", color: "#8898b0" }] : []),
  ];

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

// ── MemCard V2 ────────────────────────────────────────────────────────────────

function MemCard({ mem, allBranches, onDelete, onPin, onEdit, onMoveBranch, onUpdateTags, onResolve, onConfirmEnv }: {
  mem: Memory; allBranches: string[];
  onDelete: (id: string) => void; onPin: (id: string, p: boolean) => void;
  onEdit: (id: string, c: string) => void; onMoveBranch: (id: string, b: string) => void;
  onUpdateTags: (id: string, t: string) => void; onResolve: (m: Memory) => void; onConfirmEnv: (id: string) => void;
}) {
  const [expanded,    setExpanded]    = useState(false);
  const [editing,     setEditing]     = useState(false);
  const [editContent, setEditContent] = useState(mem.content);
  const [saving,      setSaving]      = useState(false);
  const [showMove,    setShowMove]    = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setEditContent(mem.content); }, [mem.content]);
  useEffect(() => { if (editing) setTimeout(() => taRef.current?.focus(), 20); }, [editing]);

  const mt      = effectiveType(mem);
  const isLong  = mem.content.length > 280;
  const isStale = mt === "blocker" && !mem.resolved && (Date.now() - mem.timestamp) > 30 * 86_400_000;
  const isUnver = mt === "environment" && mem.tags.includes("unverified");
  const as      = agentStyle(mem.agent_type || mem.agent_name || "human");

  const saveEdit = async () => { setSaving(true); try { await onEdit(mem.id, editContent.trim()); setEditing(false); } finally { setSaving(false); } };

  const borderLeft = isStale ? "3px solid rgba(208,150,80,.6)"
    : mt === "blocker" ? "3px solid rgba(208,96,80,.5)"
    : mt === "failure" ? "3px solid rgba(192,104,104,.5)"
    : mt === "goal"    ? "3px solid rgba(232,200,122,.5)"
    : undefined;

  return (
    <div onMouseLeave={() => setShowMove(false)} style={{ background: TYPE_META[mt]?.bg ?? C.bg2, border: `1px solid ${(TYPE_META[mt]?.color ?? "#fff") + "22"}`, borderLeft, borderRadius: 10, padding: "11px 13px", display: "flex", flexDirection: "column", gap: 8 }}>

      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
        <TypeBadge type={mt} />
        <ImpBadge imp={mem.importance} />
        {mem.resolved && <span style={{ fontSize: 9, fontFamily: MONO, color: "#70c878", background: "rgba(112,200,120,.10)", border: "1px solid rgba(112,200,120,.25)", borderRadius: 5, padding: "2px 7px" }}>✓ resolved</span>}
        {isStale  && <span style={{ fontSize: 9, fontFamily: MONO, color: "#c8a070", background: "rgba(200,160,80,.10)", border: "1px solid rgba(200,160,80,.25)", borderRadius: 5, padding: "2px 7px" }}>30d+ stale</span>}
        {isUnver  && <span style={{ fontSize: 9, fontFamily: MONO, color: "#8898b0", background: "rgba(136,152,176,.10)", border: "1px solid rgba(136,152,176,.25)", borderRadius: 5, padding: "2px 7px" }}>unverified</span>}
        {mem.scope === "machine" && <span style={{ fontSize: 9, fontFamily: MONO, color: C.t3, background: C.bg4, border: `1px solid ${C.border}`, borderRadius: 5, padding: "2px 6px" }}>machine</span>}
        {mem.pinned && <span style={{ fontSize: 10 }}>📌</span>}
        <span style={{ flex: 1 }} />
        {(mem.agent_type || mem.agent_name) && (
          <span style={{ fontSize: 9, fontFamily: MONO, fontWeight: 600, color: as.fg, background: as.bg, border: `1px solid ${as.fg}44`, borderRadius: 5, padding: "2px 6px" }}>
            {mem.agent_type || mem.agent_name}
          </span>
        )}
        <span style={{ fontSize: 10, fontFamily: MONO, color: C.t3 }}>{reltime(mem.timestamp)}</span>
      </div>

      {/* Content */}
      {editing ? (
        <textarea ref={taRef} value={editContent} onChange={e => setEditContent(e.target.value)}
          rows={Math.max(3, editContent.split("\n").length + 1)}
          onKeyDown={e => { if (e.key === "Escape") { setEditing(false); setEditContent(mem.content); } if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveEdit(); }}
          style={{ background: C.bg0, border: `1px solid ${C.borderHi}`, borderRadius: 8, color: C.t0, fontSize: 12.5, padding: "9px 11px", resize: "vertical", fontFamily: MONO, outline: "none", lineHeight: 1.65, width: "100%", boxSizing: "border-box" }} />
      ) : (
        <p style={{ margin: 0, fontSize: 12.5, color: C.t1, lineHeight: 1.65, fontFamily: MONO, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: isLong && !expanded ? 200 : "none", overflow: "hidden" }}>
          {mem.content}
        </p>
      )}
      {!editing && isLong && <button onClick={() => setExpanded(v => !v)} style={{ ...tbtn, padding: 0, fontSize: 10, color: "#6090d0", alignSelf: "flex-start" }}>{expanded ? "↑ less" : "↓ more"}</button>}

      {/* Actions */}
      <div style={{ display: "flex", gap: 3, alignItems: "center", flexWrap: "wrap" }}>
        {editing ? (
          <>
            <button onClick={saveEdit} disabled={saving} style={{ ...tbtn, background: C.bg4, border: `1px solid ${C.borderMd}`, color: saving ? C.t2 : C.t0 }}>{saving ? "Saving…" : "✓ Save"}</button>
            <button onClick={() => { setEditing(false); setEditContent(mem.content); }} style={{ ...tbtn, color: C.t2 }}>Cancel</button>
          </>
        ) : (
          <>
            {mt === "blocker" && !mem.resolved && (
              <button onClick={() => onResolve(mem)} style={{ ...tbtn, color: "#70c878", border: "1px solid rgba(112,200,120,.30)", borderRadius: 7, padding: "3px 10px", background: "rgba(112,200,120,.07)" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(112,200,120,.15)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(112,200,120,.07)"; }}>✓ Resolve</button>
            )}
            {isUnver && (
              <button onClick={() => onConfirmEnv(mem.id)} style={{ ...tbtn, color: "#8898b0", border: "1px solid rgba(136,152,176,.30)", borderRadius: 7, padding: "3px 10px", background: "rgba(136,152,176,.07)" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(136,152,176,.15)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(136,152,176,.07)"; }}>✓ Confirm</button>
            )}
            <button onClick={() => setEditing(true)} style={{ ...tbtn, color: C.t2 }} onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.t0} onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.t2}>Edit</button>
            <button onClick={() => onPin(mem.id, !mem.pinned)} style={{ ...tbtn, color: C.t2 }} onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.t0} onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.t2}>{mem.pinned ? "Unpin" : "Pin"}</button>
            {allBranches.filter(b => b !== mem.branch).length > 0 && (
              <div style={{ position: "relative" }}>
                <button onClick={() => setShowMove(v => !v)} style={{ ...tbtn, color: C.t2 }}>Move →</button>
                {showMove && (
                  <div style={{ position: "absolute", bottom: "calc(100% + 4px)", left: 0, background: C.bg5, border: `1px solid ${C.borderMd}`, borderRadius: 10, overflow: "hidden", zIndex: 200, minWidth: 140, boxShadow: "0 8px 32px rgba(0,0,0,.6)" }}>
                    {allBranches.filter(b => b !== mem.branch).map(b => (
                      <button key={b} onClick={() => { onMoveBranch(mem.id, b); setShowMove(false); }}
                        style={{ display: "flex", alignItems: "center", gap: 7, width: "100%", padding: "8px 12px", background: "none", border: "none", color: C.t1, fontSize: 11, fontFamily: MONO, cursor: "pointer" }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = C.bg4}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "none"}>
                        <span style={{ opacity: .5, fontSize: 9 }}>⎇</span>{b}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
        <span style={{ flex: 1 }} />
        <button onClick={() => onDelete(mem.id)} style={{ ...tbtn, color: C.t3 }} onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.red} onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.t3}>Delete</button>
      </div>
    </div>
  );
}

// ── Resolve modal ─────────────────────────────────────────────────────────────

function ResolveModal({ mem, runboxId, sessionId, onDone, onClose }: { mem: Memory; runboxId: string; sessionId: string; onDone: () => void; onClose: () => void }) {
  const [fix, setFix] = useState("");
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setTimeout(() => ref.current?.focus(), 20); }, []);

  const submit = async () => {
    if (!fix.trim()) return;
    setSaving(true);
    try {
      await invoke("memory_resolve_blocker", { runboxId, sessionId, agentName: "human", blockerDescription: mem.content.slice(0, 200), fix: fix.trim() });
      onDone();
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: C.bg3, border: `1px solid ${C.borderMd}`, borderRadius: 14, padding: 20, width: 420, display: "flex", flexDirection: "column", gap: 12, boxShadow: "0 16px 48px rgba(0,0,0,.8)" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.t0, fontFamily: SANS }}>Resolve Blocker</div>
        <div style={{ fontSize: 11, color: C.t2, fontFamily: MONO, background: C.bg2, borderRadius: 8, padding: "9px 11px", lineHeight: 1.6, maxHeight: 100, overflow: "auto" }}>{mem.content.slice(0, 300)}{mem.content.length > 300 ? "…" : ""}</div>
        <div>
          <label style={{ fontSize: 9, fontFamily: MONO, letterSpacing: ".10em", color: C.t3, display: "block", marginBottom: 6 }}>ROOT CAUSE + FIX APPLIED</label>
          <textarea ref={ref} value={fix} onChange={e => setFix(e.target.value)} rows={4}
            placeholder={"Root cause: ...\nFix applied: ..."}
            onKeyDown={e => { if (e.key === "Escape") onClose(); if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}
            style={{ width: "100%", boxSizing: "border-box", background: C.bg0, border: `1px solid ${C.border}`, borderRadius: 8, color: C.t0, fontSize: 12.5, padding: "10px 12px", outline: "none", fontFamily: MONO, resize: "vertical", lineHeight: 1.65, transition: "border-color .15s" }}
            onFocus={e => e.currentTarget.style.borderColor = C.borderHi}
            onBlur={e  => e.currentTarget.style.borderColor = C.border} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose} style={{ padding: "9px 16px", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.t2, fontSize: 12, fontFamily: SANS, cursor: "pointer" }}>Cancel</button>
          <button onClick={submit} disabled={saving || !fix.trim()} style={{ flex: 1, padding: "9px 0", borderRadius: 8, border: "none", background: fix.trim() && !saving ? "#70c878" : C.bg4, color: fix.trim() && !saving ? "#111" : C.t2, fontSize: 12, fontWeight: 600, fontFamily: SANS, cursor: fix.trim() && !saving ? "pointer" : "default", transition: "all .15s" }}>
            {saving ? "Resolving…" : "✓ Mark Resolved + Save Fix"}
          </button>
        </div>
        <div style={{ fontSize: 10, color: C.t3, fontFamily: SANS }}>Blocker marked resolved. Fix saved as permanent failure memory.</div>
      </div>
    </div>
  );
}

// ── Write form V2 ─────────────────────────────────────────────────────────────

function WriteForm({ runboxId, sessionId, onAdded }: { runboxId: string; sessionId: string; onAdded: () => void }) {
  const [open,    setOpen]    = useState(false);
  const [content, setContent] = useState("");
  const [memType, setMemType] = useState<MemType>("failure");
  const [scope,   setScope]   = useState<"local"|"machine">("local");
  const [loading, setLoading] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (open) setTimeout(() => taRef.current?.focus(), 30); }, [open]);
  const reset = () => { setOpen(false); setContent(""); };

  const submit = async () => {
    if (!content.trim()) return;
    setLoading(true);
    try {
      await invoke("memory_add_typed_cmd", { runboxId, sessionId, content: content.trim(), memoryType: memType, scope, agentName: "human" });
      reset(); onAdded();
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const TYPES: [MemType, string][] = [["goal","◎ Goal"],["failure","⚡ Failure"],["blocker","⚠ Blocker"],["environment","⚙ Env"],["codebase","◈ Code"],["session","⌛ Session"]];
  const PLACEHOLDERS: Record<MemType, string> = {
    goal:        "What we are building + acceptance criteria…",
    failure:     "Error: X.\nCause: Y.\nFix: Z applied.",
    blocker:     "Error: X.\nTried: Y, Z. Do not retry Y or Z.",
    environment: "node=working\npy=broken\nport=3836",
    codebase:    "src/auth/jwt.ts: JWT validation\nsrc/routes/login.tsx: login form",
    session:     "What attempted: …\nWhat changed: …\nStill open: …",
  };

  if (!open) return (
    <button onClick={() => setOpen(true)} style={{ width: "100%", padding: "10px 14px", borderRadius: 10, background: "transparent", border: `1px dashed ${C.border}`, color: C.t2, fontSize: 12, fontFamily: SANS, cursor: "pointer", transition: "all .15s", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
      onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = C.borderMd; el.style.color = C.t0; el.style.background = C.bg2; }}
      onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = C.border; el.style.color = C.t2; el.style.background = "transparent"; }}>
      <span style={{ fontSize: 17, fontWeight: 300, lineHeight: 1 }}>+</span> Add memory
    </button>
  );

  return (
    <div style={{ background: C.bg2, border: `1px solid ${C.borderMd}`, borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4 }}>
        {TYPES.map(([t, label]) => {
          const m = TYPE_META[t]; const on = memType === t;
          return <button key={t} onClick={() => setMemType(t)} style={{ padding: "7px 4px", borderRadius: 7, border: `1px solid ${on ? m.color + "55" : C.border}`, background: on ? m.bg : "transparent", color: on ? m.color : C.t2, fontSize: 10.5, fontFamily: MONO, cursor: "pointer", transition: "all .1s" }}>{label}</button>;
        })}
      </div>
      <textarea ref={taRef} value={content} onChange={e => setContent(e.target.value)} placeholder={PLACEHOLDERS[memType]} rows={memType === "environment" || memType === "codebase" ? 4 : 3}
        onKeyDown={e => { if (e.key === "Escape") reset(); }}
        style={{ background: C.bg0, border: `1px solid ${C.border}`, borderRadius: 10, color: C.t0, fontSize: 12.5, padding: "10px 12px", resize: "vertical", fontFamily: MONO, outline: "none", lineHeight: 1.65, width: "100%", boxSizing: "border-box", transition: "border-color .15s" }}
        onFocus={e => e.currentTarget.style.borderColor = C.borderHi}
        onBlur={e  => e.currentTarget.style.borderColor = C.border} />
      {memType === "environment" && (
        <div style={{ display: "flex", gap: 0, background: C.bg1, borderRadius: 8, padding: 3 }}>
          {(["local","machine"] as const).map(s => (
            <button key={s} onClick={() => setScope(s)} style={{ flex: 1, padding: "5px 0", borderRadius: 6, border: "none", background: scope === s ? C.bg4 : "transparent", color: scope === s ? C.t0 : C.t2, cursor: "pointer", fontSize: 11, fontFamily: MONO, transition: "all .1s" }}>
              {s === "local" ? "This runbox" : "This machine"}
            </button>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={reset} style={{ padding: "8px 14px", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.t2, fontSize: 12, fontFamily: SANS, cursor: "pointer" }}>Cancel</button>
        <button onClick={submit} disabled={loading || !content.trim()} style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: "none", background: content.trim() && !loading ? C.t0 : C.bg4, color: content.trim() && !loading ? C.bg0 : C.t2, fontSize: 12, fontWeight: 600, fontFamily: SANS, cursor: content.trim() && !loading ? "pointer" : "default", transition: "all .15s" }}>
          {loading ? "Saving…" : `Save ${TYPE_META[memType]?.icon} ${TYPE_META[memType]?.label}`}
        </button>
      </div>
    </div>
  );
}

// ── Context preview ───────────────────────────────────────────────────────────

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
        <input value={task} onChange={e => setTask(e.target.value)} placeholder="task (optional)" onKeyDown={e => e.key === "Enter" && load(task)}
          style={{ flex: 1, background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 8, color: C.t0, fontSize: 11, padding: "7px 10px", outline: "none", fontFamily: MONO }} />
        <button onClick={() => load(task)} disabled={loading} style={{ padding: "7px 12px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg3, color: loading ? C.t2 : C.t0, fontSize: 11, fontFamily: SANS, cursor: loading ? "default" : "pointer" }}>{loading ? "…" : "↺"}</button>
      </div>
      <div style={{ flex: 1, overflow: "auto", paddingBottom: 16 }}>
        <pre style={{ margin: 0, fontSize: 11.5, fontFamily: MONO, color: C.t1, lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word", background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px" }}>{context}</pre>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function MemoryPanel({ runboxId, runboxName, onClose }: { runboxId: string; runboxName: string; onClose: () => void }) {
  const [memories,      setMemories]      = useState<Memory[]>([]);
  const [branches,      setBranches]      = useState<string[]>(["main"]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState<string | null>(null);
  const [dbReady,       setDbReady]       = useState(false);
  const [retryKey,      setRetryKey]      = useState(0);
  const [memTab,        setMemTab]        = useState<MemTab>("failure");
  const [search,        setSearch]        = useState("");
  const [resolveTarget, setResolveTarget] = useState<Memory | null>(null);
  const [toast,         setToast]         = useState<{ msg: string; color: string } | null>(null);
  const sessionId = `manual-${runboxId}`;

  const showToast = useCallback((msg: string, color = "#70c878") => { setToast({ msg, color }); setTimeout(() => setToast(null), 4000); }, []);

  // DB ready
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
      const [mine, global, bl] = await Promise.all([
        invoke<Memory[]>("memory_list", { runboxId }),
        invoke<Memory[]>("memory_list", { runboxId: "__global__" }),
        invoke<string[]>("memory_branches", { runboxId }),
      ]);
      setMemories([...mine, ...global.map(m => ({ ...m, _scope: "machine" }))]);
      setBranches(bl.length ? bl : ["main"]);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [runboxId]);

  useEffect(() => { if (dbReady) loadAll(); }, [dbReady, loadAll]);

  useEffect(() => {
    if (!dbReady) return;
    const u = listen<{ runbox_id: string }>("memory-added", ({ payload }) => { if (payload.runbox_id === runboxId || payload.runbox_id === "__global__") loadAll(); });
    const r = listen<{ runbox_id: string; fix: string }>("supercontext:blocker-resolved", ({ payload }) => { if (payload.runbox_id === runboxId) { showToast(`✓ Resolved: ${payload.fix.slice(0, 60)}`); loadAll(); } });
    const f = listen<{ runbox_id: string; content: string }>("supercontext:failure", ({ payload }) => { if (payload.runbox_id !== runboxId) showToast(`⚡ Failure in other pane: ${payload.content.slice(0, 60)}`, "#c06868"); });
    return () => { u.then(fn => fn()); r.then(fn => fn()); f.then(fn => fn()); };
  }, [dbReady, runboxId, loadAll, showToast]);

  const handleDelete     = useCallback(async (id: string) => { await invoke("memory_delete", { id }); setMemories(p => p.filter(m => m.id !== id)); }, []);
  const handlePin        = useCallback(async (id: string, pinned: boolean) => { await invoke("memory_pin", { id, pinned }); setMemories(p => p.map(m => m.id === id ? { ...m, pinned } : m)); }, []);
  const handleEdit       = useCallback(async (id: string, content: string) => { await invoke("memory_update", { id, content }); setMemories(p => p.map(m => m.id === id ? { ...m, content } : m)); }, []);
  const handleUpdateTags = useCallback(async (id: string, tags: string) => { await invoke("memory_update_tags", { id, tags }); loadAll(); }, [loadAll]);
  const handleMoveBranch = useCallback(async (id: string, branch: string) => { await invoke("memory_move_branch", { id, branch }); loadAll(); }, [loadAll]);
  const handleConfirmEnv = useCallback(async (id: string) => { await invoke("memory_confirm_env", { id }); showToast("Env fact confirmed ✓"); loadAll(); }, [loadAll, showToast]);

  const typed: Partial<Record<MemTab, Memory[]>> = {
    goal: memories.filter(m => effectiveType(m) === "goal"),
    session: memories.filter(m => effectiveType(m) === "session"),
    blocker: memories.filter(m => effectiveType(m) === "blocker"),
    failure: memories.filter(m => effectiveType(m) === "failure"),
    environment: memories.filter(m => effectiveType(m) === "environment"),
    codebase: memories.filter(m => effectiveType(m) === "codebase"),
    all: memories,
  };

  const tabList = memTab === "context" ? [] : (typed[memTab] ?? memories);
  const filtered = tabList.filter(m => !search.trim() || [m.content, m.tags, m.memory_type].join(" ").toLowerCase().includes(search.toLowerCase()));

  const TABS: { id: MemTab; icon: string; label: string; accent?: string }[] = [
    { id: "failure",     icon: "⚡", label: "Failures",  accent: "#c06868" },
    { id: "blocker",     icon: "⚠",  label: "Blockers",  accent: "#d06050" },
    { id: "goal",        icon: "◎",  label: "Goal",      accent: "#e8c87a" },
    { id: "environment", icon: "⚙",  label: "Env",       accent: "#6898c0" },
    { id: "codebase",    icon: "◈",  label: "Code",      accent: "#70a880" },
    { id: "session",     icon: "⌛", label: "Sessions",  accent: "#8a9ab0" },
    { id: "all",         icon: "≡",  label: "All" },
    { id: "context",     icon: "↺",  label: "Context",   accent: "#9080c0" },
  ];

  if (!dbReady) return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg1, alignItems: "center", justifyContent: "center", gap: 12, padding: "0 24px" }}>
      {!error ? (<><div style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${C.border}`, borderTopColor: C.t1, animation: "spin .7s linear infinite" }} /><span style={{ fontSize: 12, color: C.t2, fontFamily: SANS }}>Initialising memory…</span></>) : (<><span style={{ fontSize: 11, color: C.t2, fontFamily: SANS, textAlign: "center", lineHeight: 1.6 }}>{error}</span><button onClick={() => { setError(null); setDbReady(false); setLoading(true); setRetryKey(k => k + 1); }} style={{ padding: "6px 14px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg2, color: C.t1, fontSize: 11, fontFamily: SANS, cursor: "pointer" }}>Retry</button></>)}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg1 }}>
      {/* Header */}
      <div style={{ padding: "12px 14px 11px", flexShrink: 0, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.t0, flex: 1, fontFamily: SANS, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{runboxName}</span>
        {loading && <div style={{ width: 12, height: 12, borderRadius: "50%", border: `2px solid ${C.border}`, borderTopColor: C.t1, animation: "spin .7s linear infinite", flexShrink: 0 }} />}
        <button onClick={onClose} style={{ background: "none", border: "none", color: C.t2, cursor: "pointer", padding: "4px 6px", borderRadius: 8, fontSize: 14, display: "flex", alignItems: "center" }}
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

      {/* Feedback proxy */}
      <FeedbackProxy memories={memories} />

      {/* Type tabs 4x2 grid */}
      <div style={{ padding: "8px 10px 0", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 3 }}>
          {TABS.map(({ id, icon, label, accent }) => {
            const on    = memTab === id;
            const count = id === "context" ? null : (typed[id] ?? memories).length;
            return (
              <button key={id} onClick={() => setMemTab(id)} style={{ padding: "6px 2px", borderRadius: 7, border: `1px solid ${on ? (accent ?? C.borderMd) + "66" : C.border}`, background: on ? (accent ? `${accent}18` : C.bg3) : "transparent", color: on ? (accent ?? C.t0) : C.t2, fontSize: 10, fontFamily: MONO, cursor: "pointer", transition: "all .1s", display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                <span>{icon} {label}</span>
                {count !== null && count > 0 && <span style={{ fontSize: 9, color: on ? (accent ?? C.t1) : C.t3 }}>{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Context tab */}
      {memTab === "context" ? (
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

          {/* Tab description */}
          {TYPE_META[memTab] && <div style={{ padding: "5px 12px", flexShrink: 0, fontSize: 10, color: C.t3, fontFamily: SANS, borderBottom: `1px solid ${C.border}` }}>{TYPE_META[memTab]?.desc}</div>}

          {/* Cards */}
          <div style={{ flex: 1, overflowY: "auto", padding: "10px 10px 16px", display: "flex", flexDirection: "column", gap: 7 }}>
            <WriteForm runboxId={runboxId} sessionId={sessionId} onAdded={loadAll} />
            {loading && <div style={{ padding: "32px 0", display: "flex", justifyContent: "center" }}><div style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${C.border}`, borderTopColor: C.t1, animation: "spin .7s linear infinite" }} /></div>}
            {!loading && error && <div style={{ padding: "12px 14px", background: "rgba(200,80,80,.08)", border: `1px solid rgba(200,80,80,.18)`, borderRadius: 10, fontSize: 12, color: C.red, fontFamily: SANS }}>{error}</div>}
            {!loading && !error && filtered.length === 0 && (
              <div style={{ padding: "40px 0", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 22, opacity: .3 }}>{TYPE_META[memTab]?.icon ?? "○"}</span>
                <span style={{ fontSize: 12, color: C.t2, fontFamily: SANS }}>{search ? "No memories match." : `No ${TYPE_META[memTab]?.label ?? ""} memories yet.`}</span>
              </div>
            )}
            {!loading && !error && filtered.map(mem => (
              <MemCard key={mem.id} mem={mem} allBranches={branches}
                onDelete={handleDelete} onPin={handlePin} onEdit={handleEdit}
                onMoveBranch={handleMoveBranch} onUpdateTags={handleUpdateTags}
                onResolve={setResolveTarget} onConfirmEnv={handleConfirmEnv} />
            ))}
          </div>
        </>
      )}

      {resolveTarget && <ResolveModal mem={resolveTarget} runboxId={runboxId} sessionId={sessionId} onDone={() => { setResolveTarget(null); showToast("Blocker resolved — fix saved ✓"); loadAll(); }} onClose={() => setResolveTarget(null)} />}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}