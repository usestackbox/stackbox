import { useState } from "react";
import { C, MONO, SANS } from "../../design";
import { NoGitPane }    from "./NoGitPane";
import { ChangesTab }   from "./ChangesTab";
import { BranchesTab }  from "./BranchesTab";
import { HistoryTab }   from "./HistoryTab";
import { useGitPanel }  from "./useGitPanel";
import type { GitPanelProps, GitTab } from "./types";

export function GitPanel({ workspaceCwd, workspaceId, branch, onClose, onFileClick }: GitPanelProps) {
  const git = useGitPanel(workspaceCwd, workspaceId);

  const [tab,        setTab]        = useState<GitTab>("changes");
  const [sourceTab,  setSourceTab]  = useState<"branches" | "history">("branches");
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

  if (git.isGitRepo === null) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg1 }}>
        <LoadingHeader onClose={onClose} />
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 14, height: 14, border: `1.5px solid ${C.border}`, borderTopColor: C.t2, borderRadius: "50%", animation: "gitspin .7s linear infinite" }} />
        </div>
        <style>{`@keyframes gitspin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  if (!git.isGitRepo) {
    return <NoGitPane cwd={workspaceCwd} onClose={onClose} onInitDone={() => git.setIsGitRepo(null)} />;
  }

  const busy = committing || pushing;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg1 }}>

      {/* ── Header ── */}
      <div style={{
        height: 52, padding: "0 10px 0 14px", flexShrink: 0,
        borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", gap: 6,
      }}>

        {/* Branch label */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
          <span style={{
            fontSize: 16,
            color: C.t2,
            userSelect: "none", flexShrink: 0,
            lineHeight: 1,
          }}>
            ⎇
          </span>
          <span style={{ fontSize: 14, fontFamily: MONO, color: C.t1, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {branch || "main"}
          </span>
        </div>

        {git.conflicts.length > 0 && (
          <span style={{ fontSize: 10, fontFamily: MONO, color: C.amber, background: C.amberBg, borderRadius: 4, padding: "2px 7px" }}>
            ⚡{git.conflicts.length}
          </span>
        )}

        {/* ── Tab nav: Changes · Source · GitHub ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>

          {/* Changes tab */}
          <NavTab active={tab === "changes"} onClick={() => setTab("changes")} label="Changes" />

          {/* Source tab (branches + history merged) */}
          <button
            title="Branches & History"
            onClick={() => setTab(tab === "source" ? "changes" : "source")}
            style={{
              width: 32, height: 32, borderRadius: tab === "source" ? 9999 : 7, border: "none",
              background: tab === "source" ? C.bg4 : "transparent",
              color: tab === "source" ? C.t0 : C.t3,
              cursor: "pointer", transition: "all .15s",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
            onMouseEnter={e => { if (tab !== "source") (e.currentTarget as HTMLElement).style.color = C.t1; }}
            onMouseLeave={e => { if (tab !== "source") (e.currentTarget as HTMLElement).style.color = C.t3; }}>
            <SourceIcon />
          </button>

        </div>

        <button onClick={onClose}
          style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", color: C.t3, borderRadius: 7, cursor: "pointer", flexShrink: 0 }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = C.t1; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = C.t3; }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      {/* ── Notice ── */}
      {git.notice && (
        <div style={{
          margin: "6px 10px 0", padding: "6px 10px", borderRadius: 7,
          background: git.notice.ok ? C.bg3 : C.redBg,
          border: `1px solid ${git.notice.ok ? C.border : C.redBorder}`,
          fontSize: 11, color: git.notice.ok ? C.t1 : C.red, fontFamily: SANS,
        }}>
          {git.notice.text}
        </div>
      )}

      {/* ── Content ── */}
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
          onPush={handlePush}
          onFileClick={fc => onFileClick?.(fc)}
          onStage={git.stageFile}
          onUnstage={git.unstageFile}
          onDiscard={git.discardFile}
        />
      )}

      {/* Source: branches + history with internal sub-tabs */}
      {tab === "source" && (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          {/* Sub-tab bar */}
          <div style={{
            display: "flex", borderBottom: `1px solid ${C.border}`,
            padding: "0 14px", flexShrink: 0,
          }}>
            {(["branches", "history"] as const).map(st => (
              <button key={st} onClick={() => setSourceTab(st)}
                style={{
                  height: 38, padding: "0 14px", background: "none", border: "none",
                  borderBottom: `2px solid ${sourceTab === st ? C.t1 : "transparent"}`,
                  color: sourceTab === st ? C.t0 : C.t3,
                  fontSize: 12, fontFamily: SANS, fontWeight: sourceTab === st ? 500 : 400,
                  cursor: "pointer", transition: "all .12s", textTransform: "capitalize",
                  marginBottom: -1,
                }}
                onMouseEnter={e => { if (sourceTab !== st) (e.currentTarget as HTMLElement).style.color = C.t1; }}
                onMouseLeave={e => { if (sourceTab !== st) (e.currentTarget as HTMLElement).style.color = C.t3; }}>
                {st.charAt(0).toUpperCase() + st.slice(1)}
              </button>
            ))}
          </div>
          {/* Sub-tab content */}
          <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            {sourceTab === "branches" && (
              <BranchesTab
                allBranches={git.allBranches}
                currentBranch={branch}
                onSwitch={b => git.switchBranch(b).catch(e => git.showNotice(String(e), false))}
                onCreate={b => git.createBranch(b).catch(e => { git.showNotice(String(e), false); throw e; })}
              />
            )}
            {sourceTab === "history" && (
              <HistoryTab commits={git.commits} onDiff={git.commitDiff} />
            )}
          </div>
        </div>
      )}


      <style>{`@keyframes gitspin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ── Nav helpers ────────────────────────────────────────────────────────────────

function NavTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick}
      style={{
        height: 32, padding: "0 12px", borderRadius: 7, border: "none",
        background: active ? C.bg4 : "transparent",
        color: active ? C.t0 : C.t3,
        fontSize: 12, fontFamily: SANS, fontWeight: active ? 500 : 400,
        cursor: "pointer", transition: "all .1s", flexShrink: 0,
      }}
      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = C.t1; }}
      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = C.t3; }}>
      {label}
    </button>
  );
}

function SourceIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>
    </svg>
  );
}

function LoadingHeader({ onClose }: { onClose: () => void }) {
  return (
    <div style={{ height: 52, padding: "0 10px 0 14px", flexShrink: 0, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center" }}>
      <span style={{ fontSize: 13, fontFamily: MONO, color: C.t2, flex: 1 }}>Source Control</span>
      <button onClick={onClose} style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", color: C.t3, borderRadius: 7, cursor: "pointer" }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  );
}