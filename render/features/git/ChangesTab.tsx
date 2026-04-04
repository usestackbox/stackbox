import { useRef, useState, useCallback } from "react";
import { C, MONO, SANS } from "../../design";
import type { LiveDiffFile, AgentSpan } from "./types";
import { agentForFile } from "./useGitPanel";

interface Props {
  files:        LiveDiffFile[];
  agentSpans:   AgentSpan[];
  committing:   boolean;
  pushing:      boolean;
  message:      string;
  onMessage:    (m: string) => void;
  onCommit:     () => void;
  onCommitPush: () => void;
  onFileClick:  (fc: LiveDiffFile) => void;
  onStage?:     (path: string) => Promise<void>;
  onUnstage?:   (path: string) => Promise<void>;
  onDiscard?:   (path: string) => Promise<void>;
}

const CHANGE_LETTER = { created: "A", modified: "M", deleted: "D" } as const;
const changeColor = (t: "created" | "modified" | "deleted") =>
  t === "created" ? C.green : t === "deleted" ? C.red : C.t2;

function reltime(ms: number) {
  if (!ms) return "";
  const d = Date.now() - ms;
  if (d < 60_000)    return "just now";
  if (d < 3600_000)  return `${Math.floor(d / 60_000)}m`;
  if (d < 86400_000) return `${Math.floor(d / 3600_000)}h`;
  return `${Math.floor(d / 86400_000)}d`;
}

// ── Minimal inline diff renderer ──────────────────────────────────────────────

function InlineDiff({ diff }: { diff: string }) {
  if (!diff?.trim()) {
    return (
      <div style={{ padding: "10px 12px", fontSize: 11, color: C.t3, fontFamily: MONO }}>
        No diff available.
      </div>
    );
  }

  const lines = diff.split("\n");
  return (
    <div style={{
      maxHeight: 320, overflowY: "auto", fontSize: 11, fontFamily: MONO,
      lineHeight: 1.6, background: C.bg0, borderTop: `1px solid ${C.border}`,
    }}>
      {lines.map((line, i) => {
        const isAdd  = line.startsWith("+") && !line.startsWith("+++");
        const isDel  = line.startsWith("-") && !line.startsWith("---");
        const isHunk = line.startsWith("@@");
        const color  = isAdd ? C.green : isDel ? C.red : isHunk ? C.blue : C.t3;
        const bg     = isAdd ? "rgba(74,222,128,.06)" : isDel ? "rgba(248,113,113,.06)" : "transparent";
        return (
          <div key={i} style={{
            padding: "0 12px", color, background: bg,
            whiteSpace: "pre", overflowX: "auto",
          }}>
            {line || " "}
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ChangesTab({
  files, agentSpans,
  committing, pushing,
  message, onMessage,
  onCommit, onCommitPush, onFileClick,
  onStage, onUnstage, onDiscard,
}: Props) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const busy    = committing || pushing;

  const [filter,      setFilter]      = useState<"all" | "modified" | "created" | "deleted">("all");
  const [expanded,    setExpanded]    = useState<Set<string>>(new Set());
  const [staged,      setStaged]      = useState<Set<string>>(new Set());
  const [actionBusy,  setActionBusy]  = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);

  const counts = {
    created:  files.filter(f => f.change_type === "created").length,
    modified: files.filter(f => f.change_type === "modified").length,
    deleted:  files.filter(f => f.change_type === "deleted").length,
  };
  const totalIns = files.reduce((s, f) => s + f.insertions, 0);
  const totalDel = files.reduce((s, f) => s + f.deletions, 0);
  const filtered = filter === "all" ? files : files.filter(f => f.change_type === filter);

  const toggleExpand = useCallback((path: string) => {
    setExpanded(prev => {
      const n = new Set(prev);
      n.has(path) ? n.delete(path) : n.add(path);
      return n;
    });
  }, []);

  const handleStageToggle = useCallback(async (path: string, isStaged: boolean) => {
    setActionBusy(path);
    try {
      if (isStaged) {
        await onUnstage?.(path);
        setStaged(prev => { const n = new Set(prev); n.delete(path); return n; });
      } else {
        await onStage?.(path);
        setStaged(prev => new Set(prev).add(path));
      }
    } finally {
      setActionBusy(null);
    }
  }, [onStage, onUnstage]);

  const handleDiscard = useCallback(async (path: string) => {
    if (confirmDiscard !== path) { setConfirmDiscard(path); return; }
    setConfirmDiscard(null);
    setActionBusy(path);
    try { await onDiscard?.(path); } finally { setActionBusy(null); }
  }, [confirmDiscard, onDiscard]);

  const handleStageAll = useCallback(async () => {
    for (const f of files) {
      if (!staged.has(f.path)) {
        await onStage?.(f.path).catch(() => {});
      }
    }
    setStaged(new Set(files.map(f => f.path)));
  }, [files, staged, onStage]);

  const handleUnstageAll = useCallback(async () => {
    for (const f of files) {
      await onUnstage?.(f.path).catch(() => {});
    }
    setStaged(new Set());
  }, [files, onUnstage]);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>

      {/* Stats bar */}
      {files.length > 0 && (
        <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          {[
            { l: "ADDED",   val: counts.created,  color: C.green },
            { l: "CHANGED", val: counts.modified, color: C.t0    },
            { l: "DELETED", val: counts.deleted,  color: C.red   },
          ].filter(x => x.val > 0).map(({ l, val, color }) => (
            <div key={l} style={{ flex: 1, padding: "6px 12px", borderRight: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 8, fontFamily: MONO, letterSpacing: ".10em", color: C.t3, marginBottom: 2 }}>{l}</div>
              <span style={{ fontSize: 14, fontFamily: MONO, fontWeight: 700, color }}>{val}</span>
            </div>
          ))}
          {(totalIns > 0 || totalDel > 0) && (
            <div style={{ flex: 1, padding: "6px 12px" }}>
              <div style={{ fontSize: 8, fontFamily: MONO, letterSpacing: ".10em", color: C.t3, marginBottom: 2 }}>LINES</div>
              <div style={{ display: "flex", gap: 4 }}>
                {totalIns > 0 && <span style={{ fontSize: 12, fontFamily: MONO, fontWeight: 700, color: C.green }}>+{totalIns}</span>}
                {totalDel > 0 && <span style={{ fontSize: 12, fontFamily: MONO, fontWeight: 700, color: C.red }}>-{totalDel}</span>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Commit box */}
      <div style={{ padding: "8px", borderBottom: `1px solid ${C.border}`, flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <textarea
          ref={textRef}
          value={message}
          onChange={e => onMessage(e.target.value)}
          placeholder="Commit message…"
          rows={2}
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); onCommit(); } }}
          style={{
            width: "100%", boxSizing: "border-box",
            background: C.bg0, border: `1px solid ${C.border}`, borderRadius: 8,
            color: C.t0, fontSize: 12, padding: "8px 10px",
            resize: "none", outline: "none", fontFamily: SANS, lineHeight: 1.5,
            transition: "border-color .15s",
          }}
          onFocus={e => e.currentTarget.style.borderColor = C.borderHi}
          onBlur={e => e.currentTarget.style.borderColor = C.border}
        />
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={onCommit} disabled={busy || !message.trim()}
            style={{
              flex: 1, padding: "7px 0", borderRadius: 8,
              border: `1px solid ${message.trim() && !busy ? C.borderMd : C.border}`,
              background: message.trim() && !busy ? C.bg4 : "transparent",
              color: message.trim() && !busy ? C.t0 : C.t3,
              fontSize: 11, fontFamily: SANS, fontWeight: 600,
              cursor: message.trim() && !busy ? "pointer" : "default", transition: "all .1s",
            }}>
            {committing && !pushing ? "…" : "✓ Commit"}
          </button>
          <button onClick={onCommitPush} disabled={busy || !message.trim()}
            style={{
              flex: 1, padding: "7px 0", borderRadius: 8,
              border: `1px solid ${message.trim() && !busy ? C.borderMd : C.border}`,
              background: "transparent",
              color: message.trim() && !busy ? C.t1 : C.t3,
              fontSize: 11, fontFamily: SANS, fontWeight: 600,
              cursor: message.trim() && !busy ? "pointer" : "default", transition: "all .1s",
            }}>
            {pushing ? "…" : "↑ Commit & Push"}
          </button>
        </div>
      </div>

      {/* Filter + stage-all row */}
      {files.length > 0 && (
        <div style={{ padding: "6px 8px", borderBottom: `1px solid ${C.border}`, flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ display: "flex", flex: 1, background: C.bg0, borderRadius: 7, padding: 2 }}>
            {(["all", "modified", "created", "deleted"] as const).map(f => {
              const on    = filter === f;
              const count = f === "all" ? files.length : counts[f];
              return (
                <button key={f} onClick={() => setFilter(f)}
                  style={{
                    flex: 1, padding: "4px 0", borderRadius: 5, border: "none",
                    background: on ? C.bg4 : "transparent",
                    color: on ? C.t0 : C.t3,
                    fontSize: 10, fontFamily: SANS, fontWeight: on ? 600 : 400,
                    cursor: "pointer", transition: "all .1s",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 3,
                  }}>
                  <span style={{ textTransform: "capitalize" }}>{f}</span>
                  {count > 0 && <span style={{ fontSize: 9, fontFamily: MONO, opacity: .55 }}>{count}</span>}
                </button>
              );
            })}
          </div>
          {onStage && (
            <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
              <button onClick={handleStageAll} title="Stage all files"
                style={{ padding: "4px 8px", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 6, color: C.t2, fontSize: 9, fontFamily: MONO, cursor: "pointer" }}>
                +All
              </button>
              <button onClick={handleUnstageAll} title="Unstage all files"
                style={{ padding: "4px 8px", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 6, color: C.t2, fontSize: 9, fontFamily: MONO, cursor: "pointer" }}>
                −All
              </button>
            </div>
          )}
        </div>
      )}

      {/* File list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px", display: "flex", flexDirection: "column", gap: 3 }}>
        {files.length === 0 && (
          <div style={{ padding: "32px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <span style={{ fontSize: 12, color: C.t2, fontFamily: SANS }}>No changes</span>
          </div>
        )}

        {filtered.map(fc => {
          const fileName   = fc.path.split(/[/\\]/).pop() ?? fc.path;
          const dirPart    = fc.path.slice(0, fc.path.length - fileName.length);
          const letter     = CHANGE_LETTER[fc.change_type];
          const lColor     = changeColor(fc.change_type);
          const agentName  = agentForFile(agentSpans, fc.modified_at);
          const ts         = reltime(fc.modified_at);
          const isExpanded = expanded.has(fc.path);
          const isStaged   = staged.has(fc.path);
          const isBusy     = actionBusy === fc.path;
          const isConfirm  = confirmDiscard === fc.path;

          return (
            <div key={fc.path} style={{
              background: isStaged ? "rgba(74,222,128,.04)" : C.bg2,
              border: `1px solid ${isStaged ? C.green + "30" : C.border}`,
              borderRadius: 8, overflow: "hidden",
              transition: "all .15s",
            }}>
              {/* File row */}
              <div
                style={{ padding: "8px 10px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.bg3; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ""; }}>

                {/* Stage checkbox */}
                {onStage && (
                  <button
                    onClick={e => { e.stopPropagation(); handleStageToggle(fc.path, isStaged); }}
                    disabled={isBusy}
                    title={isStaged ? "Unstage" : "Stage"}
                    style={{
                      width: 16, height: 16, borderRadius: 4, border: `1.5px solid ${isStaged ? C.green : C.border}`,
                      background: isStaged ? C.green + "22" : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", flexShrink: 0, padding: 0,
                      transition: "all .1s",
                    }}>
                    {isStaged && (
                      <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                        <polyline points="1.5,5 4,7.5 8.5,2.5" stroke={C.green} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </button>
                )}

                {/* Change letter */}
                <span style={{ fontSize: 10, fontFamily: MONO, fontWeight: 700, color: lColor, width: 10, flexShrink: 0, textAlign: "center" }}>{letter}</span>

                {/* File name */}
                <div style={{ flex: 1, minWidth: 0 }} onClick={() => onFileClick(fc)}>
                  <div style={{ fontSize: 12, fontFamily: MONO, color: C.t0, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fileName}</div>
                  {dirPart && <div style={{ fontSize: 10, fontFamily: MONO, color: C.t2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>{dirPart}</div>}
                </div>

                {agentName && (
                  <span style={{ fontSize: 9, fontFamily: MONO, color: C.t3, background: C.bg4, border: `1px solid ${C.border}`, borderRadius: 4, padding: "1px 5px", flexShrink: 0 }}>
                    {agentName}
                  </span>
                )}

                <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                  {fc.insertions > 0 && <span style={{ fontSize: 10, fontFamily: MONO, color: C.green, fontWeight: 600 }}>+{fc.insertions}</span>}
                  {fc.deletions  > 0 && <span style={{ fontSize: 10, fontFamily: MONO, color: C.red,   fontWeight: 600 }}>-{fc.deletions}</span>}
                </div>

                {ts && <span style={{ fontSize: 10, fontFamily: MONO, color: C.t3, flexShrink: 0 }}>{ts}</span>}

                {/* Expand diff toggle */}
                {fc.diff && (
                  <button onClick={e => { e.stopPropagation(); toggleExpand(fc.path); }}
                    title={isExpanded ? "Hide diff" : "Show diff"}
                    style={{
                      width: 22, height: 22, border: `1px solid ${isExpanded ? C.borderMd : C.border}`,
                      borderRadius: 5, background: isExpanded ? C.bg4 : "transparent",
                      color: isExpanded ? C.t1 : C.t3, fontSize: 13,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", flexShrink: 0, padding: 0, lineHeight: 1,
                      transition: "all .1s",
                    }}>
                    {isExpanded ? "▾" : "▸"}
                  </button>
                )}

                {/* Discard button */}
                {onDiscard && (
                  <button
                    onClick={e => { e.stopPropagation(); handleDiscard(fc.path); }}
                    disabled={isBusy}
                    title={isConfirm ? "Click again to confirm discard" : "Discard changes"}
                    style={{
                      padding: "2px 7px", borderRadius: 5, border: `1px solid ${isConfirm ? C.red + "60" : C.border}`,
                      background: isConfirm ? C.redBg : "transparent",
                      color: isConfirm ? C.red : C.t3,
                      fontSize: 9, fontFamily: SANS, cursor: "pointer",
                      transition: "all .1s", flexShrink: 0,
                    }}>
                    {isConfirm ? "sure?" : "↺"}
                  </button>
                )}
              </div>

              {/* Inline diff */}
              {isExpanded && <InlineDiff diff={fc.diff} />}
            </div>
          );
        })}
      </div>

      {/* Discard confirm backdrop */}
      {confirmDiscard && (
        <div
          onClick={() => setConfirmDiscard(null)}
          style={{ position: "fixed", inset: 0, zIndex: 10 }}
        />
      )}
    </div>
  );
}