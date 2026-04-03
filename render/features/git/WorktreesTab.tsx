import { useState } from "react";
import { C, MONO, SANS } from "../../design";
import type { WorktreeEntry } from "./types";

interface Props {
  worktrees:      WorktreeEntry[];
  onCreateWorktree: (name: string, branch: string) => Promise<void>;
  onDiff:         (wtPath: string) => Promise<string>;
}

export function WorktreesTab({ worktrees, onCreateWorktree, onDiff }: Props) {
  const [showNewWt,   setShowNewWt]   = useState(false);
  const [wtName,      setWtName]      = useState("");
  const [newBranch,   setNewBranch]   = useState("");
  const [creating,    setCreating]    = useState(false);
  const [diffTarget,  setDiffTarget]  = useState<string | null>(null);
  const [diffResult,  setDiffResult]  = useState("");
  const [diffLoading, setDiffLoading] = useState(false);

  const handleCreate = async () => {
    if (!wtName.trim()) return;
    setCreating(true);
    try { await onCreateWorktree(wtName.trim(), newBranch.trim()); setShowNewWt(false); setWtName(""); setNewBranch(""); }
    finally { setCreating(false); }
  };

  const handleDiff = async (wtPath: string) => {
    if (diffTarget === wtPath) { setDiffTarget(null); setDiffResult(""); return; }
    setDiffTarget(wtPath); setDiffLoading(true);
    try { setDiffResult(await onDiff(wtPath) || "No differences."); }
    catch (e: any) { setDiffResult(String(e)); }
    finally { setDiffLoading(false); }
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "8px", display: "flex", flexDirection: "column", gap: 4 }}>
      {!showNewWt ? (
        <button onClick={() => setShowNewWt(true)}
          style={{ width: "100%", padding: "10px", borderRadius: 8, background: "transparent", border: `1px dashed ${C.border}`, color: C.t2, fontSize: 12, fontFamily: SANS, cursor: "pointer", transition: "all .15s", display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}
          onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = C.borderMd; el.style.color = C.t0; el.style.background = C.bg2; }}
          onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = C.border; el.style.color = C.t2; el.style.background = "transparent"; }}>
          <span style={{ fontSize: 16, fontWeight: 300, lineHeight: 1 }}>+</span>New worktree
        </button>
      ) : (
        <div style={{ background: C.bg2, border: `1px solid ${C.borderMd}`, borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          <input value={wtName} onChange={e => setWtName(e.target.value)} placeholder="Worktree name" autoFocus
            style={{ background: C.bg0, border: `1px solid ${C.border}`, borderRadius: 8, color: C.t0, fontSize: 12, padding: "7px 10px", outline: "none", fontFamily: MONO }} />
          <input value={newBranch} onChange={e => setNewBranch(e.target.value)} placeholder={`Branch (default: ${wtName || "name"})`}
            style={{ background: C.bg0, border: `1px solid ${C.border}`, borderRadius: 8, color: C.t1, fontSize: 12, padding: "7px 10px", outline: "none", fontFamily: MONO }} />
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => { setShowNewWt(false); setWtName(""); setNewBranch(""); }}
              style={{ padding: "7px 14px", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.t2, fontSize: 11, fontFamily: SANS, cursor: "pointer" }}>Cancel</button>
            <button onClick={handleCreate} disabled={creating || !wtName.trim()}
              style={{ flex: 1, padding: "7px 0", borderRadius: 8, border: "none", background: wtName.trim() && !creating ? C.t0 : C.bg4, color: wtName.trim() && !creating ? C.bg0 : C.t3, fontSize: 11, fontFamily: SANS, fontWeight: 600, cursor: wtName.trim() && !creating ? "pointer" : "default" }}>
              {creating ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      )}

      {worktrees.map(wt => {
        const shortPath  = wt.path.split(/[/\\]/).pop() ?? wt.path;
        const isDiffOpen = diffTarget === wt.path;
        return (
          <div key={wt.path} style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
            <div style={{ padding: "9px 10px", display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 12, fontFamily: MONO, color: wt.is_main ? C.t0 : C.t1, fontWeight: wt.is_main ? 500 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortPath}</span>
                  {wt.is_main && <span style={{ fontSize: 9, fontFamily: SANS, color: C.t3, background: C.bg4, borderRadius: 4, padding: "1px 5px", flexShrink: 0 }}>main</span>}
                  {wt.is_locked && <span style={{ fontSize: 9, color: C.t2, fontFamily: SANS, flexShrink: 0 }}>locked</span>}
                </div>
                <span style={{ fontSize: 10, fontFamily: MONO, color: C.t3 }}>⎇ {wt.branch || "detached"} · {wt.head.slice(0, 7)}</span>
              </div>
              {!wt.is_main && (
                <button onClick={() => handleDiff(wt.path)}
                  style={{ padding: "4px 9px", background: isDiffOpen ? C.bg4 : "transparent", border: `1px solid ${isDiffOpen ? C.borderMd : C.border}`, borderRadius: 6, color: isDiffOpen ? C.t0 : C.t2, fontSize: 10, fontFamily: SANS, cursor: "pointer", flexShrink: 0, transition: "all .1s" }}>
                  {isDiffOpen ? "Hide" : "Diff"}
                </button>
              )}
            </div>
            {isDiffOpen && (
              <div style={{ padding: "0 10px 10px" }}>
                {diffLoading
                  ? <div style={{ fontSize: 11, color: C.t2, fontFamily: SANS }}>Computing…</div>
                  : <pre style={{ margin: 0, fontSize: 10, fontFamily: MONO, color: C.t1, whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 200, overflow: "auto", background: C.bg0, borderRadius: 6, padding: "8px 10px", border: `1px solid ${C.border}` }}>{diffResult}</pre>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}