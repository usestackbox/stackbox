// App.tsx
// Root shell. Layout only — all state lives in useRunboxes + useBranchPoller.

import { useState, useCallback, useRef, useEffect } from "react";
import { C, SANS } from "./design";
import { useRunboxes }     from "./features/runbox";
import { useBranchPoller } from "./hooks";
import { useKeyboard }     from "./hooks/useKeyboard";
import { useTheme } from "./hooks/useTheme";

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
import type { LiveDiffFile } from "./features/git/types";

import { SettingsModal }  from "./features/settings";
import { useUpdater, UpdateBanner, UpdateModal } from "./features/updater";
import { OnboardingFlow } from "./features/onboarding";
import { useVersion }    from "./hooks/useVersion";
import { StripIcon } from "./ui";



const SIDEBAR_TOTAL = 260;

type SidePanel = "git" | "memory" | "files" | null;

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  useTheme();
  const { runboxes, activeId, safeId, setActiveId, create, rename, changeCwd, remove } = useRunboxes();

  const [cwdMap,      setCwdMap]      = useState<Record<string, string>>({});
  const [worktreeMap, setWorktreeMap] = useState<Record<string, string>>({});
  const [branchMap,   setBranchMap]   = useState<Record<string, string>>({});
  const [showModal,   setShowModal]   = useState(false);

  // Sidebar / panel state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [fileTreeOpen,     setFileTreeOpen]     = useState(false);
  const [sidePanel,        setSidePanel]        = useState<SidePanel>(null);
  const [sidebarTotal,     setSidebarTotal]     = useState(SIDEBAR_TOTAL);
  const [activeSessionId,  setActiveSessionId]  = useState<string | null>(null);

  // Settings modal state
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab,     setSettingsTab]     = useState<string | undefined>(undefined);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const settingsBtnRef = useRef<HTMLDivElement>(null);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);


  // Updater — pull checkNow out so the event-bridge useEffect can depend on
  // the stable callback rather than the whole updater object (which changes on
  // every render because it includes the mutable `state` field).
  const updater = useUpdater();
  const { checkNow: updaterCheckNow } = updater;
  const { version: currentVersion }     = useVersion();

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

  // ── sb: event bridge ──────────────────────────────────────────────────────
  useEffect(() => {
    const openSettings = (e: Event) => {
      const tab = (e as CustomEvent).detail?.tab as string | undefined;
      setSettingsTab(tab);
      setShowSettings(true);
    };
    const checkUpdates = () => {
      updaterCheckNow();
      setSettingsTab("updates");
      setShowSettings(true);
    };
    const newWorkspace = () => setShowModal(true);

    window.addEventListener("sb:open-settings", openSettings);
    window.addEventListener("sb:check-updates", checkUpdates);
    window.addEventListener("sb:new-workspace", newWorkspace);

    return () => {
      window.removeEventListener("sb:open-settings", openSettings);
      window.removeEventListener("sb:check-updates", checkUpdates);
      window.removeEventListener("sb:new-workspace", newWorkspace);
    };
  // updaterCheckNow is stable (useCallback with [] deps) — safe dep here
  }, [updaterCheckNow]);

  // ── Global keyboard shortcuts ─────────────────────────────────────────────
  useKeyboard({
    // mod+n = New Workspace, mod+t = New Terminal
    "mod+n":       () => setShowModal(true),
    "mod+shift+n": () => setShowModal(true),
    "mod+,":       () => { setSettingsTab(undefined); setShowSettings(true); },
    "mod+f":       () => {
      if (!fileTreeOpen) handleFileTreeToggle();
      window.dispatchEvent(new CustomEvent("sb:file-search-focus"));
    },
    "mod+t": () => window.dispatchEvent(new CustomEvent("sb:new-terminal")),
    "mod+w": () => window.dispatchEvent(new CustomEvent("sb:close-terminal")),

    // ── Split: mod+d (right), mod+s (down) ────────────────────────────────
    "mod+d": () => window.dispatchEvent(new CustomEvent("sb:split-right")),
    "mod+s": () => window.dispatchEvent(new CustomEvent("sb:split-down")),

    // ── Spatial pane focus: mod+arrows ────────────────────────────────────
    "mod+arrowup":    () => window.dispatchEvent(new CustomEvent("sb:focus-pane-up")),
    "mod+arrowdown":  () => window.dispatchEvent(new CustomEvent("sb:focus-pane-down")),
    "mod+arrowleft":  () => window.dispatchEvent(new CustomEvent("sb:focus-pane-left")),
    "mod+arrowright": () => window.dispatchEvent(new CustomEvent("sb:focus-pane-right")),

    // ── Pane minimize / maximize ───────────────────────────────────────────
    "mod+m":       () => window.dispatchEvent(new CustomEvent("sb:minimize-terminal")),
    "mod+enter":   () => window.dispatchEvent(new CustomEvent("sb:maximize-terminal")),

    // ── Terminal tab cycling ───────────────────────────────────────────────
    "tab+shift+arrowright": () => window.dispatchEvent(new CustomEvent("sb:next-terminal")),
    "tab+shift+arrowleft":  () => window.dispatchEvent(new CustomEvent("sb:prev-terminal")),
  });

  // ── Render props ──────────────────────────────────────────────────────────
  const renderBrowsePane = useCallback((
    win: WinState,
    pendingUrl: string | null,
    onConsumed: () => void,
  ) => (
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
  ), [safeId]);

  const renderFileEditor = useCallback((tab: FileTab, onClose: () => void) => (
    <FileEditorPane
      key={tab.id}
      path={tab.filePath}
      onClose={onClose}
    />
  ), []);

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
  }, [cwdMap, worktreeMap]);

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      height: "100%", width: "100%",
      background: C.bg0, overflow: "hidden", position: "relative",
    }}>
      {/* ── Update banner — rendered at the very top so it pushes content down ── */}
      <UpdateBanner
        state={updater.state}
        onInstall={() => setShowUpdateModal(true)}
        onDismiss={updater.dismiss}
      />

      {/* Sidebar */}
      <Sidebar
        runboxes={runboxes}
        activeId={safeId}
        cwdMap={cwdMap}
        collapsed={sidebarCollapsed}
        onToggle={handleSidebarToggle}
        onSelect={setActiveId}
        onCreate={create}
        onRename={rename}
        onChangeCwd={changeCwd}
        onDelete={remove}
        fileTreeOpen={fileTreeOpen}
        onFileTreeToggle={handleFileTreeToggle}
        onOpenFile={path => fileOpenerRefs.current[safeId ?? ""]?.open(path)}
        onFileTreeWidth={w => { if (!sidebarCollapsed) setSidebarTotal(w); }}
        worktreeMap={worktreeMap}
      />

      {/* One WorkspaceView per runbox — only active is visible */}
      {runboxes.map(rb => {
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
            onAgentDetected={callbacks.onAgentDetected}
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
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button
                    onClick={() => toggleSide("git")}
                    title="Changes"
                    style={{
                      background:   sidePanel === "git" ? "#3A4149" : "transparent",
                      border:       sidePanel === "git" ? "1px solid rgba(255,255,255,.12)" : "1px solid rgba(255,255,255,.1)",
                      borderRadius: 6,
                      color:        sidePanel === "git" ? "#ffffff" : "rgba(255,255,255,.45)",
                      cursor:       "pointer",
                      padding:      "0 10px",
                      height:       24,
                      fontSize:     11,
                      fontWeight:   600,
                      letterSpacing:"0.05em",
                      whiteSpace:   "nowrap",
                      transition:   "all .12s",
                      display:      "flex",
                      alignItems:   "center",
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

                  <div ref={settingsBtnRef} style={{ position: "relative" }}>
                    <StripIcon
                      title="Menu"
                      active={showSettingsMenu}
                      onClick={() => setShowSettingsMenu(v => !v)}
                      size={28}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="3"/>
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                      </svg>
                    </StripIcon>
                    {showSettingsMenu && (
                      <SettingsDropdown onClose={() => setShowSettingsMenu(false)} />
                    )}
                  </div>

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
              onNewWorkspace={() => setShowModal(true)}
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

      {showSettings && (
        <SettingsModal
          onClose={() => { setShowSettings(false); setSettingsTab(undefined); }}
          updater={updater}
          initialTab={settingsTab as any}
        />
      )}

      {showUpdateModal && (
        <UpdateModal
          updater={updater}
          currentVersion={currentVersion}
          onClose={() => setShowUpdateModal(false)}
        />
      )}

      <OnboardingFlow runboxes={runboxes} onCreate={create} />
    </div>
  );
}

function SettingsDropdown({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    // slight delay so the click that opened it doesn't immediately close it
    const t = setTimeout(() => document.addEventListener("mousedown", handler), 50);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", handler); };
  }, [onClose]);

  const item = (label: string, icon: string, action: () => void) => (
    <button
      onClick={() => { action(); onClose(); }}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "7px 14px",
        background: "transparent",
        border: "none",
        color: C.t1,
        fontSize: 13,
        cursor: "pointer",
        textAlign: "left",
        transition: "background .08s",
        borderRadius: 6,
        whiteSpace: "nowrap",
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(109,235,176,.08)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
    >
      <span style={{ fontSize: 13, width: 16, textAlign: "center", opacity: 0.7 }}>{icon}</span>
      {label}
    </button>
  );

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        left: 0,
        zIndex: 9999,
        background: C.bg3,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        boxShadow: C.shadowLg,
        padding: "4px",
        minWidth: 180,
      }}
    >

      {item("Updates",    "↻", () => window.dispatchEvent(new CustomEvent("sb:open-settings", { detail: { tab: "updates"    } })))}
      {item("Shortcuts",   "⌨", () => window.dispatchEvent(new CustomEvent("sb:open-settings", { detail: { tab: "keybinds"  } })))}
      <div style={{ height: 1, background: C.border, margin: "4px 0" }} />
      {item("About",      "ℹ", () => window.dispatchEvent(new CustomEvent("sb:open-settings", { detail: { tab: "about"     } })))}
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
        <span className="calus-brand" style={{ fontSize: 22, color: "rgba(255,255,255,.07)" }}>
          Calus
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
          + New Workspace
        </button>
      </div>
    </div>
  );
}
