// render/features/git/GitPanel.tsx
// FIXED:
//  1. handleAutoInit now calls git.redetect() + git.loadAll() instead of
//     setIsGitRepo(null) which left the panel spinning forever.
//  2. "No git repo" screen is now the last resort — if git is already
//     initialised the detect effect (keyed on detectTick) finds it.
//  3. Added ref-selector dropdown matching the screenshot exactly:
//     "Uncommitted changes" | main | all branches (with search).
//  4. GitTab type now includes "history" (fixed in types.ts).

import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { C, MONO, SANS } from "../../design";
import { ChangesTab } from "./ChangesTab";
import { BranchesTab } from "./BranchesTab";
import { HistoryTab } from "./HistoryTab";
import { WorktreesTab } from "./WorktreesTab";
import type { BranchDiffFile, GitPanelProps, GitTab, LiveDiffFile } from "./types";
import { useGitPanel } from "./useGitPanel";

// ── Ref-selector dropdown ─────────────────────────────────────────────────────
// Matches the "Uncommitted changes ▼" dropdown in the screenshot.

const REF_UNCOMMITTED = "__uncommitted__";

function RefSelector({
  value,
  branches,
  onChange,
}: {
  value: string;
  branches: string[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Focus search on open
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  const options = [
    { id: REF_UNCOMMITTED, label: "Uncommitted changes" },
    ...branches.map((b) => ({ id: b, label: b })),
  ];

  const filtered = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  const current = options.find((o) => o.id === value) ?? options[0];
  const label = current?.label ?? "Uncommitted changes";

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          padding: "4px 8px 4px 9px",
          background: open ? C.bg3 : C.bg2,
          border: `1px solid ${open ? C.borderMd : C.border}`,
          borderRadius: 6, cursor: "pointer",
          fontSize: 11, fontFamily: SANS, color: C.t1,
          maxWidth: 180, transition: "all .1s",
        }}
      >
        <span style={{
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          flex: 1, maxWidth: 150,
        }}>
          {label}
        </span>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, color: C.t3, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", right: 0,
          width: 260, zIndex: 100,
          background: C.bg1, border: `1px solid ${C.borderMd}`,
          borderRadius: 8, overflow: "hidden",
          boxShadow: "0 8px 24px rgba(0,0,0,.45)",
        }}>
          {/* Search box */}
          <div style={{
            padding: "7px 8px", borderBottom: `1px solid ${C.border}`,
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
              stroke={C.t3} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              style={{
                flex: 1, background: "transparent", border: "none", outline: "none",
                fontSize: 11, fontFamily: SANS, color: C.t0,
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setOpen(false); setQuery(""); }
              }}
            />
          </div>

          {/* Options list */}
          <div style={{ maxHeight: 220, overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <div style={{ padding: "10px 12px", fontSize: 11, color: C.t3, fontFamily: SANS }}>
                No matches
              </div>
            ) : (
              filtered.map((opt) => {
                const active = opt.id === value || (value === REF_UNCOMMITTED && opt.id === REF_UNCOMMITTED);
                return (
                  <button
                    key={opt.id}
                    onClick={() => { onChange(opt.id); setOpen(false); setQuery(""); }}
                    style={{
                      display: "block", width: "100%", textAlign: "left",
                      padding: "7px 12px",
                      background: active ? C.bg3 : "transparent",
                      border: "none", cursor: "pointer",
                      fontSize: 11, fontFamily: opt.id === REF_UNCOMMITTED ? SANS : MONO,
                      color: active ? C.t0 : C.t2,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      transition: "background .08s",
                    }}
                    onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = C.bg2; }}
                    onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                  >
                    {opt.label}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function GitPanel({
  workspaceCwd,
  workspaceId,
  branch,
  onClose,
  onFileClick,
}: GitPanelProps) {
  const git = useGitPanel(workspaceCwd, workspaceId);

  const [activeTab, setActiveTab]           = useState<GitTab>("changes");
  const [message, setMessage]               = useState("");
  const [committing, setCommitting]         = useState(false);
  const [discardingAll, setDiscardingAll]   = useState(false);
  const [initing, setIniting]               = useState(false);
  const [showNewBranch, setShowNewBranch]   = useState(false);
  const [newBranchName, setNewBranchName]   = useState("");
  const [creatingBranch, setCreatingBranch] = useState(false);

  // ── Ref selector state ─────────────────────────────────────────────────────
  // REF_UNCOMMITTED → show working-tree diff (default)
  // any other string → branch name; load its files via branchDiff
  const [selectedRef, setSelectedRef] = useState<string>(REF_UNCOMMITTED);
  const [branchFiles, setBranchFiles] = useState<BranchDiffFile[]>([]);
  const [loadingBranch, setLoadingBranch] = useState(false);

  // Load branch diff when the selector changes
  useEffect(() => {
    if (selectedRef === REF_UNCOMMITTED) {
      setBranchFiles([]);
      return;
    }
    setLoadingBranch(true);
    git.branchDiff(selectedRef)
      .then((files) => setBranchFiles(files))
      .catch(() => setBranchFiles([]))
      .finally(() => setLoadingBranch(false));
  }, [selectedRef, git.branchDiff]);

  // Files shown in the Changes tab depend on which ref is selected
  const displayFiles: LiveDiffFile[] = selectedRef === REF_UNCOMMITTED
    ? git.files
    : branchFiles.map((f) => ({
        path: f.path,
        change_type: (f.change_type as LiveDiffFile["change_type"]) ?? "modified",
        diff: f.diff,
        insertions: f.insertions,
        deletions: f.deletions,
        modified_at: 0,
      }));

  const totalIns  = displayFiles.reduce((s, f) => s + (f.insertions ?? 0), 0);
  const totalDel  = displayFiles.reduce((s, f) => s + (f.deletions  ?? 0), 0);
  const fileCount = displayFiles.length;

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleCommit = async () => {
    if (!message.trim()) return;
    setCommitting(true);
    try {
      await git.commit(message.trim());
      setMessage("");
    } catch (e: any) {
      git.showNotice(String(e), false);
    } finally {
      setCommitting(false);
    }
  };

  const handleDiscardAll = async () => {
    if (!window.confirm("Discard all uncommitted changes? This cannot be undone.")) return;
    setDiscardingAll(true);
    try {
      for (const f of git.files) await git.discardFile(f.path).catch(() => {});
      git.loadFiles();
      git.showNotice("All changes discarded", true);
    } finally {
      setDiscardingAll(false);
    }
  };

  // FIX: After git init succeeds, directly mark as repo and load data.
  // Previously setIsGitRepo(null) was called, which showed a spinner forever
  // because the detect useEffect only re-runs when cwd/workspaceId change.
  const handleAutoInit = async () => {
    setIniting(true);
    try {
      await invoke("git_run", { cwd: workspaceCwd, args: ["init"] });
      git.showNotice("Git initialized", true);
      // FIX: was git.setIsGitRepo(null) — that left the panel spinning.
      git.setIsGitRepo(true);
      git.loadAll();
    } catch (e: any) {
      git.showNotice("git init failed: " + String(e), false);
    } finally {
      setIniting(false);
    }
  };

  const handleCreateBranch = async () => {
    const name = newBranchName.trim();
    if (!name) return;
    setCreatingBranch(true);
    try {
      await git.createBranch(name);
      setShowNewBranch(false);
      setNewBranchName("");
    } catch (e: any) {
      git.showNotice(String(e), false);
    } finally {
      setCreatingBranch(false);
    }
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (git.isGitRepo === null) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg1 }}>
        <PanelHeader
          branch={branch} fileCount={0} totalIns={0} totalDel={0} conflicts={0}
          selectedRef={REF_UNCOMMITTED} allBranches={[]} onRefChange={() => {}}
          onDiscardAll={() => {}} discardingAll={false}
          onClose={onClose} onNewBranch={() => {}} loading
        />
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Spinner />
        </div>
        <style>{"@keyframes gitspin{to{transform:rotate(360deg)}}"}</style>
      </div>
    );
  }

  // ── No git repo ────────────────────────────────────────────────────────────
  // FIX: this screen now auto-transitions — the detect useEffect is keyed on
  // detectTick so calling git.redetect() (or handleAutoInit above) will
  // re-run detection without needing to change cwd or workspaceId.
  if (!git.isGitRepo) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg1 }}>
        <PanelHeader
          branch="—" fileCount={0} totalIns={0} totalDel={0} conflicts={0}
          selectedRef={REF_UNCOMMITTED} allBranches={[]} onRefChange={() => {}}
          onDiscardAll={() => {}} discardingAll={false}
          onClose={onClose} onNewBranch={() => {}}
        />

        <div style={{
          flex: 1, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          gap: 14, padding: "0 20px",
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: "50%",
            background: C.bg3, border: `1px solid ${C.border}`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke={C.t2} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" />
              <path d="M6 21V9a9 9 0 0 0 9 9" />
            </svg>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 13, fontFamily: SANS, fontWeight: 600, color: C.t0, marginBottom: 6 }}>
              No git repository
            </div>
            <div style={{ fontSize: 11, fontFamily: SANS, color: C.t3, lineHeight: 1.6 }}>
              Initialize git for{" "}
              <span style={{ fontFamily: MONO, color: C.t2, fontSize: 10 }}>
                {workspaceCwd.split(/[/\\]/).pop()}
              </span>
            </div>
          </div>
          <button
            onClick={handleAutoInit}
            disabled={initing}
            style={{
              padding: "9px 20px", borderRadius: 8, border: "none",
              background: initing ? C.bg4 : C.t0,
              color: initing ? C.t3 : C.bg0,
              fontSize: 12, fontFamily: SANS, fontWeight: 600,
              cursor: initing ? "default" : "pointer",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            {initing ? <Spinner size={12} /> : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            )}
            {initing ? "Initializing…" : "Initialize Repository"}
          </button>
        </div>

        {git.notice && <NoticeBar notice={git.notice} />}
        <style>{"@keyframes gitspin{to{transform:rotate(360deg)}}"}</style>
      </div>
    );
  }

  // ── Main panel ─────────────────────────────────────────────────────────────
  const tabs: { id: GitTab; label: string; badge?: number }[] = [
    { id: "changes",   label: "Changes",   badge: fileCount || undefined },
    { id: "branches",  label: "Branches",  badge: git.agentBranches.filter(b => b.status === "working").length || undefined },
    { id: "worktrees", label: "Worktrees" },
    { id: "history",   label: "History",   badge: git.commits.length || undefined },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg1 }}>

      <PanelHeader
        branch={branch}
        fileCount={fileCount}
        totalIns={totalIns}
        totalDel={totalDel}
        conflicts={git.conflicts.length}
        selectedRef={selectedRef}
        allBranches={git.allBranches}
        onRefChange={setSelectedRef}
        onDiscardAll={handleDiscardAll}
        discardingAll={discardingAll}
        onClose={onClose}
        onNewBranch={() => setShowNewBranch(v => !v)}
      />

      {/* ── Tab bar ──────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center",
        borderBottom: `1px solid ${C.border}`,
        background: C.bg1, flexShrink: 0, overflowX: "auto",
      }}>
        {tabs.map((t) => {
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{
                padding: "8px 12px",
                background: "none", border: "none",
                borderBottom: active ? `2px solid ${C.t0}` : "2px solid transparent",
                color: active ? C.t0 : C.t3,
                fontSize: 12, fontFamily: SANS,
                cursor: "pointer", flexShrink: 0,
                display: "flex", alignItems: "center", gap: 5,
                transition: "color .12s",
                marginBottom: -1,
              }}
            >
              {t.label}
              {t.badge != null && t.badge > 0 && (
                <span style={{
                  fontSize: 10, fontFamily: MONO, fontWeight: 700,
                  background: active ? C.t0 : C.bg4,
                  color: active ? C.bg0 : C.t2,
                  borderRadius: 8, padding: "1px 5px", minWidth: 16, textAlign: "center",
                }}>
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* New branch inline form */}
      {showNewBranch && activeTab === "changes" && (
        <div style={{
          padding: "8px 12px", borderBottom: `1px solid ${C.border}`,
          background: C.bg2, display: "flex", flexDirection: "column", gap: 6, flexShrink: 0,
        }}>
          <input
            value={newBranchName}
            onChange={e => setNewBranchName(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") handleCreateBranch();
              if (e.key === "Escape") { setShowNewBranch(false); setNewBranchName(""); }
            }}
            placeholder="new-branch-name"
            autoFocus
            style={{
              background: C.bg0, border: `1px solid ${C.borderMd}`,
              borderRadius: 6, color: C.t0, fontSize: 12,
              padding: "7px 10px", outline: "none",
              fontFamily: MONO, width: "100%", boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => { setShowNewBranch(false); setNewBranchName(""); }}
              style={{ flex: 1, padding: "6px 0", borderRadius: 6, background: "transparent", border: `1px solid ${C.border}`, color: C.t2, fontSize: 11, fontFamily: SANS, cursor: "pointer" }}
            >Cancel</button>
            <button
              onClick={handleCreateBranch}
              disabled={creatingBranch || !newBranchName.trim()}
              style={{ flex: 2, padding: "6px 0", borderRadius: 6, border: "none", background: newBranchName.trim() && !creatingBranch ? C.t0 : C.bg4, color: newBranchName.trim() && !creatingBranch ? C.bg0 : C.t3, fontSize: 11, fontFamily: SANS, fontWeight: 600, cursor: "pointer" }}
            >{creatingBranch ? "Creating…" : "Create & Switch"}</button>
          </div>
        </div>
      )}

      {git.notice && <NoticeBar notice={git.notice} />}

      {/* ── Tab content ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {activeTab === "changes" && (
          <>
            {loadingBranch && (
              <div style={{ padding: "12px 0", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Spinner size={14} />
              </div>
            )}
            {!loadingBranch && (
              <ChangesTab
                files={displayFiles}
                agentSpans={git.agentSpans}
                commitCount={git.commits.length}
                committing={committing}
                pushing={false}
                message={message}
                onMessage={setMessage}
                onCommit={selectedRef === REF_UNCOMMITTED ? handleCommit : undefined}
                onCommitPush={selectedRef === REF_UNCOMMITTED ? handleCommit : undefined}
                onPush={() => {}}
                onFileClick={(fc) => onFileClick?.(fc)}
                onStage={selectedRef === REF_UNCOMMITTED ? git.stageFile : undefined}
                onUnstage={selectedRef === REF_UNCOMMITTED ? git.unstageFile : undefined}
                onDiscard={selectedRef === REF_UNCOMMITTED ? git.discardFile : undefined}
              />
            )}
          </>
        )}

        {activeTab === "branches" && (
          <BranchesTab
            agentBranches={git.agentBranches}
            allBranches={git.allBranches}
            currentBranch={branch}
            onSwitch={async (b) => { await git.switchBranch(b); }}
            onCreate={git.createBranch}
            onRename={git.renameBranch}
            onMerge={git.mergeBranch}
            onDelete={git.deleteBranch}
            onBranchLog={git.branchLog}
            onBranchStatus={git.branchStatus}
            onBranchDiff={git.branchDiff}
          />
        )}

        {activeTab === "worktrees" && (
          <WorktreesTab
            worktrees={git.worktrees}
            onCreateWorktree={git.createWorktree}
            onDiffWorktrees={git.diffWorktrees}
            onRefresh={git.loadAll}
          />
        )}

        {activeTab === "history" && (
          <HistoryTab
            commits={git.commits}
            onCommitDiff={git.commitDiff}
            onRefresh={git.loadCommits}
          />
        )}
      </div>

      <style>{"@keyframes gitspin{to{transform:rotate(360deg)}}"}</style>
    </div>
  );
}

// ── Panel header ──────────────────────────────────────────────────────────────
// Layout matches the screenshot exactly:
//   [branch-pill]  [N • +ins -del]  [spacer]  [ref-dropdown]  [Discard all]  [+branch]  [×]

function PanelHeader({
  branch, fileCount, totalIns, totalDel, conflicts,
  selectedRef, allBranches, onRefChange,
  onDiscardAll, discardingAll, onClose, onNewBranch, loading,
}: {
  branch: string; fileCount: number; totalIns: number; totalDel: number;
  conflicts: number; selectedRef: string; allBranches: string[];
  onRefChange: (v: string) => void;
  onDiscardAll: () => void; discardingAll: boolean;
  onClose: () => void; onNewBranch: () => void; loading?: boolean;
}) {
  return (
    <div style={{
      height: 46, flexShrink: 0,
      padding: "0 6px 0 12px",
      borderBottom: `1px solid ${C.border}`,
      background: C.bg1,
      display: "flex", alignItems: "center", gap: 6,
    }}>
      {/* Branch pill */}
      <div style={{
        display: "flex", alignItems: "center", gap: 5,
        background: C.bg3, border: `1px solid ${C.border}`,
        borderRadius: 5, padding: "3px 8px 3px 6px", flexShrink: 0,
      }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
          stroke={C.t3} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
        <span style={{ fontSize: 12, fontFamily: MONO, color: C.t0, fontWeight: 600 }}>
          {branch || "main"}
        </span>
      </div>

      {/* File count + stats */}
      {!loading && fileCount > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontFamily: MONO, color: C.t2, fontWeight: 600 }}>{fileCount}</span>
          <span style={{ fontSize: 11, fontFamily: MONO, color: C.t3 }}>•</span>
          <span style={{ fontSize: 11, fontFamily: MONO, color: C.green, fontWeight: 700 }}>+{totalIns}</span>
          <span style={{ fontSize: 11, fontFamily: MONO, color: C.red, fontWeight: 700 }}>-{totalDel}</span>
        </div>
      )}

      {conflicts > 0 && (
        <span style={{ fontSize: 10, fontFamily: MONO, color: C.amber, background: C.amberBg, borderRadius: 4, padding: "2px 6px" }}>
          ⚡{conflicts}
        </span>
      )}

      <div style={{ flex: 1 }} />

      {/* Ref selector dropdown */}
      {!loading && (
        <RefSelector
          value={selectedRef}
          branches={allBranches}
          onChange={onRefChange}
        />
      )}

      {/* Discard all */}
      {!loading && fileCount > 0 && selectedRef === REF_UNCOMMITTED && (
        <button
          onClick={onDiscardAll}
          disabled={discardingAll}
          title="Discard all changes"
          style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "4px 8px", borderRadius: 5, border: `1px solid ${C.border}`,
            background: "transparent", color: C.t3,
            fontSize: 11, fontFamily: SANS,
            cursor: discardingAll ? "default" : "pointer",
            opacity: discardingAll ? 0.5 : 1, flexShrink: 0, transition: "all .1s",
          }}
          onMouseEnter={(e) => {
            if (!discardingAll) {
              (e.currentTarget as HTMLElement).style.background = C.redBg;
              (e.currentTarget as HTMLElement).style.color = C.red;
              (e.currentTarget as HTMLElement).style.borderColor = C.redBorder;
            }
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
            (e.currentTarget as HTMLElement).style.color = C.t3;
            (e.currentTarget as HTMLElement).style.borderColor = C.border;
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 .49-3.38" />
          </svg>
          Discard all
        </button>
      )}

      {/* New branch */}
      <IconBtn onClick={onNewBranch} title="New branch">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </IconBtn>

      {/* Close */}
      <IconBtn onClick={onClose} title="Close">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </IconBtn>
    </div>
  );
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

function IconBtn({ onClick, title, children, danger, disabled }: {
  onClick: () => void; title: string; children: React.ReactNode;
  danger?: boolean; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick} title={title} disabled={disabled}
      style={{
        width: 28, height: 28, borderRadius: 5, border: "none",
        background: "transparent", color: C.t3, cursor: disabled ? "default" : "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "all .1s", flexShrink: 0, opacity: disabled ? 0.4 : 1,
      }}
      onMouseEnter={e => {
        if (!disabled) {
          (e.currentTarget as HTMLElement).style.background = danger ? C.redBg : C.bg3;
          (e.currentTarget as HTMLElement).style.color = danger ? C.red : C.t0;
        }
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.background = "transparent";
        (e.currentTarget as HTMLElement).style.color = C.t3;
      }}
    >{children}</button>
  );
}

function NoticeBar({ notice }: { notice: { text: string; ok: boolean } }) {
  return (
    <div style={{
      margin: "6px 10px 0", padding: "6px 10px", borderRadius: 6,
      background: notice.ok ? C.bg3 : C.redBg,
      border: `1px solid ${notice.ok ? C.border : C.redBorder}`,
      fontSize: 11, color: notice.ok ? C.t1 : C.red,
      fontFamily: SANS, flexShrink: 0,
    }}>
      {notice.text}
    </div>
  );
}

function Spinner({ size = 16 }: { size?: number }) {
  return (
    <div style={{
      width: size, height: size,
      border: `${size <= 12 ? 1.5 : 2}px solid ${C.border}`,
      borderTopColor: C.t2, borderRadius: "50%",
      animation: "gitspin .7s linear infinite", flexShrink: 0,
    }} />
  );
}
