// src/panels/FileChangeList.tsx
import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { C, MONO, SANS, PORT } from "../shared/constants";

interface LiveDiffFile {
  path: string; change_type: "created"|"modified"|"deleted";
  diff: string; insertions: number; deletions: number; modified_at: number;
}
interface AgentSpan { agent: string; startedAt: number; }

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

const BLOCKED_NAMES = new Set([
  ".stackbox-context.md","claude.md","agents.md","gemini.md","opencode.md",
  "copilot-instructions.md","mcp.json","skill.md","payload.json","rewrite_app.py","update_app.py",
]);
function isTempFile(n: string) { return /^(rewrite_|update_|patch_|fix_|temp_|tmp_).*\.(py|js|sh|ps1)$/.test(n); }
const BLOCKED_PREFIXES = [".claude/",".gemini/",".codex/",".cursor/",".agents/",".opencode/",".github/skills/",".github/copilot"];
function shouldBlock(path: string) {
  const norm = path.replace(/\\/g,"/").toLowerCase();
  const name = norm.split("/").pop() ?? "";
  return BLOCKED_NAMES.has(name) || isTempFile(name) || BLOCKED_PREFIXES.some(p => norm.startsWith(p));
}

function reltime(ms: number) {
  if (!ms) return "";
  const d = Date.now() - ms;
  if (d < 60_000)    return "just now";
  if (d < 3600_000)  return `${Math.floor(d/60_000)}m`;
  if (d < 86400_000) return `${Math.floor(d/3600_000)}h`;
  return `${Math.floor(d/86400_000)}d`;
}

// Change type — monochrome only
const CHANGE_LABEL = { created: "A", modified: "M", deleted: "D" };
const CHANGE_COLOR  = { created: "#4a9955", modified: "#888888", deleted: "#cc5555" };

export function FileChangeList({ runboxId, runboxCwd, onFileClick }: {
  runboxId: string; runboxCwd: string; onFileClick: (fc: LiveDiffFile) => void;
}) {
  const [files,       setFiles]       = useState<LiveDiffFile[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [worktreeCwd, setWorktreeCwd] = useState(runboxCwd);
  const [branch,      setBranch]      = useState("");
  const [filter,      setFilter]      = useState<"all"|"modified"|"created"|"deleted">("all");
  const [agentSpans,  setAgentSpans]  = useState<AgentSpan[]>([]);
  const worktreeCwdRef = useRef(runboxCwd);

  useEffect(() => {
    fetch(`http://localhost:${PORT}/events?runbox_id=${runboxId}&event_type=AgentSpawned&limit=50`)
      .then(r => r.json())
      .then((rows: any[]) => setAgentSpans(
        rows.map(r => { try { const p = JSON.parse(r.payload_json); return { agent: p.agent ?? "", startedAt: r.timestamp }; } catch { return null; } })
          .filter((s): s is AgentSpan => !!s && s.agent !== "Shell")
          .sort((a, b) => a.startedAt - b.startedAt)
      )).catch(() => {});
  }, [runboxId]);

  useEffect(() => {
    const short = runboxId.slice(0, 8);
    const parts = runboxCwd.replace(/\\/g,"/").split("/"); parts.pop();
    const candidate = parts.join("/") + "/stackbox-wt-" + short;
    invoke<string>("git_current_branch", { cwd: candidate })
      .then(b => { if (b) { setWorktreeCwd(candidate); worktreeCwdRef.current = candidate; setBranch(b); } })
      .catch(() => {
        invoke<string>("git_current_branch", { cwd: runboxCwd }).then(b => { if (b) setBranch(b); }).catch(() => {});
        setWorktreeCwd(runboxCwd); worktreeCwdRef.current = runboxCwd;
      });
  }, [runboxId, runboxCwd]);

  const applyAndSet = (raw: LiveDiffFile[]) =>
    setFiles(raw.filter(f => !shouldBlock(f.path)).sort((a,b) => (b.modified_at||0)-(a.modified_at||0)));

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true); setError(null);
    invoke<LiveDiffFile[]>("git_diff_live", { cwd: worktreeCwdRef.current, runboxId })
      .then(applyAndSet).catch(e => setError(String(e))).finally(() => setLoading(false));
  }, [runboxId]);

  useEffect(() => { load(false); }, [load]);
  useEffect(() => {
    if (!worktreeCwd) return;
    invoke("git_watch_start", { cwd: worktreeCwd, runboxId }).catch(() => {});
    return () => { invoke("git_watch_stop", { cwd: worktreeCwd }).catch(() => {}); };
  }, [runboxId, worktreeCwd]);
  useEffect(() => {
    const u = listen<LiveDiffFile[]>("git:live-diff", ({ payload }) => { applyAndSet(payload); setLoading(false); setError(null); });
    return () => { u.then(f => f()); };
  }, []);

  const deduped = (() => { const m = new Map<string,LiveDiffFile>(); for (const f of files) m.set(f.path,f); return Array.from(m.values()); })();
  const filtered = filter === "all" ? deduped : deduped.filter(f => f.change_type === filter);
  const counts = { created: deduped.filter(f=>f.change_type==="created").length, modified: deduped.filter(f=>f.change_type==="modified").length, deleted: deduped.filter(f=>f.change_type==="deleted").length };
  const totalIns = deduped.reduce((s,f) => s+f.insertions, 0);
  const totalDel = deduped.reduce((s,f) => s+f.deletions, 0);

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background: C.bg1 }}>

      {/* Stats */}
      {deduped.length > 0 && (
        <div style={{ display:"flex", flexShrink:0, borderBottom:`1px solid ${C.border}` }}>
          {[
            { label:"ADDED",   val: counts.created  },
            { label:"CHANGED", val: counts.modified },
            { label:"DELETED", val: counts.deleted  },
            { label:"LINES",   val: null             },
          ].map(({ label, val }) => val !== null && val > 0 ? (
            <div key={label} style={{ flex:1, padding:"8px 12px", borderRight:`1px solid ${C.border}` }}>
              <div style={{ fontSize:9, fontFamily:MONO, letterSpacing:".10em", color:C.t3, marginBottom:3 }}>{label}</div>
              <span style={{ fontSize:16, fontFamily:MONO, fontWeight:700, color:C.t0 }}>{val}</span>
            </div>
          ) : label === "LINES" && (totalIns > 0 || totalDel > 0) ? (
            <div key={label} style={{ flex:1, padding:"8px 12px" }}>
              <div style={{ fontSize:9, fontFamily:MONO, letterSpacing:".10em", color:C.t3, marginBottom:3 }}>{label}</div>
              <div style={{ display:"flex", gap:5 }}>
                {totalIns > 0 && <span style={{ fontSize:13, fontFamily:MONO, fontWeight:700, color:"#4a9955" }}>+{totalIns}</span>}
                {totalDel > 0 && <span style={{ fontSize:13, fontFamily:MONO, fontWeight:700, color:"#cc5555" }}>-{totalDel}</span>}
              </div>
            </div>
          ) : null)}
        </div>
      )}

      {/* Branch + refresh */}
      <div style={{ padding:"8px 12px", borderBottom:`1px solid ${C.border}`, flexShrink:0, display:"flex", alignItems:"center", gap:8 }}>
        {branch && (
          <div style={{ display:"flex", alignItems:"center", gap:5, flex:1, background:C.bg2, border:`1px solid ${C.border}`, borderRadius:8, padding:"5px 10px" }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>
            </svg>
            <span style={{ fontSize:11, fontFamily:MONO, color:C.t1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{branch}</span>
            <span style={{ fontSize:10, fontFamily:MONO, color:C.t3, marginLeft:"auto" }}>
              {deduped.length > 0 ? `${deduped.length} file${deduped.length!==1?"s":""}` : "clean"}
            </span>
          </div>
        )}
        <button onClick={() => load(false)}
          style={{ padding:"5px 10px", background:"transparent", border:`1px solid ${C.border}`, borderRadius:8, color:C.t2, fontSize:11, fontFamily:SANS, cursor:"pointer", flexShrink:0, transition:"all .1s" }}
          onMouseEnter={e => { const el=e.currentTarget as HTMLElement; el.style.borderColor=C.borderMd; el.style.color=C.t0; }}
          onMouseLeave={e => { const el=e.currentTarget as HTMLElement; el.style.borderColor=C.border; el.style.color=C.t2; }}>
          ↺
        </button>
      </div>

      {/* Filter tabs */}
      <div style={{ padding:"8px 12px", borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
        <div style={{ display:"flex", background:C.bg0, borderRadius:8, padding:3, gap:0 }}>
          {(["all","modified","created","deleted"] as const).map(f => {
            const on    = filter === f;
            const count = f === "all" ? deduped.length : counts[f];
            return (
              <button key={f} onClick={() => setFilter(f)}
                style={{ flex:1, padding:"5px 0", borderRadius:6, border:"none", background:on?C.bg4:"transparent", color:on?C.t0:C.t3, fontSize:11, fontFamily:SANS, fontWeight:on?600:400, cursor:"pointer", transition:"all .1s", display:"flex", alignItems:"center", justifyContent:"center", gap:4 }}>
                <span style={{ textTransform:"capitalize" }}>{f}</span>
                {count > 0 && <span style={{ fontSize:10, fontFamily:MONO, opacity:.6 }}>{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* List */}
      <div style={{ flex:1, overflowY:"auto", padding:"8px" }}>
        {loading && (
          <div style={{ padding:"32px 0", display:"flex", justifyContent:"center" }}>
            <div style={{ width:16, height:16, border:`2px solid ${C.border}`, borderTopColor:C.t1, borderRadius:"50%", animation:"spin .7s linear infinite" }} />
          </div>
        )}
        {!loading && error && (
          <div style={{ margin:"4px", padding:"10px 12px", background:"rgba(200,80,80,.08)", border:"1px solid rgba(200,80,80,.15)", borderRadius:10, fontSize:12, color:"#cc6666", fontFamily:SANS }}>
            {error}
            <button onClick={() => load(false)} style={{ display:"block", marginTop:8, padding:"4px 12px", background:C.bg3, border:`1px solid ${C.border}`, borderRadius:6, color:C.t2, fontSize:11, fontFamily:SANS, cursor:"pointer" }}>Retry</button>
          </div>
        )}
        {!loading && !error && deduped.length === 0 && (
          <div style={{ padding:"40px 0", display:"flex", flexDirection:"column", alignItems:"center", gap:10 }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            <span style={{ fontSize:12, color:C.t2, fontFamily:SANS }}>No uncommitted changes</span>
          </div>
        )}
        <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
          {!loading && !error && filtered.map(fc => {
            const fileName  = fc.path.split(/[/\\]/).pop() ?? fc.path;
            const dirPart   = fc.path.slice(0, fc.path.length - fileName.length);
            const agentName = agentAt(agentSpans, fc.modified_at);
            const ts        = reltime(fc.modified_at);
            const letter    = CHANGE_LABEL[fc.change_type];

            return (
              <div key={fc.path} onClick={() => onFileClick(fc)}
                style={{ background:C.bg2, border:`1px solid ${C.border}`, borderRadius:8, padding:"9px 11px", cursor:"pointer", transition:"all .1s", display:"flex", alignItems:"center", gap:10 }}
                onMouseEnter={e => { const el=e.currentTarget as HTMLElement; el.style.background=C.bg3; el.style.borderColor=C.borderMd; }}
                onMouseLeave={e => { const el=e.currentTarget as HTMLElement; el.style.background=C.bg2; el.style.borderColor=C.border; }}>

                {/* Change letter */}
                <span style={{ fontSize:10, fontFamily:MONO, fontWeight:700, color:CHANGE_COLOR[fc.change_type], width:12, flexShrink:0, textAlign:"center" }}>{letter}</span>

                {/* File info */}
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:12, fontFamily:MONO, color:C.t0, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{fileName}</div>
                  {dirPart && <div style={{ fontSize:10, fontFamily:MONO, color:C.t3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginTop:1 }}>{dirPart}</div>}
                </div>

                {/* Agent */}
                {agentName && (
                  <span style={{ fontSize:9, fontFamily:MONO, color:C.t3, background:C.bg4, border:`1px solid ${C.border}`, borderRadius:4, padding:"1px 5px", flexShrink:0, letterSpacing:".03em" }}>
                    {agentName}
                  </span>
                )}

                {/* Stats */}
                <div style={{ display:"flex", gap:5, flexShrink:0 }}>
                  {fc.insertions > 0 && <span style={{ fontSize:10, fontFamily:MONO, color:"#4a9955", fontWeight:600 }}>+{fc.insertions}</span>}
                  {fc.deletions  > 0 && <span style={{ fontSize:10, fontFamily:MONO, color:"#cc5555", fontWeight:600 }}>-{fc.deletions}</span>}
                </div>

                {/* Time */}
                {ts && <span style={{ fontSize:10, fontFamily:MONO, color:C.t3, flexShrink:0 }}>{ts}</span>}
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