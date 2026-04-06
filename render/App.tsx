// App.tsx
// Root shell. Layout only — all state lives in useRunboxes + useBranchPoller.

import { useState, useCallback, useRef, useEffect } from "react";
import { C, SANS, MONO } from "./design";
import { useRunboxes }     from "./features/runbox";
import { useBranchPoller } from "./hooks";
import { StripIcon }       from "./ui";
// icons — memory panel hidden, IcoBrain not needed

import { WorkspaceView }  from "./features/workspace";
import type { WinState, FileTab, SidePanel as WsSidePanel } from "./features/workspace/types";
import type { TermPaneCallbacks } from "./features/workspace/WorkspaceView";
import { Sidebar }        from "./sidebar";
import { CreateRunboxModal } from "./sidebar/CreateWorkspaceModal";

import { TerminalPane }   from "./features/terminal/TerminalPane";
import { BrowsePane }     from "./features/browser/BrowsePane";
import { FileEditorPane } from "./features/editor/FileEditorPane";
import { GitPanel }       from "./features/git/GitPanel";
import { MemoryPanel }    from "./features/memory/MemoryPanel";
// REMOVED: FileChangeList (duplicate of GitPanel ChangesTab)
// REMOVED: LiveDiffFile import from changes — now sourced from git/types
import type { LiveDiffFile } from "./features/git/types";

const SIDEBAR_TOTAL = 260; // match WORKSPACE_W in Sidebar.tsx

// "files" kept in the type union so the signature matches WorkspaceView's onSidePanelToggle.
// The panel itself is no longer rendered (file changes live inside Git → Changes tab),
// but the type must stay compatible with WorkspaceView's prop type.
type SidePanel = "git" | "memory" | "files" | null;

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const { runboxes, activeId, safeId, setActiveId, create, rename, remove } = useRunboxes();

  const [cwdMap,      setCwdMap]      = useState<Record<string, string>>({});
  const [worktreeMap, setWorktreeMap] = useState<Record<string, string>>({});
  const [branchMap,   setBranchMap]   = useState<Record<string, string>>({});
  const [showModal, setShowModal] = useState(false);

  // Sidebar / panel state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [fileTreeOpen,     setFileTreeOpen]     = useState(false);
  const [sidePanel,        setSidePanel]        = useState<SidePanel>(null);
  const [sidebarTotal,     setSidebarTotal]     = useState(SIDEBAR_TOTAL);
  const [activeSessionId,  setActiveSessionId]  = useState<string | null>(null);

  // Imperative refs for diff/file openers per runbox
  const diffOpenerRefs = useRef<Record<string, { open: (fc: any) => void }>>({});
  const fileOpenerRefs = useRef<Record<string, { open: (path: string) => void }>>({});

  // Branch polling
  useBranchPoller({
    runboxes,
    activeId,
    cwdMap,
    onBranch: (id, branch) => setBranchMap(p => ({ ...p, [id]: branch })),
  });

  // Sidebar width sync
  useEffect(() => {
    if (sidebarCollapsed) { setSidebarTotal(0); return; }
    if (!fileTreeOpen)    { setSidebarTotal(SIDEBAR_TOTAL); }
  }, [sidebarCollapsed, fileTreeOpen]);

  // Sidebar toggle logic
  const handleSidebarToggle = useCallback(() => {
    if (sidebarCollapsed) { setSidebarCollapsed(false); setFileTreeOpen(false); return; }
    if (fileTreeOpen)     { setFileTreeOpen(false); return; }
    setSidebarCollapsed(true);
  }, [sidebarCollapsed, fileTreeOpen]);

  const handleFileTreeToggle = useCallback(() => {
    if (sidebarCollapsed) { setSidebarCollapsed(false); setFileTreeOpen(true); return; }
    if (!fileTreeOpen)    { setFileTreeOpen(true); return; }
    setSidebarCollapsed(true);
    setFileTreeOpen(false);
  }, [sidebarCollapsed, fileTreeOpen]);

  const toggleSide = useCallback((panel: NonNullable<SidePanel>) => {
    setSidePanel(prev => prev === panel ? null : panel);
  }, []);

  const contentMarginLeft = sidebarCollapsed ? 0 : sidebarTotal;

  // ── Render props for WorkspaceView ─────────────────────────────────────────
  // NOTE: renderTermPane is now defined inline per-runbox inside the map below.
  // Each WorkspaceView needs its own scoped renderer so runboxId is always correct.

  const renderBrowsePane = useCallback((
    win: WinState,
    pendingUrl: string | null,
    onConsumed: () => void,
  ) => {
    return (
      <BrowsePane
        key={win.id}
        paneId={win.id}
        runboxId={safeId ?? undefined}
        isActive={false}
        onActivate={() => {}}
        onClose={() => {}}
        externalUrl={pendingUrl}
        onExternalUrlConsumed={onConsumed}
      />
    );
  }, [safeId]);

  const renderFileEditor = useCallback((tab: FileTab, onClose: () => void) => {
    return (
      <FileEditorPane
        key={tab.id}
        path={tab.filePath}
        onClose={onClose}
      />
    );
  }, []);

  // FIX: was missing `worktreeMap` in deps — caused stale closure where GitPanel
  //      received the wrong cwd when worktree path changed after mount.
  const renderSidePanel = useCallback((
    panel: WsSidePanel,
    runbox: typeof runboxes[number],
    branch: string,
    onClose: () => void,
  ) => {
    if (panel === "git") {
      return (
        <GitPanel
          workspaceCwd={worktreeMap[runbox.id] || cwdMap[runbox.id] || runbox.cwd}
          workspaceId={runbox.id}
          branch={branch}
          onClose={onClose}
          onFileClick={(fc: LiveDiffFile) => diffOpenerRefs.current[runbox.id]?.open(fc)}
        />
      );
    }
    if (panel === "memory") {
      return (
        <MemoryPanel
          workspaceId={runbox.id}
          workspaceName={runbox.name}
          onClose={onClose}
        />
      );
    }
    return null;
  }, [cwdMap, worktreeMap]); // ← worktreeMap added to deps (was missing)

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      height: "100%", width: "100%",
      background: C.bg0, overflow: "hidden", position: "relative",
    }}>
      {/* Floating Sidebar */}
      <Sidebar
        runboxes={runboxes}
        activeId={safeId}
        cwdMap={cwdMap}
        collapsed={sidebarCollapsed}
        onToggle={handleSidebarToggle}
        onSelect={setActiveId}
        onCreate={create}
        onRename={rename}
        onDelete={remove}
        fileTreeOpen={fileTreeOpen}
        onFileTreeToggle={handleFileTreeToggle}
        onOpenFile={path => fileOpenerRefs.current[safeId ?? ""]?.open(path)}
        onFileTreeWidth={w => { if (!sidebarCollapsed) setSidebarTotal(w); }}
        worktreeMap={worktreeMap}
      />

      {/* One WorkspaceView per runbox — only active is visible */}
      {runboxes.map(rb => {
        // Each WorkspaceView gets its OWN renderTermPane scoped to its runbox.
        // The shared renderTermPane used safeId (the globally active workspace),
        // so ALL inactive WorkspaceViews were spawning PTYs with the wrong runboxId —
        // two PTYs on the same ID = double prompt output.
        const renderTermPaneForRb = (win: WinState, callbacks: TermPaneCallbacks) => (
          <TerminalPane
            key={win.id}
            runboxId={rb.id}
            runboxName={rb.name}
            runboxCwd={win.cwd || rb.cwd}
            agentCmd={rb.agentCmd}
            onWorktreeReady={path => {
              setWorktreeMap(p => ({ ...p, [rb.id]: path }));
              callbacks.onCwdChange(path);
            }}
            label={win.label}
            isActive={callbacks.isActive}
            onActivate={callbacks.onActivate}
            onCwdChange={callbacks.onCwdChange}
            onSessionChange={callbacks.onSessionChange}
            onClose={callbacks.onClose}
            onMinimize={callbacks.onMinimize}
            onMaximize={callbacks.onMaximize}
            onSplitDown={callbacks.onSplitDown}
            onSplitLeft={callbacks.onSplitLeft}
          />
        );
        return (
        <div
          key={rb.id}
          style={{
            display:       safeId === rb.id ? "flex" : "none",
            flex:          1,
            flexDirection: "column",
            minHeight:     0,
          }}
        >
          <WorkspaceView
            runbox={rb}
            branch={branchMap[rb.id] ?? ""}
            sidePanel={sidePanel}
            sidebarCollapsed={sidebarCollapsed}
            fileTreeOpen={fileTreeOpen}
            contentMarginLeft={contentMarginLeft}
            onSidePanelToggle={toggleSide}
            onSidebarToggle={handleSidebarToggle}
            onFileTreeToggle={handleFileTreeToggle}
            toolbarSlot={
              <div style={{ display: "flex", alignItems: "center", gap: 1 }}>
                {/* Memory panel hidden — not needed with per-agent git worktrees */}
                <button
                  onClick={() => toggleSide("git")}
                  title="Changes"
                  style={{
                    background: sidePanel === "git" ? "rgba(255,255,255,.18)" : "transparent",
                    border: sidePanel === "git" ? "1px solid rgba(255,255,255,.12)" : "1px solid rgba(255,255,255,.1)",
                    borderRadius: 6,
                    color: sidePanel === "git" ? "#ffffff" : "rgba(255,255,255,.45)",
                    cursor: "pointer",
                    padding: "0 10px",
                    height: 28,
                    fontSize: 11,
                    fontWeight: 500,
                    letterSpacing: "0.04em",
                    whiteSpace: "nowrap",
                    transition: "all .12s",
                    display: "flex",
                    alignItems: "center",
                  }}
                  onMouseEnter={e => {
                    const el = e.currentTarget as HTMLElement;
                    if (sidePanel !== "git") { el.style.color = "#fff"; el.style.background = "rgba(255,255,255,.09)"; }
                  }}
                  onMouseLeave={e => {
                    const el = e.currentTarget as HTMLElement;
                    if (sidePanel !== "git") { el.style.color = "rgba(255,255,255,.45)"; el.style.background = "transparent"; }
                  }}
                >Changes</button>
              </div>
            }
            onCwdChange={cwd => setCwdMap(p => ({ ...p, [rb.id]: cwd }))}
            onSessionChange={setActiveSessionId}
            onOpenDiff={ref => { diffOpenerRefs.current[rb.id] = ref; }}
            onOpenFile={ref => { fileOpenerRefs.current[rb.id] = ref; }}
            renderTermPane={renderTermPaneForRb}
            renderBrowsePane={renderBrowsePane}
            renderFileEditor={renderFileEditor}
            renderSidePanel={renderSidePanel}
          />
        </div>
        );
      })}

      {/* Empty state */}
      {(runboxes.length === 0 || !safeId) && (
        <AppEmptyState
          hasRunboxes={runboxes.length > 0}
          contentMarginLeft={contentMarginLeft}
          onNew={() => setShowModal(true)}
        />
      )}

      {showModal && (
        <CreateRunboxModal
          onSubmit={(n, c) => { create(n, c); setShowModal(false); }}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────
function AppEmptyState({ hasRunboxes, contentMarginLeft, onNew }: {
  hasRunboxes: boolean; contentMarginLeft: number; onNew: () => void;
}) {
  return (
    <div style={{
      position: "absolute",
      top: 42, left: contentMarginLeft, right: 0, bottom: 0,
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      gap: 28, background: C.bg0,
      transition: "left .18s cubic-bezier(.4,0,.2,1)",
      zIndex: 1,
    }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none"
          stroke="rgba(255,255,255,.08)" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2.5"/>
          <polyline points="8 21 12 17 16 21"/>
          <line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
        <span className="stackbox-brand" style={{ fontSize: 22, color: "rgba(255,255,255,.07)" }}>
          Stackbox
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,.16)", fontFamily: SANS }}>
          {hasRunboxes ? "No runbox selected" : "No runboxes yet"}
        </p>
        <button
          onClick={onNew}
          style={{
            padding: "6px 18px", background: "transparent",
            border: "1px solid rgba(255,255,255,.08)", borderRadius: 8,
            color: "rgba(255,255,255,.22)", fontSize: 11, fontFamily: SANS, cursor: "pointer",
            transition: "all .15s",
          }}
          onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = "rgba(255,255,255,.04)"; el.style.borderColor = "rgba(255,255,255,.16)"; el.style.color = "rgba(255,255,255,.50)"; }}
          onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.borderColor = "rgba(255,255,255,.08)"; el.style.color = "rgba(255,255,255,.22)"; }}
        >
          + New Runbox
        </button>
      </div>
    </div>
  );
}