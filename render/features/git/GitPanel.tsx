// render/features/git/GitPanel.tsx

import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { C, MONO, SANS } from "../../design";
import { ChangesTab } from "./ChangesTab";
import type { BranchDiffFile, GitPanelProps } from "./types";
import { useGitPanel } from "./useGitPanel";

// ── Branch switcher dropdown ──────────────────────────────────────────────────


function BranchSwitcher({
  currentBranch,
  allBranches,
  onSwitch,
  onPreview,
}: {
  currentBranch: string;
  allBranches: string[];
  onSwitch: (branch: string) => void;
  onPreview: (branch: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false); setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
    else onPreview(null);
  }, [open]);

  const otherBranches = allBranches.filter((b) => b !== currentBranch);
  const q = query.trim().toLowerCase();
  const filteredOthers = q ? otherBranches.filter((b) => b.toLowerCase().includes(q)) : otherBranches;
  const showCurrent = !q || currentBranch.toLowerCase().includes(q);

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      {/* Trigger */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          padding: "3px 8px 3px 9px",
          background: open ? C.bg3 : C.bg2,
          border: `1px solid ${open ? C.borderMd : C.border}`,
          borderRadius: 6, cursor: "pointer",
          fontSize: 12, fontFamily: MONO, color: C.t1,
          maxWidth: 200, transition: "all .1s",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
          {currentBranch || "No Branch"}
        </span>
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke={C.t3}
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 5px)", right: 0,
          width: 280, zIndex: 200,
          background: C.bg1, border: `1px solid ${C.borderMd}`,
          borderRadius: 10, overflow: "hidden",
          boxShadow: "0 8px 28px rgba(0,0,0,.55)",
        }}>
          {/* Search */}
          <div style={{ padding: "8px 10px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 6 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
              stroke={C.t3} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search branches…"
              style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontSize: 12, fontFamily: SANS, color: C.t0 }}
              onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); setQuery(""); } }}
            />
          </div>

          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {/* Current */}
            {showCurrent && (
              <BranchRow
                label={currentBranch}
                active
                onClick={() => { setOpen(false); setQuery(""); }}
                onHover={() => {}}
              />
            )}

            {/* Divider */}
            {showCurrent && filteredOthers.length > 0 && (
              <div style={{ height: 1, background: C.border, margin: "2px 0" }} />
            )}

            {/* Other branches */}
            {filteredOthers.map((b) => (
              <BranchRow
                key={b}
                label={b}
                onClick={() => { onSwitch(b); setOpen(false); setQuery(""); }}
                onHover={(hov) => onPreview(hov ? b : null)}
              />
            ))}

            {/* Empty */}
            {!showCurrent && filteredOthers.length === 0 && (
              <div style={{ padding: "12px 14px", fontSize: 12, color: C.t3, fontFamily: SANS }}>No matches</div>
            )}
          </div>

          {/* Hint */}
          <div style={{ padding: "6px 12px", borderTop: `1px solid ${C.border}`, fontSize: 10, color: C.t3, fontFamily: SANS }}>
            Hover branch to preview diff · click to switch
          </div>
        </div>
      )}
    </div>
  );
}

function BranchRow({ label, active, onClick, onHover }: {
  label: string; active?: boolean; onClick: () => void; onHover: (hov: boolean) => void;
}) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        width: "100%", textAlign: "left",
        padding: "8px 12px",
        background: active ? C.bg3 : "transparent",
        border: "none", cursor: "pointer",
        transition: "background .08s",
      }}
      onFocus={e => { if (!active) (e.currentTarget as HTMLElement).style.background = C.bg2; }}
      onBlur={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
      {...(!active && {
        onMouseEnter: (e) => {
          (e.currentTarget as HTMLElement).style.background = C.bg2;
          onHover(true);
        },
        onMouseLeave: (e) => {
          (e.currentTarget as HTMLElement).style.background = "transparent";
          onHover(false);
        },
      })}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
        stroke={active ? C.t2 : C.t3} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <line x1="6" y1="3" x2="6" y2="15" />
        <circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
        <path d="M18 9a9 9 0 0 1-9 9" />
      </svg>
      <span style={{ flex: 1, fontSize: 12, fontFamily: MONO, color: active ? C.t0 : C.t1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      {active && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.t2}
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </button>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function GitPanel({ workspaceCwd, workspaceId, branch, onClose, onFileClick }: GitPanelProps) {
  const git = useGitPanel(workspaceCwd, workspaceId);

  const [message, setMessage]           = useState("");
  const [committing, setCommitting]     = useState(false);
  const [initing, setIniting]           = useState(false);
  const [currentBranch, setCurrentBranch] = useState(branch);

  // Branch diff preview state
  const [previewBranch, setPreviewBranch]   = useState<string | null>(null);
  const [previewFiles, setPreviewFiles]     = useState<BranchDiffFile[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewRef = useRef<string | null>(null);

  useEffect(() => { setCurrentBranch(branch); }, [branch]);

  const fileCount = git.files.length;
  const totalIns  = git.files.reduce((s, f) => s + (f.insertions ?? 0), 0);
  const totalDel  = git.files.reduce((s, f) => s + (f.deletions  ?? 0), 0);

  // Load branch diff when hovering a branch
  const handlePreview = useCallback(async (b: string | null) => {
    setPreviewBranch(b);
    previewRef.current = b;
    if (!b) { setPreviewFiles([]); return; }
    setPreviewLoading(true);
    try {
      const result = await git.branchDiff(b, currentBranch);
      if (previewRef.current === b) setPreviewFiles(result);
    } catch {
      if (previewRef.current === b) setPreviewFiles([]);
    } finally {
      if (previewRef.current === b) setPreviewLoading(false);
    }
  }, [git, currentBranch]);

  const handleCommit = async () => {
    if (!message.trim()) return;
    setCommitting(true);
    try { await git.commit(message.trim()); setMessage(""); }
    catch (e: any) { git.showNotice(String(e), false); }
    finally { setCommitting(false); }
  };

  const handleAutoInit = async () => {
    setIniting(true);
    try {
      await invoke("git_run", { cwd: workspaceCwd, args: ["init"] });
      git.showNotice("Git initialized", true);
      git.setIsGitRepo(true);
      git.loadAll();
    } catch (e: any) {
      git.showNotice("git init failed: " + String(e), false);
    } finally { setIniting(false); }
  };

  const handleSwitch = async (b: string) => {
    setCurrentBranch(b);
    try { await git.switchBranch(b); }
    catch (e: any) {
      setCurrentBranch(currentBranch);
      git.showNotice(String(e), false);
    }
  };

  // ── Loading ──────────────────────────────────────────────────────────────
  if (git.isGitRepo === null) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg1 }}>
        <PanelHeader branch={branch} fileCount={0} totalIns={0} totalDel={0} conflicts={0} onClose={onClose} loading />
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Spinner />
        </div>
        <style>{"@keyframes gitspin{to{transform:rotate(360deg)}}"}</style>
      </div>
    );
  }

  // ── No git repo ──────────────────────────────────────────────────────────
  if (!git.isGitRepo) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg1 }}>
        <PanelHeader branch="—" fileCount={0} totalIns={0} totalDel={0} conflicts={0} onClose={onClose} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: "0 20px" }}>
          <div style={{ width: 44, height: 44, borderRadius: "50%", background: C.bg3, border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.t2} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" />
              <path d="M6 21V9a9 9 0 0 0 9 9" />
            </svg>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 14, fontFamily: SANS, fontWeight: 600, color: C.t0, marginBottom: 6 }}>No git repository</div>
            <div style={{ fontSize: 12, fontFamily: SANS, color: C.t3, lineHeight: 1.6 }}>
              Initialize git for{" "}
              <span style={{ fontFamily: MONO, color: C.t2, fontSize: 11 }}>{workspaceCwd.split(/[/\\]/).pop()}</span>
            </div>
          </div>
          <button onClick={handleAutoInit} disabled={initing}
            style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: initing ? C.bg4 : C.t0, color: initing ? C.t3 : C.bg0, fontSize: 13, fontFamily: SANS, fontWeight: 600, cursor: initing ? "default" : "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            {initing ? <Spinner size={12} /> : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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

  // ── Main ─────────────────────────────────────────────────────────────────
  const displayFiles = previewBranch ? previewFiles : git.files;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg1 }}>
      <PanelHeader
        branch={currentBranch}
        fileCount={previewBranch ? previewFiles.length : fileCount}
        totalIns={previewBranch ? previewFiles.reduce((s,f) => s+(f.insertions??0),0) : totalIns}
        totalDel={previewBranch ? previewFiles.reduce((s,f) => s+(f.deletions??0),0) : totalDel}
        conflicts={git.conflicts.length}
        onClose={onClose}
        switcher={
          <BranchSwitcher
            currentBranch={currentBranch}
            allBranches={git.allBranches}
            onSwitch={handleSwitch}
            onPreview={handlePreview}
          />
        }
      />

      {/* Branch preview banner */}
      {previewBranch && (
        <div style={{
          padding: "6px 12px", flexShrink: 0,
          background: "rgba(90,140,255,.08)",
          borderBottom: `1px solid rgba(90,140,255,.18)`,
          display: "flex", alignItems: "center", gap: 8,
        }}>
          {previewLoading ? (
            <Spinner size={12} />
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(120,160,255,.7)"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
          )}
          <span style={{ fontSize: 12, fontFamily: MONO, color: "rgba(140,175,255,.85)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {previewLoading ? `Loading diff for ${previewBranch}…` : `Previewing ${previewBranch} vs ${currentBranch}`}
          </span>
        </div>
      )}

      {git.notice && <NoticeBar notice={git.notice} />}

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <ChangesTab
          files={displayFiles as any}
          agentSpans={git.agentSpans}
          commitCount={0}
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
        />
      </div>
      <style>{"@keyframes gitspin{to{transform:rotate(360deg)}}"}</style>
    </div>
  );
}

// ── Panel header ──────────────────────────────────────────────────────────────

function PanelHeader({ branch, fileCount, totalIns, totalDel, conflicts, onClose, loading, switcher }: {
  branch: string; fileCount: number; totalIns: number; totalDel: number;
  conflicts: number; onClose: () => void; loading?: boolean; switcher?: ReactNode;
}) {
  return (
    <div style={{ height: 46, flexShrink: 0, padding: "0 6px 0 10px", borderBottom: `1px solid ${C.border}`, background: C.bg1, display: "flex", alignItems: "center", gap: 6 }}>

    {!loading && fileCount > 0 && (
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        
        <span style={{ fontSize: 12, fontFamily: MONO, color: C.t2 }}>
          Review Changes
        </span>

        {/* File Count Box */}
        <span style={{
          fontSize: 12,
          fontFamily: MONO,
          color: C.t2,
          fontWeight: 600,
          padding: "2px 8px",
          borderRadius: 6,
          background: C.bg3,         
          border: `1px solid ${C.border}`,
          lineHeight: 1.2,
        }}>
          {fileCount}
        </span>

        <span style={{ fontSize: 14, fontFamily: MONO, color: C.green, fontWeight: 700 }}>
          +{totalIns}
        </span>

        <span style={{ fontSize: 14, fontFamily: MONO, color: C.red, fontWeight: 700 }}>
          -{totalDel}
        </span>

      </div>
    )}
      {conflicts > 0 && (
        <span style={{ fontSize: 12, fontFamily: MONO, color: C.amber, background: C.amberBg, borderRadius: 4, padding: "2px 6px" }}>
          ⚡{conflicts}
        </span>
      )}

      <div style={{ flex: 1 }} />

      {switcher}

      <button onClick={onClose} title="Close"
        style={{ width: 28, height: 28, borderRadius: 5, border: "none", background: "transparent", color: C.t2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all .1s", flexShrink: 0 }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.bg3; (e.currentTarget as HTMLElement).style.color = C.t0; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = C.t3; }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

function NoticeBar({ notice }: { notice: { text: string; ok: boolean } }) {
  return (
    <div style={{ margin: "6px 10px 0", padding: "6px 10px", borderRadius: 6, background: notice.ok ? C.bg3 : C.redBg, border: `1px solid ${notice.ok ? C.border : C.redBorder}`, fontSize: 12, color: notice.ok ? C.t1 : C.red, fontFamily: SANS, flexShrink: 0 }}>
      {notice.text}
    </div>
  );
}

function Spinner({ size = 16 }: { size?: number }) {
  return (
    <div style={{ width: size, height: size, border: `${size <= 12 ? 1.5 : 2}px solid ${C.border}`, borderTopColor: C.t2, borderRadius: "50%", animation: "gitspin .7s linear infinite", flexShrink: 0 }} />
  );
}
