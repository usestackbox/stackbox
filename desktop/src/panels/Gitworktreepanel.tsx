// src/panels/Gitworktreepanel.tsx
import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { C, MONO, SANS } from "../shared/constants";

interface LiveDiffFile {
  path: string; change_type: "created"|"modified"|"deleted";
  diff: string; insertions: number; deletions: number; modified_at: number;
}
interface GitCommit { hash: string; short_hash: string; message: string; date: string; author: string; }
interface WorktreeEntry { path: string; branch: string; head: string; is_main: boolean; is_bare: boolean; is_locked: boolean; }
interface ConflictFile { path: string; status: string; }

type Tab = "changes"|"branches"|"history"|"worktrees";

function reldate(iso: string) {
  try {
    const d = Date.now() - new Date(iso).getTime();
    if (d < 3600_000)  return `${Math.floor(d/60_000)}m`;
    if (d < 86400_000) return `${Math.floor(d/3600_000)}h`;
    return `${Math.floor(d/86400_000)}d`;
  } catch { return ""; }
}

interface GitPanelProps {
  runboxCwd: string; runboxId: string; branch: string;
  onClose: () => void; onFileClick?: (fc: LiveDiffFile) => void;
}

// ── No-git placeholder ────────────────────────────────────────────────────────
function NoGitPane({ cwd, onClose, onInitDone }: { cwd: string; onClose: () => void; onInitDone: () => void }) {
  const [copied, setCopied] = useState(false);

  // Auto-poll every 2s — strict detection, no false positives
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const b = await invoke<string>("git_current_branch", { cwd });
        if (b && b.trim().length > 0) { clearInterval(t); onInitDone(); return; }
      } catch { /* not yet */ }
      try {
        const wts = await invoke<any[]>("git_worktree_list", { cwd });
        if (Array.isArray(wts) && wts.length > 0) { clearInterval(t); onInitDone(); return; }
      } catch { /* not yet */ }
    }, 2000);
    return () => clearInterval(t);
  }, [cwd, onInitDone]);

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText("git init"); } catch { /**/ }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:C.bg1 }}>
      {/* Header */}
      <div style={{ height:48, padding:"0 14px", flexShrink:0, borderBottom:`1px solid ${C.border}`, display:"flex", alignItems:"center", gap:8 }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.t2} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}>
          <line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>
        </svg>
        <span style={{ fontSize:13, fontWeight:600, color:C.t0, flex:1, fontFamily:SANS }}>Source Control</span>
        {/* Pulsing dot to show auto-polling is active */}
        <div title="Auto-detecting git repo…" style={{ width:6, height:6, borderRadius:"50%", background:C.t3, animation:"gitpulse 2s ease-in-out infinite", marginRight:4 }} />
        <button onClick={onClose}
          style={{ width:28, height:28, display:"flex", alignItems:"center", justifyContent:"center", background:"none", border:"none", color:C.t2, fontSize:14, borderRadius:8, cursor:"pointer", transition:"all .1s" }}
          onMouseEnter={e => { const el=e.currentTarget as HTMLElement; el.style.background=C.bg3; el.style.color=C.t0; }}
          onMouseLeave={e => { const el=e.currentTarget as HTMLElement; el.style.background="transparent"; el.style.color=C.t2; }}>✕</button>
      </div>

      {/* Body */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:12, padding:24 }}>

        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>
        </svg>

        <span style={{ fontSize:13, fontWeight:600, color:C.t1, fontFamily:SANS }}>No Git repository</span>

        <span style={{ fontSize:11, color:C.t3, fontFamily:SANS, textAlign:"center", lineHeight:1.7 }}>
          Run this in the terminal — the panel will<br/>
          <strong style={{ color:C.t2 }}>update automatically</strong> once detected.
        </span>

        {/* Command box */}
        <div style={{ width:"100%", boxSizing:"border-box" as const, background:C.bg0, border:`1px solid ${C.border}`, borderRadius:8, padding:"10px 12px", display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:13, fontFamily:MONO, color:C.t0, flex:1 }}>git init</span>
          <button onClick={handleCopy}
            style={{ flexShrink:0, padding:"4px 12px", background: copied ? C.green + "22" : "transparent", border:`1px solid ${copied ? C.green : C.borderMd}`, borderRadius:6, color: copied ? C.green : C.t1, fontSize:10, fontFamily:SANS, cursor:"pointer", transition:"all .15s", whiteSpace:"nowrap" as const }}
            onMouseEnter={e => { if (!copied) { const el=e.currentTarget as HTMLElement; el.style.background=C.bg3; el.style.color=C.t0; } }}
            onMouseLeave={e => { if (!copied) { const el=e.currentTarget as HTMLElement; el.style.background="transparent"; el.style.color=C.t1; } }}>
            {copied ? "✓ Copied" : "Copy"}
          </button>
        </div>

        {/* Folder */}
        <div style={{ width:"100%", boxSizing:"border-box" as const }}>
          <div style={{ fontSize:9, fontFamily:MONO, color:C.t3, letterSpacing:".08em", marginBottom:4 }}>IN FOLDER</div>
          <span style={{ fontSize:10, fontFamily:MONO, color:C.t2, background:C.bg2, border:`1px solid ${C.border}`, borderRadius:6, padding:"4px 10px", wordBreak:"break-all" as const, display:"block" }}>
            {cwd}
          </span>
        </div>

        {/* Steps — step 4 updated: no need to reopen */}
        <div style={{ width:"100%", background:C.bg2, border:`1px solid ${C.border}`, borderRadius:8, padding:"10px 12px", display:"flex", flexDirection:"column", gap:6 }}>
          {[
            "1. Click Copy above",
            "2. Open the terminal (w1 tab)",
            "3. Paste & press Enter",
            "4. This panel updates automatically ✓",
          ].map((step, i) => (
            <div key={i} style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ width:5, height:5, borderRadius:"50%", background: i === 3 ? C.green : C.t3, flexShrink:0 }} />
              <span style={{ fontSize:11, fontFamily:SANS, color: i === 3 ? C.green : C.t2 }}>{step}</span>
            </div>
          ))}
        </div>
      </div>
      <style>{`
        @keyframes gitspin  { to { transform: rotate(360deg); } }
        @keyframes gitpulse { 0%,100% { opacity:.3; } 50% { opacity:1; } }
      `}</style>
    </div>
  );
}

export function GitWorktreePanel({ runboxCwd, runboxId, branch, onClose, onFileClick }: GitPanelProps) {
  const [isGitRepo,   setIsGitRepo]   = useState<boolean | null>(null); // null = loading
  const [tab,         setTab]         = useState<Tab>("changes");
  const [files,       setFiles]       = useState<LiveDiffFile[]>([]);
  const [commits,     setCommits]     = useState<GitCommit[]>([]);
  const [worktrees,   setWorktrees]   = useState<WorktreeEntry[]>([]);
  const [conflicts,   setConflicts]   = useState<ConflictFile[]>([]);
  const [allBranches, setAllBranches] = useState<string[]>([]);
  const [message,     setMessage]     = useState("");
  const [committing,  setCommitting]  = useState(false);
  const [pushing,     setPushing]     = useState(false);
  const [notice,      setNotice]      = useState<{ text: string; ok: boolean } | null>(null);
  const [showNewWt,   setShowNewWt]   = useState(false);
  const [wtName,      setWtName]      = useState("");
  const [newBranch,   setNewBranch]   = useState("");
  const [creating,    setCreating]    = useState(false);
  const [diffTarget,  setDiffTarget]  = useState<string | null>(null);
  const [diffResult,  setDiffResult]  = useState("");
  const [diffLoading, setDiffLoading] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const showNotice = (text: string, ok: boolean) => { setNotice({ text, ok }); setTimeout(() => setNotice(null), 3000); };

  // ── Detect git repo — auto-init if missing ───────────────────────────────
  useEffect(() => {
    const detect = async () => {
      // Strategy 1: branch name returned = definitely a git repo
      try {
        const b = await invoke<string>("git_current_branch", { cwd: runboxCwd });
        if (b && b.trim().length > 0) { setIsGitRepo(true); return; }
      } catch { /* not git */ }

      // Strategy 2: worktree list with at least one entry = git repo
      try {
        const wts = await invoke<any[]>("git_worktree_list", { cwd: runboxCwd });
        if (Array.isArray(wts) && wts.length > 0) { setIsGitRepo(true); return; }
      } catch { /* not git */ }

      // No git repo — silently auto-init
      try {
        await invoke("git_init", { cwd: runboxCwd });
        // Re-check after init
        const b2 = await invoke<string>("git_current_branch", { cwd: runboxCwd });
        if (b2 && b2.trim().length > 0) { setIsGitRepo(true); return; }
        const wts2 = await invoke<any[]>("git_worktree_list", { cwd: runboxCwd });
        if (Array.isArray(wts2) && wts2.length > 0) { setIsGitRepo(true); return; }
        // init succeeded but branch still empty (fresh repo) — still treat as git repo
        setIsGitRepo(true);
      } catch {
        // git_init not available — fall back to showing NoGitPane
        setIsGitRepo(false);
      }
    };
    detect();
  }, [runboxCwd, runboxId]);

  const loadFiles     = useCallback(() => { invoke<LiveDiffFile[]>("git_diff_live", { cwd:runboxCwd, runboxId }).then(f => setFiles(f.sort((a,b)=>(b.modified_at||0)-(a.modified_at||0)))).catch(() => {}); }, [runboxCwd, runboxId]);
  const loadCommits   = useCallback(() => { invoke<GitCommit[]>("git_log_for_runbox", { cwd:runboxCwd, runboxId }).then(setCommits).catch(() => {}); }, [runboxCwd, runboxId]);
  const loadWorktrees = useCallback(() => { invoke<WorktreeEntry[]>("git_worktree_list", { cwd:runboxCwd }).then(setWorktrees).catch(() => {}); }, [runboxCwd]);
  const loadConflicts = useCallback(() => { invoke<ConflictFile[]>("git_conflicts", { cwd:runboxCwd }).then(setConflicts).catch(() => setConflicts([])); }, [runboxCwd]);
  const loadBranches  = useCallback(() => { invoke<string[]>("git_branches", { cwd:runboxCwd }).then(setAllBranches).catch(() => {}); }, [runboxCwd]);

  useEffect(() => {
    if (!isGitRepo) return;
    loadFiles(); loadCommits(); loadWorktrees(); loadConflicts(); loadBranches();
  }, [isGitRepo, loadFiles, loadCommits, loadWorktrees, loadConflicts, loadBranches]);

  useEffect(() => {
    if (!isGitRepo) return;
    invoke("git_watch_start", { cwd:runboxCwd, runboxId }).catch(() => {});
    return () => { invoke("git_watch_stop", { cwd:runboxCwd }).catch(() => {}); };
  }, [isGitRepo, runboxCwd, runboxId]);

  useEffect(() => {
    if (!isGitRepo) return;
    const u = listen<LiveDiffFile[]>("git:live-diff", ({ payload }) => { setFiles(payload.sort((a,b)=>(b.modified_at||0)-(a.modified_at||0))); loadConflicts(); });
    return () => { u.then(f => f()); };
  }, [isGitRepo, loadConflicts]);

  // ── Loading state ─────────────────────────────────────────────────────────
  if (isGitRepo === null) {
    return (
      <div style={{ display:"flex", flexDirection:"column", height:"100%", background:C.bg1 }}>
        <div style={{ height:48, padding:"0 14px", flexShrink:0, borderBottom:`1px solid ${C.border}`, display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:13, fontWeight:600, color:C.t0, flex:1, fontFamily:SANS }}>Source Control</span>
          <button onClick={onClose} style={{ width:28, height:28, display:"flex", alignItems:"center", justifyContent:"center", background:"none", border:"none", color:C.t2, fontSize:14, borderRadius:8, cursor:"pointer" }}>✕</button>
        </div>
        <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <div style={{ width:16, height:16, border:`2px solid ${C.border}`, borderTopColor:C.t1, borderRadius:"50%", animation:"gitspin .7s linear infinite" }} />
        </div>
        <style>{`@keyframes gitspin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── No git repo ───────────────────────────────────────────────────────────
  if (!isGitRepo) return <NoGitPane cwd={runboxCwd} onClose={onClose} onInitDone={() => setIsGitRepo(null)} />;

  const handleCommit = async () => {
    if (!message.trim()) { textRef.current?.focus(); return; }
    setCommitting(true);
    try { showNotice(await invoke<string>("git_stage_and_commit", { cwd:runboxCwd, runboxId, message:message.trim() }), true); setMessage(""); loadFiles(); loadCommits(); }
    catch (e: any) { showNotice(String(e), false); } finally { setCommitting(false); }
  };
  const handlePush = async () => {
    setPushing(true);
    try { showNotice(await invoke<string>("git_push", { cwd:runboxCwd, runboxId }) || "Pushed.", true); }
    catch (e: any) { showNotice(String(e), false); } finally { setPushing(false); }
  };
  const handleCommitPush = async () => {
    if (!message.trim()) { textRef.current?.focus(); return; }
    setCommitting(true);
    try {
      showNotice(await invoke<string>("git_stage_and_commit", { cwd:runboxCwd, runboxId, message:message.trim() }), true);
      setMessage(""); loadFiles(); loadCommits();
      setPushing(true);
      showNotice(await invoke<string>("git_push", { cwd:runboxCwd, runboxId }) || "Pushed.", true);
    } catch (e: any) { showNotice(String(e), false); }
    finally { setCommitting(false); setPushing(false); }
  };
  const handleCreateWt = async () => {
    if (!wtName.trim()) return; setCreating(true);
    try {
      const bn = newBranch.trim() || wtName.trim();
      await invoke<string>("git_worktree_create", { cwd:runboxCwd, branch:bn, wtName:wtName.trim() });
      showNotice(`Created on ${bn}`, true); setShowNewWt(false); setWtName(""); setNewBranch(""); loadWorktrees(); loadBranches();
    } catch (e: any) { showNotice(String(e), false); } finally { setCreating(false); }
  };
  const handleDiff = async (wtPath: string) => {
    if (diffTarget === wtPath) { setDiffTarget(null); setDiffResult(""); return; }
    setDiffTarget(wtPath); setDiffLoading(true);
    try { setDiffResult(await invoke<string>("git_diff_between_worktrees", { cwd:runboxCwd, otherCwd:wtPath }) || "No differences."); }
    catch (e: any) { setDiffResult(String(e)); } finally { setDiffLoading(false); }
  };
  const handleSwitch = async (b: string) => {
    try { await invoke("git_checkout", { cwd:runboxCwd, branch:b }); showNotice(`→ ${b}`, true); loadFiles(); loadCommits(); loadBranches(); }
    catch (e: any) { showNotice(String(e), false); }
  };

  const busy = committing || pushing;
  const totalIns = files.reduce((s,f) => s+f.insertions, 0);
  const totalDel = files.reduce((s,f) => s+f.deletions, 0);

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:C.bg1 }}>

      {/* Header */}
      <div style={{ height:48, padding:"0 14px", flexShrink:0, borderBottom:`1px solid ${C.border}`, display:"flex", alignItems:"center", gap:8 }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.t2} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}>
          <line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>
        </svg>
        <span style={{ fontSize:13, fontWeight:600, color:C.t0, flex:1, fontFamily:SANS }}>Source Control</span>
        {conflicts.length > 0 && <span style={{ fontSize:10, fontFamily:MONO, color:C.amber, background:C.amberBg, border:`1px solid ${C.amber}40`, borderRadius:6, padding:"2px 7px" }}>⚡ {conflicts.length}</span>}
        <button onClick={handlePush} disabled={busy}
          style={{ padding:"5px 11px", background:"transparent", border:`1px solid ${C.border}`, borderRadius:8, color:busy?C.t3:C.t2, fontSize:11, fontFamily:SANS, cursor:busy?"default":"pointer", transition:"all .1s" }}
          onMouseEnter={e => { if (!busy) { const el=e.currentTarget as HTMLElement; el.style.borderColor=C.borderMd; el.style.color=C.t0; } }}
          onMouseLeave={e => { const el=e.currentTarget as HTMLElement; el.style.borderColor=C.border; el.style.color=busy?C.t3:C.t2; }}>
          ↑ Push
        </button>
        <button onClick={onClose}
          style={{ width:28, height:28, display:"flex", alignItems:"center", justifyContent:"center", background:"none", border:"none", color:C.t2, fontSize:14, borderRadius:8, cursor:"pointer", transition:"all .1s" }}
          onMouseEnter={e => { const el=e.currentTarget as HTMLElement; el.style.background=C.bg3; el.style.color=C.t0; }}
          onMouseLeave={e => { const el=e.currentTarget as HTMLElement; el.style.background="transparent"; el.style.color=C.t2; }}>✕</button>
      </div>

      {/* Branch row */}
      <div style={{ padding:"8px 12px", borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:6, background:C.bg2, border:`1px solid ${C.border}`, borderRadius:8, padding:"6px 10px" }}>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>
          </svg>
          <span style={{ fontSize:12, fontFamily:MONO, color:C.t1, fontWeight:500, flex:1 }}>{branch || "main"}</span>
          <span style={{ fontSize:10, fontFamily:MONO, color:C.t3 }}>{files.length > 0 ? `${files.length} change${files.length!==1?"s":""}` : "clean"}</span>
        </div>
      </div>

      {/* Notice */}
      {notice && (
        <div style={{ margin:"0 8px 4px", padding:"7px 12px", borderRadius:8, background:C.bg2, border:`1px solid ${notice.ok?C.border:C.red+"33"}`, fontSize:11, color:notice.ok?C.t1:C.red, fontFamily:SANS }}>
          {notice.text}
        </div>
      )}

      {/* Conflict list */}
      {conflicts.length > 0 && (
        <div style={{ margin:"0 8px 4px", padding:"8px 12px", borderRadius:8, background:C.amberBg, border:`1px solid ${C.amber}33` }}>
          <div style={{ fontSize:11, fontWeight:600, color:C.amber, fontFamily:SANS, marginBottom:5 }}>⚡ Conflicts</div>
          {conflicts.map(cf => (
            <div key={cf.path} style={{ display:"flex", gap:6, alignItems:"center", marginBottom:3 }}>
              <span style={{ fontSize:9, fontFamily:MONO, color:C.t2, background:C.bg4, borderRadius:3, padding:"0 4px" }}>{cf.status}</span>
              <span style={{ fontSize:11, fontFamily:MONO, color:C.t1 }}>{cf.path}</span>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div style={{ padding:"8px 12px", borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
        <div style={{ display:"flex", background:C.bg0, borderRadius:8, padding:3 }}>
          {([
            ["changes",   files.length > 0 ? `Changes (${files.length})` : "Changes"],
            ["branches",  "Branches"],
            ["history",   "History"],
            ["worktrees", `Trees (${worktrees.length})`],
          ] as [Tab, string][]).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              style={{ flex:1, padding:"5px 0", borderRadius:6, border:"none", background:tab===t?C.bg4:"transparent", color:tab===t?C.t0:C.t2, fontSize:11, fontFamily:SANS, fontWeight:tab===t?600:400, cursor:"pointer", transition:"all .1s" }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Changes ── */}
      {tab === "changes" && (
        <div style={{ display:"flex", flexDirection:"column", flex:1, minHeight:0 }}>
          {files.length > 0 && (
            <div style={{ display:"flex", borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
              {[{l:"ADDED",val:files.filter(f=>f.change_type==="created").length},{l:"CHANGED",val:files.filter(f=>f.change_type==="modified").length},{l:"DELETED",val:files.filter(f=>f.change_type==="deleted").length}]
                .filter(x=>x.val>0).map(({l,val})=>(
                <div key={l} style={{ flex:1, padding:"6px 12px", borderRight:`1px solid ${C.border}` }}>
                  <div style={{ fontSize:8, fontFamily:MONO, letterSpacing:".10em", color:C.t3, marginBottom:2 }}>{l}</div>
                  <span style={{ fontSize:14, fontFamily:MONO, fontWeight:700, color: l==="ADDED" ? C.green : l==="DELETED" ? C.red : C.t0 }}>{val}</span>
                </div>
              ))}
              {(totalIns > 0 || totalDel > 0) && (
                <div style={{ flex:1, padding:"6px 12px" }}>
                  <div style={{ fontSize:8, fontFamily:MONO, letterSpacing:".10em", color:C.t3, marginBottom:2 }}>LINES</div>
                  <div style={{ display:"flex", gap:4 }}>
                    {totalIns > 0 && <span style={{ fontSize:12, fontFamily:MONO, fontWeight:700, color:C.green }}>+{totalIns}</span>}
                    {totalDel > 0 && <span style={{ fontSize:12, fontFamily:MONO, fontWeight:700, color:C.red }}>-{totalDel}</span>}
                  </div>
                </div>
              )}
            </div>
          )}

          <div style={{ padding:"8px", borderBottom:`1px solid ${C.border}`, flexShrink:0, display:"flex", flexDirection:"column", gap:6 }}>
            <textarea ref={textRef} value={message} onChange={e => setMessage(e.target.value)}
              placeholder="Commit message…" rows={2}
              onKeyDown={e => { if ((e.metaKey||e.ctrlKey) && e.key==="Enter") { e.preventDefault(); handleCommit(); } }}
              style={{ width:"100%", boxSizing:"border-box", background:C.bg0, border:`1px solid ${C.border}`, borderRadius:8, color:C.t0, fontSize:12, padding:"8px 10px", resize:"none", outline:"none", fontFamily:SANS, lineHeight:1.5, transition:"border-color .15s" }}
              onFocus={e => e.currentTarget.style.borderColor=C.borderHi}
              onBlur={e  => e.currentTarget.style.borderColor=C.border} />
            <div style={{ display:"flex", gap:6 }}>
              <button onClick={handleCommit} disabled={busy||!message.trim()}
                style={{ flex:1, padding:"7px 0", borderRadius:8, border:`1px solid ${message.trim()&&!busy?C.borderMd:C.border}`, background:message.trim()&&!busy?C.bg4:"transparent", color:message.trim()&&!busy?C.t0:C.t3, fontSize:11, fontFamily:SANS, fontWeight:600, cursor:message.trim()&&!busy?"pointer":"default", transition:"all .1s" }}>
                {committing&&!pushing?"…":"✓ Commit"}
              </button>
              <button onClick={handleCommitPush} disabled={busy||!message.trim()}
                style={{ flex:1, padding:"7px 0", borderRadius:8, border:`1px solid ${message.trim()&&!busy?C.borderMd:C.border}`, background:"transparent", color:message.trim()&&!busy?C.t1:C.t3, fontSize:11, fontFamily:SANS, fontWeight:600, cursor:message.trim()&&!busy?"pointer":"default", transition:"all .1s" }}>
                {pushing?"…":"↑ Commit & Push"}
              </button>
            </div>
          </div>

          <div style={{ flex:1, overflowY:"auto", padding:"8px", display:"flex", flexDirection:"column", gap:3 }}>
            {files.length === 0 && (
              <div style={{ padding:"32px 0", display:"flex", flexDirection:"column", alignItems:"center", gap:8 }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                <span style={{ fontSize:12, color:C.t2, fontFamily:SANS }}>No changes</span>
              </div>
            )}
            {files.map(fc => {
              const fileName    = fc.path.split(/[/\\]/).pop() ?? fc.path;
              const dirPart     = fc.path.slice(0, fc.path.length - fileName.length);
              const letter      = { created:"A", modified:"M", deleted:"D" }[fc.change_type];
              const letterColor = { created:C.green, modified:C.t2, deleted:C.red }[fc.change_type];
              return (
                <div key={fc.path} onClick={() => onFileClick?.(fc)}
                  style={{ background:C.bg2, border:`1px solid ${C.border}`, borderRadius:8, padding:"8px 10px", cursor:"pointer", transition:"all .1s", display:"flex", alignItems:"center", gap:8 }}
                  onMouseEnter={e => { const el=e.currentTarget as HTMLElement; el.style.background=C.bg3; el.style.borderColor=C.borderMd; }}
                  onMouseLeave={e => { const el=e.currentTarget as HTMLElement; el.style.background=C.bg2; el.style.borderColor=C.border; }}>
                  <span style={{ fontSize:10, fontFamily:MONO, fontWeight:700, color:letterColor, width:10, flexShrink:0, textAlign:"center" }}>{letter}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12, fontFamily:MONO, color:C.t0, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{fileName}</div>
                    {dirPart && <div style={{ fontSize:10, fontFamily:MONO, color:C.t2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginTop:1 }}>{dirPart}</div>}
                  </div>
                  <div style={{ display:"flex", gap:5, flexShrink:0 }}>
                    {fc.insertions > 0 && <span style={{ fontSize:10, fontFamily:MONO, color:C.green, fontWeight:600 }}>+{fc.insertions}</span>}
                    {fc.deletions  > 0 && <span style={{ fontSize:10, fontFamily:MONO, color:C.red,   fontWeight:600 }}>-{fc.deletions}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Branches ── */}
      {tab === "branches" && (
        <div style={{ flex:1, overflowY:"auto", padding:"8px", display:"flex", flexDirection:"column", gap:3 }}>
          {allBranches.length === 0 && <div style={{ padding:"32px 0", textAlign:"center", fontSize:12, color:C.t2, fontFamily:SANS }}>No branches found.</div>}
          {allBranches.map(b => {
            const clean    = b.replace("remotes/origin/","").replace("heads/","");
            const isActive = clean === branch || b === branch;
            const isRemote = b.startsWith("remotes/");
            return (
              <div key={b} style={{ background:isActive?C.bg3:C.bg2, border:`1px solid ${isActive?C.borderMd:C.border}`, borderRadius:8, padding:"8px 10px", display:"flex", alignItems:"center", gap:8 }}>
                <div style={{ width:6, height:6, borderRadius:"50%", background:isActive?C.t0:C.t3, flexShrink:0 }} />
                <span style={{ fontSize:12, fontFamily:MONO, color:isActive?C.t0:C.t1, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {isActive && <span style={{ color:C.t3, marginRight:5 }}>→</span>}{clean}
                </span>
                {isRemote && <span style={{ fontSize:9, fontFamily:MONO, color:C.t3, background:C.bg4, borderRadius:4, padding:"1px 5px" }}>remote</span>}
                {isActive && <span style={{ fontSize:10, fontFamily:SANS, color:C.t3, background:C.bg4, borderRadius:6, padding:"2px 7px" }}>current</span>}
                {!isActive && !isRemote && (
                  <button onClick={() => handleSwitch(clean)}
                    style={{ padding:"4px 10px", background:"transparent", border:`1px solid ${C.border}`, borderRadius:6, color:C.t2, fontSize:10, fontFamily:SANS, cursor:"pointer", transition:"all .1s" }}
                    onMouseEnter={e => { const el=e.currentTarget as HTMLElement; el.style.borderColor=C.borderMd; el.style.color=C.t0; }}
                    onMouseLeave={e => { const el=e.currentTarget as HTMLElement; el.style.borderColor=C.border; el.style.color=C.t2; }}>
                    Switch
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── History ── */}
      {tab === "history" && (
        <div style={{ flex:1, overflowY:"auto", padding:"8px", display:"flex", flexDirection:"column", gap:3 }}>
          {commits.length === 0 && <div style={{ padding:"32px 0", textAlign:"center", fontSize:12, color:C.t2, fontFamily:SANS }}>No commits yet.</div>}
          {commits.map((c, i) => (
            <div key={c.hash} style={{ background:i===0?C.bg3:C.bg2, border:`1px solid ${i===0?C.borderMd:C.border}`, borderRadius:8, padding:"9px 10px", display:"flex", gap:10, alignItems:"flex-start" }}>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", flexShrink:0, paddingTop:2, gap:3 }}>
                <div style={{ width:7, height:7, borderRadius:"50%", background:i===0?C.t0:C.t3 }} />
                {i < commits.length-1 && <div style={{ width:1, height:14, background:C.border }} />}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:12, color:i===0?C.t0:C.t1, fontFamily:SANS, fontWeight:i===0?500:400, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginBottom:3 }}>{c.message}</div>
                <div style={{ display:"flex", gap:8 }}>
                  <span style={{ fontSize:10, fontFamily:MONO, color:C.t3 }}>{c.short_hash}</span>
                  <span style={{ fontSize:10, color:C.t3, fontFamily:SANS }}>{c.author.split(" ")[0]}</span>
                  <span style={{ fontSize:10, color:C.t3, fontFamily:SANS }}>{reldate(c.date)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Worktrees ── */}
      {tab === "worktrees" && (
        <div style={{ flex:1, overflowY:"auto", padding:"8px", display:"flex", flexDirection:"column", gap:4 }}>
          {!showNewWt ? (
            <button onClick={() => setShowNewWt(true)}
              style={{ width:"100%", padding:"10px", borderRadius:8, background:"transparent", border:`1px dashed ${C.border}`, color:C.t2, fontSize:12, fontFamily:SANS, cursor:"pointer", transition:"all .15s", display:"flex", alignItems:"center", justifyContent:"center", gap:7 }}
              onMouseEnter={e => { const el=e.currentTarget as HTMLElement; el.style.borderColor=C.borderMd; el.style.color=C.t0; el.style.background=C.bg2; }}
              onMouseLeave={e => { const el=e.currentTarget as HTMLElement; el.style.borderColor=C.border; el.style.color=C.t2; el.style.background="transparent"; }}>
              <span style={{ fontSize:16, fontWeight:300, lineHeight:1 }}>+</span>New worktree
            </button>
          ) : (
            <div style={{ background:C.bg2, border:`1px solid ${C.borderMd}`, borderRadius:10, padding:10, display:"flex", flexDirection:"column", gap:6 }}>
              <input value={wtName} onChange={e => setWtName(e.target.value)} placeholder="Worktree name" autoFocus
                style={{ background:C.bg0, border:`1px solid ${C.border}`, borderRadius:8, color:C.t0, fontSize:12, padding:"7px 10px", outline:"none", fontFamily:MONO, transition:"border-color .15s" }}
                onFocus={e => e.currentTarget.style.borderColor=C.borderHi}
                onBlur={e  => e.currentTarget.style.borderColor=C.border} />
              <input value={newBranch} onChange={e => setNewBranch(e.target.value)} placeholder={`Branch (default: ${wtName||"name"})`}
                style={{ background:C.bg0, border:`1px solid ${C.border}`, borderRadius:8, color:C.t1, fontSize:12, padding:"7px 10px", outline:"none", fontFamily:MONO }} />
              <div style={{ display:"flex", gap:6 }}>
                <button onClick={() => { setShowNewWt(false); setWtName(""); setNewBranch(""); }}
                  style={{ padding:"7px 14px", background:"transparent", border:`1px solid ${C.border}`, borderRadius:8, color:C.t2, fontSize:11, fontFamily:SANS, cursor:"pointer" }}>Cancel</button>
                <button onClick={handleCreateWt} disabled={creating||!wtName.trim()}
                  style={{ flex:1, padding:"7px 0", borderRadius:8, border:"none", background:wtName.trim()&&!creating?C.t0:C.bg4, color:wtName.trim()&&!creating?C.bg0:C.t3, fontSize:11, fontFamily:SANS, fontWeight:600, cursor:wtName.trim()&&!creating?"pointer":"default" }}>
                  {creating?"Creating…":"Create"}
                </button>
              </div>
            </div>
          )}

          {worktrees.length === 0 && !showNewWt && (
            <div style={{ padding:"24px 0", display:"flex", flexDirection:"column", alignItems:"center", gap:8 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>
              </svg>
              <span style={{ fontSize:12, color:C.t2, fontFamily:SANS }}>No worktrees yet</span>
            </div>
          )}

          {worktrees.map(wt => {
            const shortPath  = wt.path.split(/[/\\]/).pop() ?? wt.path;
            const isDiffOpen = diffTarget === wt.path;
            return (
              <div key={wt.path} style={{ background:C.bg2, border:`1px solid ${C.border}`, borderRadius:8, overflow:"hidden" }}>
                <div style={{ padding:"9px 10px", display:"flex", alignItems:"center", gap:8 }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:2 }}>
                      <span style={{ fontSize:12, fontFamily:MONO, color:wt.is_main?C.t0:C.t1, fontWeight:wt.is_main?500:400, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{shortPath}</span>
                      {wt.is_main && <span style={{ fontSize:9, fontFamily:SANS, color:C.t3, background:C.bg4, borderRadius:4, padding:"1px 5px", flexShrink:0 }}>main</span>}
                      {wt.is_locked && <span style={{ fontSize:9, color:C.t2, fontFamily:SANS, flexShrink:0 }}>locked</span>}
                    </div>
                    <span style={{ fontSize:10, fontFamily:MONO, color:C.t3 }}>⎇ {wt.branch||"detached"} · {wt.head.slice(0,7)}</span>
                  </div>
                  {!wt.is_main && (
                    <button onClick={() => handleDiff(wt.path)}
                      style={{ padding:"4px 9px", background:isDiffOpen?C.bg4:"transparent", border:`1px solid ${isDiffOpen?C.borderMd:C.border}`, borderRadius:6, color:isDiffOpen?C.t0:C.t2, fontSize:10, fontFamily:SANS, cursor:"pointer", flexShrink:0, transition:"all .1s" }}
                      onMouseEnter={e => { const el=e.currentTarget as HTMLElement; el.style.borderColor=C.borderMd; el.style.color=C.t0; }}
                      onMouseLeave={e => { const el=e.currentTarget as HTMLElement; el.style.borderColor=isDiffOpen?C.borderMd:C.border; el.style.color=isDiffOpen?C.t0:C.t2; }}>
                      {isDiffOpen?"Hide":"Diff"}
                    </button>
                  )}
                </div>
                {isDiffOpen && (
                  <div style={{ padding:"0 10px 10px" }}>
                    {diffLoading
                      ? <div style={{ fontSize:11, color:C.t2, fontFamily:SANS }}>Computing…</div>
                      : <pre style={{ margin:0, fontSize:10, fontFamily:MONO, color:C.t1, whiteSpace:"pre-wrap", wordBreak:"break-all", maxHeight:200, overflow:"auto", background:C.bg0, borderRadius:6, padding:"8px 10px", border:`1px solid ${C.border}` }}>{diffResult}</pre>
                    }
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <style>{`@keyframes gitspin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}