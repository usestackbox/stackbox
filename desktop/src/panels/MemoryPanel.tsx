// src/panels/MemoryPanel.tsx
import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { C, MONO, SANS } from "../shared/constants";

export interface Memory {
  id: string; runbox_id: string; session_id: string;
  content: string; pinned: boolean; timestamp: number;
  branch: string; commit_type: string; tags: string;
  parent_id: string; agent_name: string; _scope?: string;
}

const AGENT_COLOR: Record<string, { fg: string; bg: string }> = {
  "claude code":      { fg: "#e8b84b", bg: "rgba(232,184,75,.16)"  },
  "openai codex cli": { fg: "#5ecb6b", bg: "rgba(94,203,107,.14)"  },
  "gemini cli":       { fg: "#6aaee8", bg: "rgba(106,174,232,.14)" },
  "cursor agent":     { fg: "#c47ee8", bg: "rgba(196,126,232,.14)" },
  "github copilot":   { fg: "#6a9ee8", bg: "rgba(106,158,232,.14)" },
  "opencode":         { fg: "#a0a0a0", bg: "rgba(160,160,160,.12)" },
  "human":            { fg: "#888888", bg: "rgba(136,136,136,.10)" },
  "git":              { fg: "#888888", bg: "rgba(136,136,136,.10)" },
};
function agentStyle(name: string) {
  return AGENT_COLOR[name.toLowerCase()] ?? { fg: "#555", bg: "rgba(85,85,85,.10)" };
}

const COMMIT_DOT: Record<string, string> = {
  milestone:  "#e0e0e0",
  checkpoint: "#707070",
  memory:     "#303030",
};

function reltime(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60_000)    return "just now";
  if (d < 3600_000)  return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86400_000) return `${Math.floor(d / 3600_000)}h ago`;
  return `${Math.floor(d / 86400_000)}d ago`;
}

const tbtn: React.CSSProperties = {
  background: "none", border: "none", color: C.t2, cursor: "pointer",
  padding: "3px 7px", borderRadius: 6, fontSize: 11,
  display: "flex", alignItems: "center", gap: 3,
  fontFamily: SANS, transition: "all .1s",
};

// ── Tag ───────────────────────────────────────────────────────────────────────
function Tag({ label, active, onClick, style: extraStyle }: { label: string; active?: boolean; onClick?: () => void; style?: React.CSSProperties }) {
  const [hov, setHov] = useState(false);
  return (
    <span onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        fontSize: 10, fontFamily: MONO, padding: "2px 8px", borderRadius: 6,
        cursor: onClick ? "pointer" : "default", userSelect: "none",
        background: active ? C.bg4 : hov ? C.bg3 : C.bg2,
        border: `1px solid ${active ? C.borderMd : C.border}`,
        color: active ? C.t0 : C.t2, transition: "all .1s",
        ...extraStyle,
      }}>
      {label}
    </span>
  );
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function Stats({ memories }: { memories: Memory[] }) {
  if (!memories.length) return null;
  const ms = memories.filter(m => m.commit_type === "milestone").length;
  const cp = memories.filter(m => m.commit_type === "checkpoint").length;
  const me = memories.filter(m => m.commit_type === "memory").length;
  return (
    <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
      {[["◆", ms, "milestones"], ["●", cp, "checkpoints"], ["○", me, "memories"]].map(([dot, count, label]) =>
        (count as number) > 0 ? (
          <div key={label as string} style={{ flex: 1, padding: "10px 14px", borderRight: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 9, fontFamily: MONO, letterSpacing: ".10em", color: C.t3, marginBottom: 4 }}>
              {(label as string).toUpperCase()}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
              <span style={{ fontSize: 18, fontFamily: MONO, fontWeight: 700, color: (count as number) > 0 ? C.t0 : C.t3, letterSpacing: "-.02em" }}>
                {count as number}
              </span>
              <span style={{ fontSize: 10, color: COMMIT_DOT[label as string] ?? C.t3 }}>{dot as string}</span>
            </div>
          </div>
        ) : null
      )}
    </div>
  );
}

// ── Memory Card ───────────────────────────────────────────────────────────────
function MemCard({ mem, allBranches, onDelete, onPin, onEdit, onTagClick, onMoveBranch, onUpdateTags }: {
  mem: Memory; allBranches: string[];
  onDelete: (id: string) => void; onPin: (id: string, p: boolean) => void;
  onEdit: (id: string, c: string) => void; onTagClick: (t: string) => void;
  onMoveBranch: (id: string, b: string) => void; onUpdateTags: (id: string, t: string) => void;
}) {
  const [hov,         setHov]         = useState(false);
  const [expanded,    setExpanded]    = useState(false);
  const [editing,     setEditing]     = useState(false);
  const [editContent, setEditContent] = useState(mem.content);
  const [editTags,    setEditTags]    = useState(mem.tags);
  const [saving,      setSaving]      = useState(false);
  const [showMove,    setShowMove]    = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setEditContent(mem.content); setEditTags(mem.tags); }, [mem.content, mem.tags]);
  useEffect(() => { if (editing) setTimeout(() => taRef.current?.focus(), 20); }, [editing]);

  const saveEdit = async () => {
    setSaving(true);
    try {
      if (editContent.trim() !== mem.content) await onEdit(mem.id, editContent.trim());
      if (editTags !== mem.tags) await onUpdateTags(mem.id, editTags);
      setEditing(false);
    } finally { setSaving(false); }
  };

  const isMilestone  = mem.commit_type === "milestone";
  const isCheckpoint = mem.commit_type === "checkpoint";
  const isFailure    = mem.tags.includes("failure");
  const isLong       = mem.content.length > 300;
  const tags         = mem.tags.split(",").map(t => t.trim()).filter(Boolean);
  const as           = mem.agent_name ? agentStyle(mem.agent_name) : null;

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => { setHov(false); setShowMove(false); }}
      style={{
        background: isMilestone ? C.bg3 : isFailure ? "rgba(200,60,60,.06)" : C.bg2,
        border: `1px solid ${isMilestone ? C.borderMd : isFailure ? "rgba(200,60,60,.35)" : isCheckpoint ? C.border : C.border}`,
        borderRadius: 12,
        padding: "12px 14px",
        display: "flex", flexDirection: "column", gap: 9,
        transition: "border-color .15s",
        ...(hov ? { borderColor: isMilestone ? C.borderHi : isFailure ? "rgba(200,60,60,.6)" : C.borderMd } : {}),
        position: "relative", overflow: "visible",
        borderLeft: isFailure ? "3px solid rgba(200,60,60,.6)" : undefined,
      }}>

      {/* Top stripe for milestone */}
      {isMilestone && (
        <div style={{ position: "absolute", top: 0, left: 16, right: 16, height: 2, borderRadius: "0 0 2px 2px", background: "rgba(255,255,255,.18)" }} />
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {/* Commit type dot */}
        <div style={{
          width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
          background: COMMIT_DOT[mem.commit_type] ?? COMMIT_DOT.memory,
        }} />

        {/* Branch */}
        <span style={{
          fontSize: 10, fontFamily: MONO, color: C.t2,
          background: C.bg4, border: `1px solid ${C.borderMd}`,
          borderRadius: 6, padding: "1px 6px",
        }}>⎇ {mem.branch}</span>

        {/* Agent pill */}
        {as && mem.agent_name && (
          <span style={{
            fontSize: 10, fontFamily: MONO, fontWeight: 600,
            color: as.fg, background: as.bg,
            border: `1px solid ${as.fg}99`,
            borderRadius: 6, padding: "1px 7px",
            letterSpacing: ".02em",
          }}>{mem.agent_name}</span>
        )}

        {mem._scope === "global" && (
          <span style={{ fontSize: 9, fontFamily: MONO, color: C.t3 }}>global</span>
        )}
        {mem.pinned && <span style={{ fontSize: 11 }}>📌</span>}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, fontFamily: MONO, color: C.t2 }}>{reltime(mem.timestamp)}</span>
      </div>

      {/* Content */}
      {editing ? (
        <textarea ref={taRef} value={editContent} onChange={e => setEditContent(e.target.value)}
          rows={Math.max(3, editContent.split("\n").length + 1)}
          onKeyDown={e => { if (e.key === "Escape") { setEditing(false); setEditContent(mem.content); } if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveEdit(); }}
          style={{ background: C.bg0, border: `1px solid ${C.borderHi}`, borderRadius: 8, color: C.t0, fontSize: 12.5, padding: "9px 11px", resize: "vertical", fontFamily: MONO, outline: "none", lineHeight: 1.65, width: "100%", boxSizing: "border-box" }} />
      ) : (
        <p style={{ margin: 0, fontSize: 12.5, color: isMilestone ? C.t0 : isFailure ? "#f0d0d0" : "#d4d4d4", lineHeight: 1.65, fontFamily: MONO, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: isLong && !expanded ? 240 : "none", overflow: "hidden" }}>
          {mem.content}
        </p>
      )}

      {!editing && isLong && (
        <button onClick={() => setExpanded(v => !v)}
          style={{ ...tbtn, padding: "0", fontSize: 10, color: "#6090d0", alignSelf: "flex-start" }}>
          {expanded ? "↑ less" : `↓ show more`}
        </button>
      )}

      {/* Tags */}
      {editing ? (
        <input value={editTags} onChange={e => setEditTags(e.target.value)}
          placeholder="comma, separated, tags"
          style={{ background: C.bg0, border: `1px solid ${C.border}`, borderRadius: 8, color: C.t1, fontSize: 11, padding: "5px 9px", outline: "none", fontFamily: MONO }}
          onFocus={e => e.currentTarget.style.borderColor = C.borderHi}
          onBlur={e  => e.currentTarget.style.borderColor = C.border} />
      ) : tags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {tags.map(t => {
            const tagColor = t === "failure" ? "#cc5555" : t === "decision" ? "#6090d0" : t === "preference" ? "#8060c0" : undefined;
            return <Tag key={t} label={t} onClick={() => onTagClick(t)} style={tagColor ? { color: tagColor, borderColor: tagColor + "44", background: tagColor + "15" } : undefined} />;
          })}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 3, alignItems: "center", opacity: hov || editing ? 1 : 0, transition: "opacity .15s", pointerEvents: hov || editing ? "auto" : "none" }}>
        {editing ? (
          <>
            <button onClick={saveEdit} disabled={saving}
              style={{ ...tbtn, background: C.bg4, border: `1px solid ${C.borderMd}`, color: saving ? C.t2 : C.t0 }}>
              {saving ? "Saving…" : "✓ Save"}
            </button>
            <button onClick={() => { setEditing(false); setEditContent(mem.content); setEditTags(mem.tags); }}
              style={{ ...tbtn, color: C.t2 }}>Cancel</button>
          </>
        ) : (
          <>
            <button onClick={() => setEditing(true)} style={{ ...tbtn, color: C.t2 }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.t0}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.t2}>Edit</button>
            <button onClick={() => onPin(mem.id, !mem.pinned)} style={{ ...tbtn, color: C.t2 }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.t0}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.t2}>
              {mem.pinned ? "Unpin" : "Pin"}
            </button>
            {allBranches.filter(b => b !== mem.branch).length > 0 && (
              <div style={{ position: "relative" }}>
                <button onClick={() => setShowMove(v => !v)} style={{ ...tbtn, color: C.t2 }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.t0}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.t2}>Move →</button>
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
        <button onClick={() => onDelete(mem.id)} style={{ ...tbtn, color: C.t3 }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.red}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.t3}>Delete</button>
      </div>
    </div>
  );
}

// ── Add Form ──────────────────────────────────────────────────────────────────
type CommitType = "memory" | "checkpoint" | "milestone";

function AddForm({ runboxId, sessionId, branches, onAdded }: {
  runboxId: string; sessionId: string; branches: string[]; onAdded: () => void;
}) {
  const [open,      setOpen]      = useState(false);
  const [content,   setContent]   = useState("");
  const [type,      setType]      = useState<CommitType>("memory");
  const [branch,    setBranch]    = useState("main");
  const [newBranch, setNewBranch] = useState("");
  const [tags,      setTags]      = useState("");
  const [scope,     setScope]     = useState<"this"|"all">("this");
  const [loading,   setLoading]   = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (open) setTimeout(() => taRef.current?.focus(), 30); }, [open]);
  const reset = () => { setOpen(false); setContent(""); setTags(""); setNewBranch(""); };

  const submit = async () => {
    if (!content.trim()) return;
    setLoading(true);
    try {
      const targets = scope === "all" ? ["__global__"] : [runboxId];
      await Promise.all(targets.map(id => invoke("memory_add_full", {
        runboxId: id, sessionId, content: content.trim(),
        branch: newBranch.trim() || branch,
        commitType: type, tags: tags.trim(), parentId: "", agentName: "human",
      })));
      reset(); onAdded();
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  if (!open) return (
    <button onClick={() => setOpen(true)}
      style={{
        width: "100%", padding: "11px 14px", borderRadius: 12,
        background: "transparent", border: `1px dashed ${C.border}`,
        color: C.t2, fontSize: 12, fontFamily: SANS, cursor: "pointer",
        transition: "all .15s", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
      }}
      onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = C.borderMd; el.style.color = C.t0; el.style.background = C.bg2; }}
      onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = C.border; el.style.color = C.t2; el.style.background = "transparent"; }}>
      <span style={{ fontSize: 17, fontWeight: 300, lineHeight: 1 }}>+</span>
      Add memory
    </button>
  );

  const TYPES: [CommitType, string, string][] = [
    ["memory",     "○", "Memory"],
    ["checkpoint", "●", "Checkpoint"],
    ["milestone",  "◆", "Milestone"],
  ];

  return (
    <div style={{ background: C.bg2, border: `1px solid ${C.borderMd}`, borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Type tabs */}
      <div style={{ display: "flex", gap: 0, background: C.bg1, borderRadius: 8, padding: 3 }}>
        {TYPES.map(([t, dot, label]) => (
          <button key={t} onClick={() => setType(t)}
            style={{
              flex: 1, padding: "6px 0", borderRadius: 6, border: "none",
              background: type === t ? C.bg4 : "transparent",
              color: type === t ? C.t0 : C.t2, cursor: "pointer",
              fontSize: 11, fontFamily: SANS, fontWeight: type === t ? 600 : 400,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
              transition: "all .1s",
            }}>
            <span style={{ fontSize: 10, color: COMMIT_DOT[t] }}>{dot}</span>
            {label}
          </button>
        ))}
      </div>

      <textarea ref={taRef} value={content} onChange={e => setContent(e.target.value)}
        placeholder={
          type === "milestone"  ? "What major goal was accomplished…" :
          type === "checkpoint" ? "Summarize progress so far…" :
          "What should future agents know…"
        }
        rows={type === "memory" ? 3 : 4}
        onKeyDown={e => { if (e.key === "Escape") reset(); }}
        style={{ background: C.bg0, border: `1px solid ${C.border}`, borderRadius: 10, color: C.t0, fontSize: 12.5, padding: "10px 12px", resize: "vertical", fontFamily: MONO, outline: "none", lineHeight: 1.65, width: "100%", boxSizing: "border-box", transition: "border-color .15s" }}
        onFocus={e => e.currentTarget.style.borderColor = C.borderHi}
        onBlur={e  => e.currentTarget.style.borderColor = C.border} />

      {/* Branch + Tags */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <label style={{ fontSize: 9, fontFamily: MONO, letterSpacing: ".10em", color: C.t3, display: "block", marginBottom: 5 }}>BRANCH</label>
          <select value={newBranch ? "__new__" : branch}
            onChange={e => { if (e.target.value === "__new__") setNewBranch(""); else { setBranch(e.target.value); setNewBranch(""); } }}
            style={{ width: "100%", background: C.bg0, border: `1px solid ${C.border}`, borderRadius: 8, color: C.t1, fontSize: 11, padding: "6px 9px", outline: "none", fontFamily: MONO }}>
            {branches.map(b => <option key={b} value={b}>{b}</option>)}
            <option value="__new__">+ new branch…</option>
          </select>
          {newBranch !== "" && (
            <input value={newBranch} onChange={e => setNewBranch(e.target.value)} placeholder="branch name" autoFocus
              style={{ marginTop: 5, width: "100%", boxSizing: "border-box", background: C.bg0, border: `1px solid ${C.borderMd}`, borderRadius: 8, color: C.t0, fontSize: 11, padding: "6px 9px", outline: "none", fontFamily: MONO }} />
          )}
        </div>
        <div>
          <label style={{ fontSize: 9, fontFamily: MONO, letterSpacing: ".10em", color: C.t3, display: "block", marginBottom: 5 }}>TAGS</label>
          <input value={tags} onChange={e => setTags(e.target.value)} placeholder="auth, bug, css"
            style={{ width: "100%", boxSizing: "border-box", background: C.bg0, border: `1px solid ${C.border}`, borderRadius: 8, color: C.t1, fontSize: 11, padding: "6px 9px", outline: "none", fontFamily: MONO, transition: "border-color .15s" }}
            onFocus={e => e.currentTarget.style.borderColor = C.borderHi}
            onBlur={e  => e.currentTarget.style.borderColor = C.border} />
        </div>
      </div>

      {/* Scope */}
      <div style={{ display: "flex", gap: 0, background: C.bg1, borderRadius: 8, padding: 3 }}>
        {(["this", "all"] as const).map(s => (
          <button key={s} onClick={() => setScope(s)}
            style={{ flex: 1, padding: "6px 0", borderRadius: 6, border: "none", background: scope === s ? C.bg4 : "transparent", color: scope === s ? C.t0 : C.t2, cursor: "pointer", fontSize: 11, fontFamily: SANS, transition: "all .1s" }}>
            {s === "this" ? "This runbox" : "All runboxes"}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={reset}
          style={{ padding: "9px 16px", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.t2, fontSize: 12, fontFamily: SANS, cursor: "pointer", transition: "all .1s" }}
          onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = C.borderMd; el.style.color = C.t1; }}
          onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = C.border; el.style.color = C.t2; }}>
          Cancel
        </button>
        <button onClick={submit} disabled={loading || !content.trim()}
          style={{
            flex: 1, padding: "9px 0", borderRadius: 8, border: "none",
            background: content.trim() && !loading ? C.t0 : C.bg4,
            color: content.trim() && !loading ? C.bg0 : C.t2,
            fontSize: 12, fontWeight: 600, fontFamily: SANS,
            cursor: content.trim() && !loading ? "pointer" : "default",
            transition: "all .15s",
          }}>
          {loading ? "Saving…"
            : type === "milestone"  ? "◆ Add Milestone"
            : type === "checkpoint" ? "● Commit Checkpoint"
            : "○ Save Memory"}
        </button>
      </div>
    </div>
  );
}

// ── MemoryPanel ───────────────────────────────────────────────────────────────
export default function MemoryPanel({ runboxId, runboxName, runboxes, onClose }: {
  runboxId: string; runboxName: string;
  runboxes: { id: string; name: string }[]; onClose: () => void;
}) {
  const [memories,     setMemories]     = useState<Memory[]>([]);
  const [globalMems,   setGlobalMems]   = useState<Memory[]>([]);
  const [branches,     setBranches]     = useState<string[]>(["main"]);
  const [allTags,      setAllTags]      = useState<string[]>([]);
  const [activeBranch, setActiveBranch] = useState("all");
  const [activeTag,    setActiveTag]    = useState<string | null>(null);
  const [search,       setSearch]       = useState("");
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [dbReady,      setDbReady]      = useState(false);
  const [retryKey,     setRetryKey]     = useState(0);
  const [globalSearch, setGlobalSearch] = useState(false);
  const [globalResults,setGlobalResults]= useState<Memory[]>([]);
  const [globalLoading,setGlobalLoading]= useState(false);
  const [failureToast, setFailureToast] = useState<string | null>(null);
  const [memTab,       setMemTab]       = useState<"all"|"failures"|"decisions"|"git"|"manual">("all");

  // ── Wait for backend memory DB to finish initialising ─────────────────────
  useEffect(() => {
    let cancelled = false;

    // 1. Listen for the definitive backend event (emitted from lib.rs)
    const readyUnsub = listen<void>("memory-ready", () => {
      if (!cancelled) setDbReady(true);
    });
    const errorUnsub = listen<string>("memory-error", ({ payload }) => {
      if (!cancelled) {
        setError(`Memory backend error: ${payload}`);
        setLoading(false);
      }
    });

    // 2. Poll as a fallback — now safe because ensure_init() returns
    //    immediately (no blocking), so invokes won't hang forever.
    let attempt = 0;
    const DELAYS = [300, 600, 1000, 1500, 2000, 2500, 3000, 3000, 3000, 3000];
    const MAX_RETRIES = DELAYS.length;

    const poll = async () => {
      while (!cancelled) {
        try {
          await invoke("memory_list", { runboxId });
          if (!cancelled) setDbReady(true);
          return;
        } catch (e) {
          const msg = String(e).toLowerCase();
          const isNotReady = msg.includes("not initialised") || msg.includes("not initialized");

          if (isNotReady && attempt < MAX_RETRIES) {
            const delay = DELAYS[attempt++];
            await new Promise(r => setTimeout(r, delay));
          } else if (!isNotReady) {
            // Real error (not just "not ready yet")
            if (!cancelled) {
              setError(`Memory backend error: ${String(e)}`);
              setLoading(false);
            }
            return;
          } else {
            // Exhausted retries
            if (!cancelled) {
              setError("Memory took too long to initialise. Click Retry.");
              setLoading(false);
            }
            return;
          }
        }
      }
    };
    poll();

    return () => {
      cancelled = true;
      readyUnsub.then(f => f());
      errorUnsub.then(f => f());
    };
  }, [runboxId, retryKey]);

  const loadAll = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [mine, global, bl, tl] = await Promise.all([
        invoke<Memory[]>("memory_list", { runboxId }),
        invoke<Memory[]>("memory_list", { runboxId: "__global__" }),
        invoke<string[]>("memory_branches", { runboxId }),
        invoke<string[]>("memory_tags", { runboxId }),
      ]);
      setMemories(mine);
      setGlobalMems(global.map(m => ({ ...m, _scope: "global" })));
      setBranches(bl.length ? bl : ["main"]);
      setAllTags(tl);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [runboxId]);

  useEffect(() => { if (dbReady) loadAll(); }, [dbReady, loadAll]);

  // ── Cross-pane failure broadcast ──────────────────────────────────────────
  useEffect(() => {
    const u = listen<{ runbox_id: string; content: string }>("supercontext:failure", ({ payload }) => {
      if (payload.runbox_id !== runboxId) {
        setFailureToast(`⚡ Failure in another pane: ${payload.content.slice(0, 80)}`);
        setTimeout(() => setFailureToast(null), 6000);
      }
    });
    return () => { u.then(f => f()); };
  }, [runboxId]);

  // ── Global search ─────────────────────────────────────────────────────────
  const runGlobalSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setGlobalResults([]); return; }
    setGlobalLoading(true);
    try {
      const r = await invoke<Memory[]>("memory_search_global", { query: q, limit: 40 });
      setGlobalResults(r);
    } catch { setGlobalResults([]); }
    finally { setGlobalLoading(false); }
  }, []);

  useEffect(() => {
    if (!globalSearch) { setGlobalResults([]); return; }
    const t = setTimeout(() => runGlobalSearch(search), 300);
    return () => clearTimeout(t);
  }, [search, globalSearch, runGlobalSearch]);
  useEffect(() => {
    if (!dbReady) return;
    const u = listen<{ runbox_id: string }>("memory-added", ({ payload }) => {
      if (payload.runbox_id === runboxId || payload.runbox_id === "__global__") loadAll();
    });
    return () => { u.then(f => f()); };
  }, [dbReady, runboxId, loadAll]);

  const handleDelete = useCallback(async (id: string) => {
    await invoke("memory_delete", { id });
    setMemories(p => p.filter(m => m.id !== id));
    setGlobalMems(p => p.filter(m => m.id !== id));
  }, []);
  const handlePin = useCallback(async (id: string, pinned: boolean) => {
    await invoke("memory_pin", { id, pinned });
    setMemories(p => p.map(m => m.id === id ? { ...m, pinned } : m));
    setGlobalMems(p => p.map(m => m.id === id ? { ...m, pinned } : m));
  }, []);
  const handleEdit = useCallback(async (id: string, content: string) => {
    await invoke("memory_update", { id, content });
    setMemories(p => p.map(m => m.id === id ? { ...m, content } : m));
  }, []);
  const handleUpdateTags = useCallback(async (id: string, tags: string) => {
    await invoke("memory_update_tags", { id, tags });
    setMemories(p => p.map(m => m.id === id ? { ...m, tags } : m));
    invoke<string[]>("memory_tags", { runboxId }).then(setAllTags).catch(() => {});
  }, [runboxId]);
  const handleMoveBranch = useCallback(async (id: string, branch: string) => {
    await invoke("memory_move_branch", { id, branch });
    setMemories(p => p.map(m => m.id === id ? { ...m, branch } : m));
    invoke<string[]>("memory_branches", { runboxId }).then(setBranches).catch(() => {});
  }, [runboxId]);

  const all: Memory[] = [
    ...globalMems,
    ...memories.map(m => ({ ...m, _scope: undefined })),
  ].sort((a, b) => {
    const o = (ct: string) => ct === "milestone" ? 0 : ct === "checkpoint" ? 1 : 2;
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const d = o(a.commit_type) - o(b.commit_type);
    if (d) return d;
    return b.timestamp - a.timestamp;
  });

  // ── Tab bucketing ──────────────────────────────────────────────────────────
  const buckets = {
    failures:  all.filter(m => m.tags.includes("failure")),
    decisions: all.filter(m => m.tags.includes("decision") || m.tags.includes("preference")),
    git:       all.filter(m => m.agent_name === "git"),
    manual:    all.filter(m => m.agent_name === "human" || m.agent_name === ""),
  };

  const tabList = all.filter(m => {
    if (memTab === "failures")  return m.tags.includes("failure");
    if (memTab === "decisions") return m.tags.includes("decision") || m.tags.includes("preference");
    if (memTab === "git")       return m.agent_name === "git";
    if (memTab === "manual")    return m.agent_name === "human" || m.agent_name === "";
    return true; // "all"
  });

  const filtered = tabList.filter(m => {
    if (activeBranch !== "all" && m.branch !== activeBranch) return false;
    if (search.trim() && !m.content.toLowerCase().includes(search.toLowerCase()) &&
        !m.tags.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const TAB_META: { id: "all"|"failures"|"decisions"|"git"|"manual"; label: string; count: number; accent?: string }[] = [
    { id: "all",       label: "All",       count: all.length },
    { id: "failures",  label: "⚠ Failures",  count: buckets.failures.length,  accent: "#cc5555" },
    { id: "decisions", label: "◈ Decisions", count: buckets.decisions.length, accent: "#6090d0" },
    { id: "git",       label: "⎇ Git",       count: buckets.git.length,       accent: "#888888" },
    { id: "manual",    label: "✎ Manual",    count: buckets.manual.length },
  ];

  if (!dbReady) return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg1, alignItems: "center", justifyContent: "center", gap: 12, padding: "0 24px" }}>
      {!error ? (
        <>
          <div style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${C.border}`, borderTopColor: C.t1, animation: "spin .7s linear infinite" }} />
          <span style={{ fontSize: 12, color: C.t2, fontFamily: SANS }}>Initialising memory…</span>
        </>
      ) : (
        <>
          <span style={{ fontSize: 11, color: C.t2, fontFamily: SANS, textAlign: "center", lineHeight: 1.6 }}>{error}</span>
          <button onClick={() => { setError(null); setDbReady(false); setLoading(true); setRetryKey(k => k + 1); }}
            style={{ padding: "6px 14px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg2, color: C.t1, fontSize: 11, fontFamily: SANS, cursor: "pointer" }}>
            Retry
          </button>
        </>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg1 }}>

      {/* Header */}
      <div style={{ padding: "12px 14px 11px", flexShrink: 0, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.t0, flex: 1, fontFamily: SANS, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {runboxName}
        </span>
        {loading && <div style={{ width: 12, height: 12, borderRadius: "50%", border: `2px solid ${C.border}`, borderTopColor: C.t1, animation: "spin .7s linear infinite", flexShrink: 0 }} />}
        <button onClick={onClose}
          style={{ background: "none", border: "none", color: C.t2, cursor: "pointer", padding: "4px 6px", borderRadius: 8, fontSize: 14, display: "flex", alignItems: "center", transition: "all .1s" }}
          onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = C.bg3; el.style.color = C.t0; }}
          onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.color = C.t2; }}>✕</button>
      </div>

      {/* Cross-pane failure toast */}
      {failureToast && (
        <div style={{ margin: "6px 10px 0", padding: "8px 11px", background: "rgba(200,60,60,.12)", border: `1px solid rgba(200,60,60,.28)`, borderRadius: 8, fontSize: 11, color: "#e07070", fontFamily: SANS, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{ flex: 1, lineHeight: 1.4 }}>{failureToast}</span>
          <button onClick={() => setFailureToast(null)} style={{ background: "none", border: "none", color: "#e07070", cursor: "pointer", fontSize: 14, padding: 0, flexShrink: 0 }}>×</button>
        </div>
      )}

      {/* ── Memory type tabs ── */}
      <div style={{ padding: "8px 10px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ display: "flex", background: C.bg0, borderRadius: 8, padding: 3, gap: 2 }}>
          {TAB_META.map(({ id, label, count, accent }) => {
            const on = memTab === id;
            return (
              <button key={id} onClick={() => setMemTab(id)}
                style={{
                  flex: 1, padding: "5px 2px", borderRadius: 6, border: "none",
                  background: on ? C.bg4 : "transparent",
                  color: on ? (accent ?? C.t0) : C.t2,
                  fontSize: 10, fontFamily: MONO, fontWeight: on ? 700 : 400,
                  cursor: "pointer", transition: "all .1s",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 1,
                }}>
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%", padding: "0 2px" }}>{label}</span>
                {count > 0 && (
                  <span style={{ fontSize: 9, fontFamily: MONO, color: on ? (accent ?? C.t1) : C.t3, fontWeight: 400 }}>{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Branch filter — shown for all tabs */}
      {branches.length > 1 && (
        <div style={{ padding: "6px 10px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 4, overflowX: "auto" }}>
            {["all", ...branches].map(b => {
              const on = activeBranch === b;
              return (
                <button key={b} onClick={() => setActiveBranch(b)}
                  style={{ flexShrink: 0, padding: "4px 10px", borderRadius: 7, border: `1px solid ${on ? C.borderMd : C.border}`, background: on ? C.bg3 : "transparent", color: on ? C.t0 : C.t2, fontSize: 10, fontFamily: MONO, cursor: "pointer", transition: "all .1s" }}>
                  {b === "all" ? "all branches" : `⎇ ${b}`}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Search + global toggle */}
      <div style={{ padding: "8px 10px", borderBottom: `1px solid ${C.border}`, flexShrink: 0, display: "flex", gap: 6, alignItems: "center" }}>
        <div style={{ flex: 1, position: "relative" }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={C.t2} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={globalSearch ? "Search all runboxes…" : "Search memories…"}
            style={{ width: "100%", boxSizing: "border-box", background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 8, color: C.t0, fontSize: 11, padding: "7px 28px 7px 28px", outline: "none", fontFamily: MONO, transition: "border-color .15s" }}
            onFocus={e => e.currentTarget.style.borderColor = C.borderHi}
            onBlur={e  => e.currentTarget.style.borderColor = C.border} />
          {search && (
            <button onClick={() => setSearch("")} style={{ position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: C.t2, fontSize: 13, padding: 0 }}>×</button>
          )}
        </div>
        <button onClick={() => setGlobalSearch(v => !v)}
          title={globalSearch ? "Global search ON — searching all runboxes" : "Click to search across all runboxes"}
          style={{ padding: "7px 9px", borderRadius: 8, border: `1px solid ${globalSearch ? C.borderMd : C.border}`, background: globalSearch ? C.bg3 : "transparent", color: globalSearch ? C.t0 : C.t2, fontSize: 10, fontFamily: MONO, cursor: "pointer", transition: "all .1s", flexShrink: 0, fontWeight: globalSearch ? 700 : 400 }}>
          {globalSearch ? "◉ ALL" : "○ ALL"}
        </button>
        {globalLoading && <div style={{ width: 12, height: 12, borderRadius: "50%", border: `2px solid ${C.border}`, borderTopColor: C.t1, animation: "spin .7s linear infinite", flexShrink: 0 }} />}
      </div>

      {/* Global search results panel */}
      {globalSearch && search.trim() && (
        <div style={{ borderBottom: `1px solid ${C.border}`, padding: "8px 10px", flexShrink: 0, maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 9, fontFamily: MONO, letterSpacing: ".10em", color: C.t3, marginBottom: 2 }}>ALL RUNBOXES</div>
          {globalResults.length === 0 && !globalLoading && (
            <div style={{ fontSize: 11, color: C.t2, fontFamily: SANS }}>No results found.</div>
          )}
          {globalResults.map(mem => {
            const isFailure  = mem.tags.includes("failure");
            const isDecision = mem.tags.includes("decision");
            const isGit      = mem.agent_name === "git";
            return (
              <div key={mem.id} style={{ padding: "7px 10px", background: C.bg2, border: `1px solid ${isFailure ? "rgba(200,60,60,.25)" : C.border}`, borderRadius: 8 }}>
                <div style={{ fontSize: 11, fontFamily: MONO, color: isFailure ? "#dda0a0" : C.t1, lineHeight: 1.5, wordBreak: "break-word" }}>
                  {mem.content.slice(0, 140)}{mem.content.length > 140 ? "…" : ""}
                </div>
                <div style={{ display: "flex", gap: 5, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
                  {isGit      && <span style={{ fontSize: 9, fontFamily: MONO, color: "#888", background: C.bg4, borderRadius: 3, padding: "1px 5px" }}>⎇ git</span>}
                  {isFailure  && <span style={{ fontSize: 9, fontFamily: MONO, color: "#cc5555", background: "rgba(200,60,60,.1)", borderRadius: 3, padding: "1px 5px" }}>failure</span>}
                  {isDecision && <span style={{ fontSize: 9, fontFamily: MONO, color: "#6090d0", background: "rgba(60,90,200,.1)", borderRadius: 3, padding: "1px 5px" }}>decision</span>}
                  {mem.runbox_id !== runboxId && <span style={{ fontSize: 9, fontFamily: MONO, color: C.t3, background: C.bg4, borderRadius: 3, padding: "1px 5px" }}>other pane</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Tab content ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 10px 16px", display: "flex", flexDirection: "column", gap: 7 }}>

        {/* Add form — only on All and Manual tabs */}
        {(memTab === "all" || memTab === "manual") && (
          <AddForm runboxId={runboxId} sessionId={`manual-${runboxId}`} branches={branches} onAdded={loadAll} />
        )}

        {/* Tab description pills */}
        {memTab === "failures" && (
          <div style={{ padding: "8px 12px", background: "rgba(200,60,60,.07)", border: `1px solid rgba(200,60,60,.18)`, borderRadius: 8, fontSize: 11, color: "#cc8888", fontFamily: SANS, lineHeight: 1.5 }}>
            Auto-captured when agents hit errors. Shared across panes.
          </div>
        )}
        {memTab === "decisions" && (
          <div style={{ padding: "8px 12px", background: "rgba(60,90,200,.07)", border: `1px solid rgba(60,90,200,.18)`, borderRadius: 8, fontSize: 11, color: "#8090c0", fontFamily: SANS, lineHeight: 1.5 }}>
            Decisions &amp; preferences auto-captured from agent output.
          </div>
        )}
        {memTab === "git" && (
          <div style={{ padding: "8px 12px", background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11, color: C.t2, fontFamily: SANS, lineHeight: 1.5 }}>
            Ingested from git log on first agent spawn. Read-only history.
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ padding: "32px 0", display: "flex", justifyContent: "center" }}>
            <div style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${C.border}`, borderTopColor: C.t1, animation: "spin .7s linear infinite" }} />
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div style={{ padding: "12px 14px", background: "rgba(200,80,80,.08)", border: `1px solid rgba(200,80,80,.18)`, borderRadius: 10, fontSize: 12, color: C.red, fontFamily: SANS }}>{error}</div>
        )}

        {/* Empty state */}
        {!loading && !error && filtered.length === 0 && (
          <div style={{ padding: "40px 0", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 22, opacity: .3 }}>
              {memTab === "failures" ? "✓" : memTab === "git" ? "⎇" : memTab === "decisions" ? "◈" : "○"}
            </span>
            <span style={{ fontSize: 12, color: C.t2, fontFamily: SANS }}>
              {search ? "No memories match." :
               memTab === "failures"  ? "No failures captured yet." :
               memTab === "decisions" ? "No decisions captured yet." :
               memTab === "git"       ? "No git history ingested yet." :
               memTab === "manual"    ? "No manual memories added yet." :
               "No memories yet. Add one above."}
            </span>
          </div>
        )}

        {/* Memory cards */}
        {!loading && !error && filtered.map(mem => (
          <MemCard key={mem.id} mem={mem} allBranches={branches}
            onDelete={handleDelete} onPin={handlePin} onEdit={handleEdit}
            onTagClick={() => {}} onMoveBranch={handleMoveBranch} onUpdateTags={handleUpdateTags} />
        ))}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}