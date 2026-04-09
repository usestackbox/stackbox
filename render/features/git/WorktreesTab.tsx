// features/git/WorktreesTab.tsx
import { useState } from "react";
import { C, MONO, SANS } from "../../design";
import type { WorktreeEntry } from "./types";

interface Props {
  worktrees: WorktreeEntry[];
  onCreateWorktree: (wtName: string, newBranch: string) => Promise<void>;
  onDiff: (wtPath: string) => Promise<string>;
}

export function WorktreesTab({ worktrees, onCreateWorktree, onDiff }: Props) {
  const [showNew, setShowNew] = useState(false);
  const [wtName, setWtName] = useState("");
  const [newBranch, setNewBranch] = useState("");
  const [creating, setCreating] = useState(false);
  const [diffText, setDiffText] = useState<Record<string, string>>({});
  const [loadingDiff, setLoadingDiff] = useState<string | null>(null);
  const [expandedPath, setExpandedPath] = useState<string | null>(null);

  // Filter out the main worktree — it's just noise in this list
  const nonMain = worktrees.filter((wt) => !wt.is_main);

  const handleCreate = async () => {
    const name = wtName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await onCreateWorktree(name, newBranch.trim());
      setWtName("");
      setNewBranch("");
      setShowNew(false);
    } finally {
      setCreating(false);
    }
  };

  const handleToggleDiff = async (path: string) => {
    if (expandedPath === path) { setExpandedPath(null); return; }
    setExpandedPath(path);
    if (diffText[path] !== undefined) return;
    setLoadingDiff(path);
    try {
      const d = await onDiff(path);
      setDiffText((prev) => ({ ...prev, [path]: d }));
    } catch (e) {
      setDiffText((prev) => ({ ...prev, [path]: `Error: ${e}` }));
    } finally {
      setLoadingDiff(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflowY: "auto" }}>
      <div style={{ padding: "8px", display: "flex", flexDirection: "column", gap: 4 }}>
        {nonMain.length === 0 && (
          <div style={{ padding: "32px 0", textAlign: "center", fontSize: 12, color: C.t3, fontFamily: SANS }}>
            No worktrees yet.
          </div>
        )}

        {nonMain.map((wt) => {
          const isExpanded = expandedPath === wt.path;
          const diff       = diffText[wt.path];
          const loading    = loadingDiff === wt.path;
          const shortBranch = wt.branch.split("/").pop() ?? wt.branch;

          return (
            <div key={wt.path} style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
              <div
                style={{ padding: "9px 10px", display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
                onClick={() => handleToggleDiff(wt.path)}
              >
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.t3, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontFamily: MONO, color: C.t0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {shortBranch}
                  </div>
                  <div style={{ fontSize: 10, fontFamily: MONO, color: C.t3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
                    {wt.path.split(/[/\\]/).slice(-2).join("/")}
                  </div>
                </div>
                {wt.is_locked && (
                  <span style={{ fontSize: 10, fontFamily: MONO, color: C.amber, flexShrink: 0 }}>locked</span>
                )}
                {loading ? (
                  <div style={{ width: 11, height: 11, border: `1.5px solid ${C.border}`, borderTopColor: C.t1, borderRadius: "50%", animation: "wtspin .7s linear infinite", flexShrink: 0 }} />
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                    style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform .15s", flexShrink: 0 }}>
                    <polyline points="9 6 15 12 9 18" />
                  </svg>
                )}
              </div>

              {isExpanded && !loading && diff !== undefined && (
                <div style={{ borderTop: `1px solid ${C.border}`, background: C.bg0, maxHeight: 300, overflowY: "auto" }}>
                  {!diff.trim() ? (
                    <div style={{ padding: "10px 12px", fontSize: 11, color: C.t3, fontFamily: SANS }}>No diff.</div>
                  ) : (
                    <pre style={{ margin: 0, padding: "8px 12px", fontSize: 11, fontFamily: MONO, color: C.t2, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                      {diff}
                    </pre>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ padding: "0 8px 8px", flexShrink: 0 }}>
        {!showNew ? (
          <button
            onClick={() => setShowNew(true)}
            style={{ width: "100%", padding: "8px", borderRadius: 8, background: "transparent", border: `1px dashed ${C.border}`, color: C.t2, fontSize: 12, fontFamily: SANS, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, transition: "all .15s" }}
            onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.borderColor = C.borderMd; el.style.color = C.t0; el.style.background = C.bg2; }}
            onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.borderColor = C.border; el.style.color = C.t2; el.style.background = "transparent"; }}
          >
            <span style={{ fontSize: 16, fontWeight: 300, lineHeight: "1" }}>+</span>
            New Worktree
          </button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <input
              value={wtName}
              onChange={(e) => setWtName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") { setShowNew(false); setWtName(""); setNewBranch(""); } }}
              placeholder="Worktree name"
              autoFocus
              style={{ background: C.bg0, border: `1px solid ${C.borderMd}`, borderRadius: 8, color: C.t0, fontSize: 12, padding: "7px 10px", outline: "none", fontFamily: MONO, width: "100%", boxSizing: "border-box" }}
            />
            <input
              value={newBranch}
              onChange={(e) => setNewBranch(e.target.value)}
              placeholder="Branch name (optional)"
              style={{ background: C.bg0, border: `1px solid ${C.border}`, borderRadius: 8, color: C.t0, fontSize: 12, padding: "7px 10px", outline: "none", fontFamily: MONO, width: "100%", boxSizing: "border-box" }}
            />
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => { setShowNew(false); setWtName(""); setNewBranch(""); }}
                style={{ padding: "7px 14px", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.t2, fontSize: 11, fontFamily: SANS, cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !wtName.trim()}
                style={{ flex: 1, padding: "7px 0", borderRadius: 8, border: "none", background: wtName.trim() && !creating ? C.t0 : C.bg4, color: wtName.trim() && !creating ? C.bg0 : C.t3, fontSize: 11, fontFamily: SANS, fontWeight: 600, cursor: "pointer" }}
              >
                {creating ? "Creating…" : "Create Worktree"}
              </button>
            </div>
          </div>
        )}
      </div>

      <style>{"@keyframes wtspin { to { transform: rotate(360deg); } }"}</style>
    </div>
  );
}