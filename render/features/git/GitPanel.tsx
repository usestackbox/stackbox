import { useState } from "react";
import { C, MONO, SANS } from "../../design";
import { NoGitPane }    from "./NoGitPane";
import { ChangesTab }   from "./ChangesTab";
import { BranchesTab }  from "./BranchesTab";
import { HistoryTab }   from "./HistoryTab";
import { WorktreesTab } from "./WorktreesTab";
import GithubTab        from "./GithubTab";
import { useGitPanel }  from "./useGitPanel";
import type { GitPanelProps, GitTab } from "./types";

export function GitPanel({ workspaceCwd, workspaceId, branch, onClose, onFileClick }: GitPanelProps) {
  const git = useGitPanel(workspaceCwd, workspaceId);

  const [tab,        setTab]        = useState<GitTab>("changes");
  const [message,    setMessage]    = useState("");
  const [committing, setCommitting] = useState(false);
  const [pushing,    setPushing]    = useState(false);

  const handleCommit = async () => {
    if (!message.trim()) return;
    setCommitting(true);
    try { await git.commit(message.trim()); setMessage(""); }
    catch (e: any) { git.showNotice(String(e), false); }
    finally { setCommitting(false); }
  };

  const handlePush = async () => {
    setPushing(true);
    try { await git.push(); }
    catch (e: any) { git.showNotice(String(e), false); }
    finally { setPushing(false); }
  };

  const handleCommitPush = async () => {
    if (!message.trim()) return;
    setCommitting(true);
    try {
      await git.commit(message.trim()); setMessage("");
      setPushing(true);
      await git.push();
    } catch (e: any) { git.showNotice(String(e), false); }
    finally { setCommitting(false); setPushing(false); }
  };

  // ── Loading state ──────────────────────────────────────────────────────────
  if (git.isGitRepo === null) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg1 }}>
        <div style={{ height: 48, padding: "0 14px", flexShrink: 0, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.t0, flex: 1, fontFamily: SANS }}>Source Control</span>
          <button onClick={onClose} style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", color: C.t2, fontSize: 14, borderRadius: 8, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 16, height: 16, border: `2px solid ${C.border}`, borderTopColor: C.t1, borderRadius: "50%", animation: "gitspin .7s linear infinite" }} />
        </div>
        <style>{`@keyframes gitspin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!git.isGitRepo) {
    return <NoGitPane cwd={workspaceCwd} onClose={onClose} onInitDone={() => git.setIsGitRepo(null)} />;
  }

  const busy = committing || pushing;

  // PR status dot for GitHub tab
  const prStatus = git.worktreeRecord?.status;
  const prDot    = prStatus === "approved"          ? C.green
                 : prStatus === "changes_requested" ? C.red
                 : prStatus === "pr_open"           ? C.amber
                 : prStatus === "merged"            ? C.blue
                 : null;

  const TABS: [GitTab, string, React.ReactNode?][] = [
    ["changes",   git.files.length > 0 ? `Changes (${git.files.length})` : "Changes"],
    ["branches",  "Branches"],
    ["history",   "History"],
    ["worktrees", `Trees (${git.worktrees.length})`],
    ["github",    "GitHub", prDot
      ? <span style={{ width: 6, height: 6, borderRadius: "50%", background: prDot, display: "inline-block", flexShrink: 0 }} />
      : undefined],
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg1 }}>
      {/* Header */}
      <div style={{ height: 48, padding: "0 14px", flexShrink: 0, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.t0, flex: 1, fontFamily: SANS }}>Source Control</span>
        {git.conflicts.length > 0 && (
          <span style={{ fontSize: 10, fontFamily: MONO, color: C.amber, background: C.amberBg, border: `1px solid ${C.amber}40`, borderRadius: 6, padding: "2px 7px" }}>⚡ {git.conflicts.length}</span>
        )}
        <button onClick={handlePush} disabled={busy}
          style={{ padding: "5px 11px", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: busy ? C.t3 : C.t2, fontSize: 11, fontFamily: SANS, cursor: busy ? "default" : "pointer", transition: "all .1s" }}>
          ↑ Push
        </button>
        <button onClick={onClose} style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", color: C.t2, fontSize: 14, borderRadius: 8, cursor: "pointer" }}>✕</button>
      </div>

      {/* Branch row */}
      <div style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 10px" }}>
          <span style={{ fontSize: 12, fontFamily: MONO, color: C.t1, fontWeight: 500, flex: 1 }}>{branch || "main"}</span>
          <span style={{ fontSize: 10, fontFamily: MONO, color: C.t3 }}>
            {git.files.length > 0 ? `${git.files.length} change${git.files.length !== 1 ? "s" : ""}` : "clean"}
          </span>
        </div>
      </div>

      {/* Notice */}
      {git.notice && (
        <div style={{ margin: "0 8px 4px", padding: "7px 12px", borderRadius: 8, background: C.bg2, border: `1px solid ${git.notice.ok ? C.border : C.red + "33"}`, fontSize: 11, color: git.notice.ok ? C.t1 : C.red, fontFamily: SANS }}>
          {git.notice.text}
        </div>
      )}

      {/* Tab bar */}
      <div style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ display: "flex", background: C.bg0, borderRadius: 8, padding: 3 }}>
          {TABS.map(([t, label, badge]) => (
            <button key={t} onClick={() => setTab(t)}
              style={{
                flex: 1, padding: "5px 0", borderRadius: 6, border: "none",
                background: tab === t ? C.bg4 : "transparent",
                color: tab === t ? C.t0 : C.t2,
                fontSize: 11, fontFamily: SANS, fontWeight: tab === t ? 600 : 400,
                cursor: "pointer", transition: "all .1s",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
              }}>
              {label}
              {badge}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {tab === "changes" && (
        <ChangesTab
          files={git.files}
          agentSpans={git.agentSpans}
          committing={committing}
          pushing={pushing}
          message={message}
          onMessage={setMessage}
          onCommit={handleCommit}
          onCommitPush={handleCommitPush}
          onFileClick={fc => onFileClick?.(fc)}
          onStage={git.stageFile}
          onUnstage={git.unstageFile}
          onDiscard={git.discardFile}
        />
      )}
      {tab === "branches" && (
        <BranchesTab
          allBranches={git.allBranches}
          currentBranch={branch}
          onSwitch={b => git.switchBranch(b).catch(e => git.showNotice(String(e), false))}
          onCreate={b => git.createBranch(b).catch(e => { git.showNotice(String(e), false); throw e; })}
        />
      )}
      {tab === "history" && (
        <HistoryTab
          commits={git.commits}
          onDiff={git.commitDiff}
        />
      )}
      {tab === "worktrees" && (
        <WorktreesTab
          worktrees={git.worktrees}
          onCreateWorktree={git.createWorktree}
          onDiff={git.diffWorktrees}
        />
      )}
      {tab === "github" && (
        <GithubTab
          record={git.worktreeRecord}
          branch={branch}
          workspaceCwd={workspaceCwd}
          busy={busy || git.creatingPr}
          onCreatePr={git.createPr}
          onRefreshRecord={git.loadWorktreeRecord}
        />
      )}

      <style>{`@keyframes gitspin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}