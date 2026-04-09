import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState, useCallback } from "react";
import { C, MONO, SANS } from "../../design";
import { ChangesTab } from "./ChangesTab";
import { NoGitPane } from "./NoGitPane";
import type { GitPanelProps, LiveDiffFile, WorktreeEntry } from "./types";
import { useGitPanel } from "./useGitPanel";

export function GitPanel({
  workspaceCwd,
  workspaceId,
  branch,
  onClose,
  onFileClick,
}: GitPanelProps) {
  const git = useGitPanel(workspaceCwd, workspaceId);

  // Which worktree is selected (null = current workspace)
  const [selectedWt, setSelectedWt] = useState<WorktreeEntry | null>(null);
  // Files for the selected worktree (only used when selectedWt != null)
  const [wtFiles, setWtFiles] = useState<LiveDiffFile[]>([]);
  const [wtLoading, setWtLoading] = useState(false);
  const [showWtDrop, setShowWtDrop] = useState(false);

  // Load files for a selected worktree
  const loadWtFiles = useCallback(async (wt: WorktreeEntry) => {
    setWtLoading(true);
    try {
      const files = await invoke<LiveDiffFile[]>("git_diff_live", {
        cwd: wt.path,
        runboxId: workspaceId,
      });
      setWtFiles(files);
    } catch {
      setWtFiles([]);
    } finally {
      setWtLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (selectedWt) {
      loadWtFiles(selectedWt);
    } else {
      setWtFiles([]);
    }
  }, [selectedWt, loadWtFiles]);

  // Which files + agent spans to show
  const displayFiles   = selectedWt ? wtFiles   : git.files;
  const displaySpans   = git.agentSpans;

  // Loading state
  if (git.isGitRepo === null) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg1 }}>
        <PanelHeader branch="" worktrees={[]} selectedWt={null} onSelectWt={() => {}} showDrop={false} onToggleDrop={() => {}} onClose={onClose} loading />
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{
            width: 14, height: 14,
            border: `1.5px solid ${C.border}`,
            borderTopColor: C.t2,
            borderRadius: "50%",
            animation: "gitspin .7s linear infinite",
          }} />
        </div>
        <style>{"@keyframes gitspin{to{transform:rotate(360deg)}}"}</style>
      </div>
    );
  }

  if (!git.isGitRepo) {
    return (
      <NoGitPane
        cwd={workspaceCwd}
        onClose={onClose}
        onInitDone={() => git.setIsGitRepo(null)}
      />
    );
  }

  const totalIns = displayFiles.reduce((s, f) => s + (f.insertions ?? 0), 0);
  const totalDel = displayFiles.reduce((s, f) => s + (f.deletions ?? 0), 0);

  // Worktrees list (exclude bare/current if only one)
  const worktrees = git.worktrees ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg1, position: "relative" }}>
      <PanelHeader
        branch={branch || "main"}
        worktrees={worktrees}
        selectedWt={selectedWt}
        showDrop={showWtDrop}
        onToggleDrop={() => setShowWtDrop(v => !v)}
        onSelectWt={wt => {
          setSelectedWt(wt);
          setShowWtDrop(false);
        }}
        fileCount={displayFiles.length}
        totalIns={totalIns}
        totalDel={totalDel}
        conflicts={git.conflicts.length}
        onClose={onClose}
      />

      {/* Worktree dropdown overlay */}
      {showWtDrop && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 90 }}
            onClick={() => setShowWtDrop(false)}
          />
          <div style={{
            position: "absolute",
            top: 76,
            left: 10,
            right: 10,
            zIndex: 100,
            background: C.bg2,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            boxShadow: "0 8px 32px rgba(0,0,0,.55)",
            overflow: "hidden",
          }}>
            {/* Current workspace option */}
            <DropItem
              label={branch || "main"}
              sub="current workspace"
              active={selectedWt === null}
              onClick={() => { setSelectedWt(null); setShowWtDrop(false); }}
            />
            {worktrees.filter(wt => !wt.is_bare && !wt.is_main).map(wt => (
              <DropItem
                key={wt.path}
                label={wt.branch.replace("refs/heads/", "")}
                sub={wt.path.split("/").slice(-2).join("/")}
                active={selectedWt?.path === wt.path}
                onClick={() => { setSelectedWt(wt); setShowWtDrop(false); }}
              />
            ))}
            {worktrees.filter(wt => !wt.is_bare && !wt.is_main).length === 0 && (
              <div style={{ padding: "10px 14px", fontSize: 11, color: C.t3, fontFamily: SANS }}>
                No worktrees found
              </div>
            )}
          </div>
        </>
      )}

      {/* Notice banner */}
      {git.notice && (
        <div style={{
          margin: "6px 10px 0",
          padding: "6px 10px",
          borderRadius: 7,
          background: git.notice.ok ? C.bg3 : "rgba(248,113,113,.08)",
          border: `1px solid ${git.notice.ok ? C.border : "rgba(248,113,113,.25)"}`,
          fontSize: 11, fontFamily: SANS,
          color: git.notice.ok ? C.t1 : "rgba(248,113,113,.9)",
        }}>
          {git.notice.text}
        </div>
      )}

      {/* Loading indicator for worktree */}
      {wtLoading && (
        <div style={{ padding: "24px 0", display: "flex", justifyContent: "center" }}>
          <div style={{
            width: 14, height: 14,
            border: `1.5px solid ${C.border}`,
            borderTopColor: C.t2,
            borderRadius: "50%",
            animation: "gitspin .7s linear infinite",
          }} />
        </div>
      )}

      {!wtLoading && (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <ChangesTab
            files={displayFiles}
            agentSpans={displaySpans}
            onFileClick={fc => onFileClick?.(fc)}
            onDiscard={selectedWt ? undefined : git.discardFile}
          />
        </div>
      )}

      <style>{"@keyframes gitspin{to{transform:rotate(360deg)}}"}</style>
    </div>
  );
}

// ── Dropdown item ────────────────────────────────────────────────────────────
function DropItem({ label, sub, active, onClick }: {
  label: string; sub: string; active: boolean; onClick: () => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        padding: "8px 14px",
        cursor: "pointer",
        background: active ? "rgba(99,179,237,.12)" : hov ? "rgba(255,255,255,.04)" : "transparent",
        borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", gap: 10,
        transition: "background .08s",
      }}
    >
      <div style={{
        width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
        background: active ? "rgba(99,179,237,.8)" : "rgba(255,255,255,.18)",
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontFamily: MONO, color: active ? "rgba(99,179,237,.9)" : C.t0, fontWeight: 500 }}>
          {label}
        </div>
        <div style={{ fontSize: 12, fontFamily: MONO, color: C.t3, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {sub}
        </div>
      </div>
      {active && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(99,179,237,.7)" strokeWidth="2.5" strokeLinecap="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </div>
  );
}

// ── Panel header ─────────────────────────────────────────────────────────────
function PanelHeader({
  branch, worktrees, selectedWt, showDrop, onToggleDrop, onSelectWt,
  fileCount = 0, totalIns = 0, totalDel = 0, conflicts = 0, onClose, loading = false,
}: {
  branch: string;
  worktrees: WorktreeEntry[];
  selectedWt: WorktreeEntry | null;
  showDrop: boolean;
  onToggleDrop: () => void;
  onSelectWt: (wt: WorktreeEntry | null) => void;
  fileCount?: number;
  totalIns?: number;
  totalDel?: number;
  conflicts?: number;
  onClose: () => void;
  loading?: boolean;
}) {
  const displayBranch = selectedWt
    ? selectedWt.branch.replace("refs/heads/", "")
    : branch;

  return (
    <div style={{ flexShrink: 0, borderBottom: `1px solid ${C.border}` }}>
      {/* Top row: title + close */}
      <div style={{ height: 42, padding: "0 8px 0 14px", display: "flex", alignItems: "center", gap: 6 }}>
        {/* Git icon */}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
          stroke={C.t2} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <circle cx="12" cy="18" r="3"/>
          <circle cx="6" cy="6" r="3"/>
          <circle cx="18" cy="6" r="3"/>
          <path d="M18 9a9 9 0 0 1-9 9M6 9v3a3 3 0 0 0 3 3h0"/>
        </svg>

        <span style={{ fontSize: 12, fontFamily: SANS, color: C.t1, fontWeight: 600, flex: 1 }}>
          Changes
        </span>

        {conflicts > 0 && (
          <span style={{
            fontSize: 10, fontFamily: MONO,
            color: "rgba(251,191,36,.9)",
            background: "rgba(251,191,36,.1)",
            border: "1px solid rgba(251,191,36,.2)",
            borderRadius: 4, padding: "1px 6px",
          }}>
            ⚡ {conflicts}
          </span>
        )}

        <button
          onClick={onClose}
          style={{
            width: 28, height: 28, borderRadius: 5, background: "none", border: "none",
            color: C.t3, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, transition: "color .1s, background .1s",
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.color = C.t1;
            (e.currentTarget as HTMLElement).style.background = C.bg3;
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.color = C.t3;
            (e.currentTarget as HTMLElement).style.background = "none";
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      {/* Branch selector row */}
      {!loading && (
        <div style={{
          height: 38, padding: "0 8px 0 12px",
          display: "flex", alignItems: "center", gap: 8,
          borderTop: `1px solid ${C.border}`,
        }}>
          {/* Branch pill / dropdown trigger */}
          <button
            onClick={onToggleDrop}
            style={{
              flex: 1, minWidth: 0,
              display: "flex", alignItems: "center", gap: 6,
              background: showDrop ? "rgba(255,255,255,.07)" : "rgba(255,255,255,.04)",
              border: `1px solid ${showDrop ? "rgba(255,255,255,.15)" : C.border}`,
              borderRadius: 6, padding: "0 8px", height: 26,
              cursor: "pointer", transition: "all .1s",
            }}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLElement;
              el.style.background = "rgba(255,255,255,.07)";
              el.style.borderColor = "rgba(255,255,255,.15)";
            }}
            onMouseLeave={e => {
              if (!showDrop) {
                const el = e.currentTarget as HTMLElement;
                el.style.background = "rgba(255,255,255,.04)";
                el.style.borderColor = C.border;
              }
            }}
          >
            {/* ── FIX: branch name font bumped from 11 → 15, weight 600 ── */}
            <span style={{ fontSize: 17, color: C.t2, flexShrink: 0 }}>⎇</span>
            <span style={{
              fontSize: 15, fontFamily: MONO, color: C.t0, fontWeight: 600,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, textAlign: "left",
            }}>
              {displayBranch}
            </span>
            {worktrees.filter(wt => !wt.is_bare && !wt.is_main).length > 0 && (
              <svg
                width="8" height="8" viewBox="0 0 24 24" fill="none"
                stroke={C.t3} strokeWidth="2.5" strokeLinecap="round"
                style={{ transform: showDrop ? "rotate(180deg)" : "none", transition: "transform .12s", flexShrink: 0 }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            )}
          </button>

          {/* Stats */}
          {(fileCount > 0 || totalIns > 0 || totalDel > 0) && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
              {fileCount > 0 && <span style={{ fontSize: 11, fontFamily: MONO, color: C.t3 }}>{fileCount}</span>}
              {totalIns > 0 && <span style={{ fontSize: 11, fontFamily: MONO, color: "rgba(63,255,162,.75)", fontWeight: 500 }}>+{totalIns}</span>}
              {totalDel > 0 && <span style={{ fontSize: 11, fontFamily: MONO, color: "rgba(255,107,107,.75)", fontWeight: 500 }}>-{totalDel}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}