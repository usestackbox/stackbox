import { useState } from "react";
import { C, MONO, SANS } from "../../design";
import { BranchesTab } from "./BranchesTab";
import { ChangesTab } from "./ChangesTab";
import { HistoryTab } from "./HistoryTab";
import { NoGitPane } from "./NoGitPane";
import { WorktreesTab } from "./WorktreesTab";
import type { GitPanelProps, GitTab } from "./types";
import { useGitPanel } from "./useGitPanel";

export function GitPanel({
  workspaceCwd,
  workspaceId,
  branch,
  onClose,
  onFileClick,
}: GitPanelProps) {
  const git = useGitPanel(workspaceCwd, workspaceId);

  const [tab, setTab] = useState<GitTab>("changes");
  const [sourceTab, setSourceTab] = useState<"branches" | "history">("branches");
  const [message, setMessage] = useState("");
  const [committing, setCommitting] = useState(false);

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

  if (git.isGitRepo === null) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg1 }}>
        <LoadingHeader onClose={onClose} />
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div
            style={{
              width: 14,
              height: 14,
              border: `1.5px solid ${C.border}`,
              borderTopColor: C.t2,
              borderRadius: "50%",
              animation: "gitspin .7s linear infinite",
            }}
          />
        </div>
        <style>{"@keyframes gitspin{to{transform:rotate(360deg)}}"}</style>
      </div>
    );
  }

  if (!git.isGitRepo) {
    return (
      <NoGitPane cwd={workspaceCwd} onClose={onClose} onInitDone={() => git.setIsGitRepo(null)} />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg1 }}>
      {/* ── Header ── */}
      <div
        style={{
          height: 44,
          padding: "0 8px 0 14px",
          flexShrink: 0,
          borderBottom: `1px solid ${C.border}`,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
          <span
            style={{ fontSize: 14, color: C.t2, userSelect: "none", flexShrink: 0, lineHeight: 1 }}
          >
            ⎇
          </span>
          <span
            style={{
              fontSize: 13,
              fontFamily: MONO,
              color: C.t1,
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {branch || "main"}
          </span>
        </div>

        {git.agentBranches.filter((ab) => ab.status === "working").length > 0 && (
          <span
            style={{
              fontSize: 10,
              fontFamily: MONO,
              color: "#4ade80",
              background: "#4ade8022",
              borderRadius: 3,
              padding: "2px 6px",
              flexShrink: 0,
            }}
          >
            {git.agentBranches.filter((ab) => ab.status === "working").length} working
          </span>
        )}
        {git.conflicts.length > 0 && (
          <span
            style={{
              fontSize: 10,
              fontFamily: MONO,
              color: C.amber,
              background: C.amberBg,
              borderRadius: 3,
              padding: "2px 6px",
            }}
          >
            ⚡{git.conflicts.length}
          </span>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 0, flexShrink: 0 }}>
          <button
            title="Branches & History"
            onClick={() => setTab(tab === "source" ? "changes" : "source")}
            style={{
              width: 28,
              height: 28,
              borderRadius: 4,
              border: "none",
              background: tab === "source" ? C.bg4 : "transparent",
              color: tab === "source" ? C.t0 : C.t3,
              cursor: "pointer",
              transition: "all .15s",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseEnter={(e) => {
              if (tab !== "source") (e.currentTarget as HTMLElement).style.color = C.t1;
            }}
            onMouseLeave={(e) => {
              if (tab !== "source") (e.currentTarget as HTMLElement).style.color = C.t3;
            }}
          >
            <SourceIcon />
          </button>

          <button
            title="Worktrees"
            onClick={() => setTab(tab === "worktrees" ? "changes" : "worktrees")}
            style={{
              width: 28,
              height: 28,
              borderRadius: 4,
              border: "none",
              background: tab === "worktrees" ? C.bg4 : "transparent",
              color: tab === "worktrees" ? C.t0 : C.t3,
              cursor: "pointer",
              transition: "all .15s",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseEnter={(e) => {
              if (tab !== "worktrees") (e.currentTarget as HTMLElement).style.color = C.t1;
            }}
            onMouseLeave={(e) => {
              if (tab !== "worktrees") (e.currentTarget as HTMLElement).style.color = C.t3;
            }}
          >
            <WorktreeIcon />
          </button>

          <button
            onClick={onClose}
            style={{
              width: 28,
              height: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "none",
              border: "none",
              color: C.t3,
              borderRadius: 4,
              cursor: "pointer",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.color = C.t1;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.color = C.t3;
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Notice ── */}
      {git.notice && (
        <div
          style={{
            margin: "6px 10px 0",
            padding: "6px 10px",
            borderRadius: 7,
            background: git.notice.ok ? C.bg3 : C.redBg,
            border: `1px solid ${git.notice.ok ? C.border : C.redBorder}`,
            fontSize: 11,
            color: git.notice.ok ? C.t1 : C.red,
            fontFamily: SANS,
          }}
        >
          {git.notice.text}
        </div>
      )}

      {/* ── Content ── */}
      {tab === "changes" && (
        <ChangesTab
          files={git.files}
          agentSpans={git.agentSpans}
          committing={committing}
          pushing={false}
          message={message}
          onMessage={setMessage}
          onCommit={handleCommit}
          onCommitPush={handleCommit}
          onPush={() => {}}
          onFileClick={(fc) => onFileClick?.(fc)}
          onStage={git.stageFile}
          onUnstage={git.unstageFile}
          onDiscard={git.discardFile}
        />
      )}

      {tab === "worktrees" && (
        <WorktreesTab
          worktrees={git.worktrees}
          onCreateWorktree={git.createWorktree}
          onDiff={git.diffWorktrees}
        />
      )}

      {tab === "source" && (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          {/* Sub-tab bar */}
          <div
            style={{
              display: "flex",
              borderBottom: `1px solid ${C.border}`,
              padding: "0 14px",
              flexShrink: 0,
            }}
          >
            {(["branches", "history"] as const).map((st) => (
              <button
                key={st}
                onClick={() => setSourceTab(st)}
                style={{
                  height: 38,
                  padding: "0 14px",
                  background: "none",
                  border: "none",
                  borderBottom: `2px solid ${sourceTab === st ? C.t1 : "transparent"}`,
                  color: sourceTab === st ? C.t0 : C.t3,
                  fontSize: 12,
                  fontFamily: SANS,
                  fontWeight: sourceTab === st ? 500 : 400,
                  cursor: "pointer",
                  transition: "all .12s",
                  textTransform: "capitalize",
                  marginBottom: -1,
                }}
                onMouseEnter={(e) => {
                  if (sourceTab !== st) (e.currentTarget as HTMLElement).style.color = C.t1;
                }}
                onMouseLeave={(e) => {
                  if (sourceTab !== st) (e.currentTarget as HTMLElement).style.color = C.t3;
                }}
              >
                {st.charAt(0).toUpperCase() + st.slice(1)}
                {st === "branches" &&
                  git.agentBranches.filter((ab) => ab.status === "done").length > 0 && (
                    <span
                      style={{
                        marginLeft: 6,
                        fontSize: 9,
                        fontFamily: MONO,
                        color: "#4ade80",
                        background: "#4ade8022",
                        borderRadius: 3,
                        padding: "1px 4px",
                      }}
                    >
                      {git.agentBranches.filter((ab) => ab.status === "done").length}
                    </span>
                  )}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            {sourceTab === "branches" && (
              <BranchesTab
                agentBranches={git.agentBranches}
                allBranches={git.allBranches}
                currentBranch={branch}
                onSwitch={(b) => git.switchBranch(b).catch((e) => git.showNotice(String(e), false))}
                onCreate={(b) =>
                  git.createBranch(b).catch((e) => {
                    git.showNotice(String(e), false);
                    throw e;
                  })
                }
                onRename={(o, n) =>
                  git.renameBranch(o, n).catch((e) => git.showNotice(String(e), false))
                }
                onMerge={async (b) => {
                  try {
                    await git.mergeBranch(b);
                  } catch (e) {
                    git.showNotice(String(e), false);
                    throw e;
                  }
                }}
                onDelete={(b, f) =>
                  git.deleteBranch(b, f).catch((e) => git.showNotice(String(e), false))
                }
                onBranchLog={git.branchLog}
                onBranchStatus={(b: string) => git.branchStatus(b)}
              />
            )}
            {sourceTab === "history" && (
              <HistoryTab commits={git.commits} onDiff={git.commitDiff} />
            )}
          </div>
        </div>
      )}

      <style>{"@keyframes gitspin{to{transform:rotate(360deg)}}"}</style>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function NavTab({
  active,
  onClick,
  label,
}: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        height: 32,
        padding: "0 12px",
        borderRadius: 4,
        border: "none",
        background: active ? C.bg4 : "transparent",
        color: active ? C.t0 : C.t3,
        fontSize: 12,
        fontFamily: SANS,
        fontWeight: active ? 500 : 400,
        cursor: "pointer",
        transition: "all .1s",
        flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget as HTMLElement).style.color = C.t1;
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget as HTMLElement).style.color = C.t3;
      }}
    >
      {label}
    </button>
  );
}

function WorktreeIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3" width="8" height="6" rx="1.5" />
      <rect x="14" y="3" width="8" height="6" rx="1.5" />
      <rect x="7" y="15" width="10" height="6" rx="1.5" />
      <line x1="6" y1="9" x2="6" y2="12" />
      <line x1="18" y1="9" x2="18" y2="12" />
      <line x1="6" y1="12" x2="18" y2="12" />
      <line x1="12" y1="12" x2="12" y2="15" />
    </svg>
  );
}

function SourceIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

function LoadingHeader({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{
        height: 52,
        padding: "0 10px 0 14px",
        flexShrink: 0,
        borderBottom: `1px solid ${C.border}`,
        display: "flex",
        alignItems: "center",
      }}
    >
      <span style={{ fontSize: 13, fontFamily: MONO, color: C.t2, flex: 1 }}>Source Control</span>
      <button
        onClick={onClose}
        style={{
          width: 32,
          height: 32,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "none",
          border: "none",
          color: C.t3,
          borderRadius: 7,
          cursor: "pointer",
        }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
