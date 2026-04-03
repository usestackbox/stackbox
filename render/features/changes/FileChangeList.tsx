// features/changes/FileChangeList.tsx
import { useState } from "react";
import { C, MONO, SANS } from "../../design";
import { useFileChanges, LiveDiffFile, AgentSpan } from "./useFileChanges";

function shortAgent(name: string) {
  const n = name.toLowerCase();
  if (n.includes("codex"))    return "codex";
  if (n.includes("claude"))   return "claude";
  if (n.includes("gemini"))   return "gemini";
  if (n.includes("cursor"))   return "cursor";
  if (n.includes("copilot"))  return "copilot";
  if (n.includes("opencode")) return "opencode";
  return name.split(" ")[0].toLowerCase();
}

function agentAt(spans: AgentSpan[], ts: number): string | null {
  if (!spans.length || !ts) return null;
  let match: AgentSpan | null = null;
  for (const s of spans) { if (s.startedAt <= ts + 5000) match = s; }
  return match ? shortAgent(match.agent) : null;
}

function reltime(ms: number) {
  if (!ms) return "";
  const d = Date.now() - ms;
  if (d < 60_000)    return "just now";
  if (d < 3600_000)  return `${Math.floor(d / 60_000)}m`;
  if (d < 86400_000) return `${Math.floor(d / 3600_000)}h`;
  return `${Math.floor(d / 86400_000)}d`;
}

const CHANGE_LETTER = { created: "A", modified: "M", deleted: "D" };
const changeColor   = (t: "created" | "modified" | "deleted") =>
  t === "created" ? C.green : t === "deleted" ? C.red : C.t2;

interface Props {
  runboxId:    string;
  runboxCwd:   string;
  onFileClick: (fc: LiveDiffFile) => void;
}

export function FileChangeList({ runboxId, runboxCwd, onFileClick }: Props) {
  const { files, loading, error, branch, agentSpans, reload } = useFileChanges(runboxId, runboxCwd);
  const [filter, setFilter] = useState<"all" | "modified" | "created" | "deleted">("all");

  const filtered = filter === "all" ? files : files.filter(f => f.change_type === filter);
  const counts = {
    created:  files.filter(f => f.change_type === "created").length,
    modified: files.filter(f => f.change_type === "modified").length,
    deleted:  files.filter(f => f.change_type === "deleted").length,
  };
  const totalIns = files.reduce((s, f) => s + f.insertions, 0);
  const totalDel = files.reduce((s, f) => s + f.deletions, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg1 }}>

      {/* Stats bar */}
      {files.length > 0 && (
        <div style={{ display: "flex", flexShrink: 0, borderBottom: `1px solid ${C.border}`, background: C.bg0 }}>
          {[
            { label: "ADDED",   val: counts.created,  color: C.green },
            { label: "CHANGED", val: counts.modified, color: C.t0    },
            { label: "DELETED", val: counts.deleted,  color: C.red   },
          ].filter(x => x.val > 0).map(({ label, val, color }) => (
            <div key={label} style={{ flex: 1, padding: "8px 12px", borderRight: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 9, fontFamily: MONO, letterSpacing: ".10em", color: C.t3, marginBottom: 3 }}>{label}</div>
              <span style={{ fontSize: 16, fontFamily: MONO, fontWeight: 700, color }}>{val}</span>
            </div>
          ))}
          {(totalIns > 0 || totalDel > 0) && (
            <div style={{ flex: 1, padding: "8px 12px" }}>
              <div style={{ fontSize: 9, fontFamily: MONO, letterSpacing: ".10em", color: C.t3, marginBottom: 3 }}>LINES</div>
              <div style={{ display: "flex", gap: 5 }}>
                {totalIns > 0 && <span style={{ fontSize: 13, fontFamily: MONO, fontWeight: 700, color: C.green }}>+{totalIns}</span>}
                {totalDel > 0 && <span style={{ fontSize: 13, fontFamily: MONO, fontWeight: 700, color: C.red }}>-{totalDel}</span>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Branch + refresh */}
      <div style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}`, flexShrink: 0, display: "flex", alignItems: "center", gap: 8, background: C.bg0 }}>
        {branch && (
          <div style={{ display: "flex", alignItems: "center", gap: 5, flex: 1, background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 8, padding: "5px 10px" }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>
            </svg>
            <span style={{ fontSize: 11, fontFamily: MONO, color: C.t1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{branch}</span>
            <span style={{ fontSize: 10, fontFamily: MONO, color: C.t3, marginLeft: "auto" }}>
              {files.length > 0 ? `${files.length} file${files.length !== 1 ? "s" : ""}` : "clean"}
            </span>
          </div>
        )}
        <button onClick={() => reload(false)}
          style={{ padding: "5px 10px", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.t2, fontSize: 11, fontFamily: SANS, cursor: "pointer", flexShrink: 0 }}
          onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = C.borderMd; el.style.color = C.t0; }}
          onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = C.border; el.style.color = C.t2; }}>
          ↺
        </button>
      </div>

      {/* Filter tabs */}
      <div style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}`, flexShrink: 0, background: C.bg0 }}>
        <div style={{ display: "flex", background: C.bg1, borderRadius: 8, padding: 3, gap: 0 }}>
          {(["all", "modified", "created", "deleted"] as const).map(f => {
            const on    = filter === f;
            const count = f === "all" ? files.length : counts[f];
            return (
              <button key={f} onClick={() => setFilter(f)}
                style={{ flex: 1, padding: "5px 0", borderRadius: 6, border: "none", background: on ? C.bg4 : "transparent", color: on ? C.t0 : C.t3, fontSize: 11, fontFamily: SANS, fontWeight: on ? 600 : 400, cursor: "pointer", transition: "all .1s", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                <span style={{ textTransform: "capitalize" }}>{f}</span>
                {count > 0 && <span style={{ fontSize: 10, fontFamily: MONO, opacity: .6 }}>{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
        {loading && (
          <div style={{ padding: "32px 0", display: "flex", justifyContent: "center" }}>
            <div style={{ width: 16, height: 16, border: `2px solid ${C.border}`, borderTopColor: C.t1, borderRadius: "50%", animation: "spin .7s linear infinite" }} />
          </div>
        )}
        {!loading && error && (
          <div style={{ margin: "4px", padding: "10px 12px", background: C.redBg, border: `1px solid ${C.red}26`, borderRadius: 10, fontSize: 12, color: C.red, fontFamily: SANS }}>
            {error}
            <button onClick={() => reload(false)} style={{ display: "block", marginTop: 8, padding: "4px 12px", background: C.bg3, border: `1px solid ${C.border}`, borderRadius: 6, color: C.t2, fontSize: 11, fontFamily: SANS, cursor: "pointer" }}>Retry</button>
          </div>
        )}
        {!loading && !error && files.length === 0 && (
          <div style={{ padding: "40px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            <span style={{ fontSize: 12, color: C.t2, fontFamily: SANS }}>No uncommitted changes</span>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {!loading && !error && filtered.map(fc => {
            const fileName  = fc.path.split(/[/\\]/).pop() ?? fc.path;
            const dirPart   = fc.path.slice(0, fc.path.length - fileName.length);
            const agentName = agentAt(agentSpans, fc.modified_at);
            const ts        = reltime(fc.modified_at);
            const letter    = CHANGE_LETTER[fc.change_type];
            const lColor    = changeColor(fc.change_type);
            return (
              <div key={fc.path} onClick={() => onFileClick(fc)}
                style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 11px", cursor: "pointer", transition: "all .1s", display: "flex", alignItems: "center", gap: 10 }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = C.bg3; el.style.borderColor = C.borderMd; }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = C.bg2; el.style.borderColor = C.border; }}>
                <span style={{ fontSize: 10, fontFamily: MONO, fontWeight: 700, color: lColor, width: 12, flexShrink: 0, textAlign: "center" }}>{letter}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontFamily: MONO, color: C.t0, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fileName}</div>
                  {dirPart && <div style={{ fontSize: 10, fontFamily: MONO, color: C.t3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>{dirPart}</div>}
                </div>
                {agentName && <span style={{ fontSize: 9, fontFamily: MONO, color: C.t3, background: C.bg4, border: `1px solid ${C.border}`, borderRadius: 4, padding: "1px 5px", flexShrink: 0 }}>{agentName}</span>}
                <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                  {fc.insertions > 0 && <span style={{ fontSize: 10, fontFamily: MONO, color: C.green, fontWeight: 600 }}>+{fc.insertions}</span>}
                  {fc.deletions  > 0 && <span style={{ fontSize: 10, fontFamily: MONO, color: C.red,   fontWeight: 600 }}>-{fc.deletions}</span>}
                </div>
                {ts && <span style={{ fontSize: 10, fontFamily: MONO, color: C.t3, flexShrink: 0 }}>{ts}</span>}
              </div>
            );
          })}
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default FileChangeList;