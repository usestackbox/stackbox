import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { WorkspaceView, StripIcon } from "./runbox/WorkspaceView";
import { Sidebar } from "./sidebar/Sidebar";
import { CreateRunboxModal }  from "./sidebar/CreateRunboxModal";
import { IcoBrain, IcoFiles, IcoGit } from "./shared/icons";

import { C, SANS, loadRunboxes, saveRunboxes } from "./shared/constants";
import { useMemorySummaryBackfill } from "./shared/Notificationsystem";
import type { Runbox }                          from "./shared/types";

const SIDEBAR_W     = 220;
const SIDEBAR_LEFT  = 8;
const SIDEBAR_GAP   = 8;
const SIDEBAR_TOTAL = SIDEBAR_W + SIDEBAR_LEFT + SIDEBAR_GAP; // 236

type SidePanel = "files" | "git" | "memory" | null;

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      gap: 14, background: C.bg0,
    }}>
      <div style={{
        width: 42, height: 42, borderRadius: 12,
        border: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: C.bg2,
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.t2}
          strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 17 10 11 4 5"/>
          <line x1="12" y1="19" x2="20" y2="19"/>
        </svg>
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.t0, marginBottom: 6, fontFamily: SANS }}>
          No runboxes
        </div>
        <div style={{ fontSize: 12, color: C.t1, marginBottom: 22, lineHeight: 1.8, fontFamily: SANS }}>
          Create a runbox to open a terminal session.
        </div>
        <button
          onClick={onCreate}
          style={{
            padding: "9px 24px", background: C.t0, border: "none", borderRadius: 9,
            color: C.bg0, fontSize: 12, fontWeight: 700, cursor: "pointer",
            fontFamily: SANS, transition: "opacity .15s",
          }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = ".86"}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = "1"}>
          New Runbox
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [runboxes,         setRunboxes]         = useState<Runbox[]>(() => loadRunboxes());
  useMemorySummaryBackfill();
  const [activeId,         setActiveId]         = useState<string | null>(() => loadRunboxes()[0]?.id ?? null);
  const [showModal,        setShowModal]        = useState(false);
  const [cwdMap,           setCwdMap]           = useState<Record<string, string>>({});
  const [activeSessionId,  setActiveSessionId]  = useState<string | null>(null);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [branchMap,        setBranchMap]        = useState<Record<string, string>>({});
  const [fileTreeOpen,     setFileTreeOpen]     = useState<boolean>(false);
  const [sidePanel,        setSidePanel]        = useState<SidePanel>(null);
  const diffOpenerRefs = useRef<Record<string, { open: (fc: any) => void }>>({});
  const fileOpenerRefs = useRef<Record<string, { open: (path: string) => void }>>({});

  const handleSidebarToggle = useCallback(() => {
    if (sidebarCollapsed) { setSidebarCollapsed(false); setFileTreeOpen(false); return; }
    if (fileTreeOpen)     { setFileTreeOpen(false); return; }
    setSidebarCollapsed(true);
  }, [sidebarCollapsed, fileTreeOpen]);

  const handleFileTreeToggle = useCallback(() => {
    if (sidebarCollapsed) { setSidebarCollapsed(false); setFileTreeOpen(true); return; }
    if (!fileTreeOpen)    { setFileTreeOpen(true); return; }
    setSidebarCollapsed(true); setFileTreeOpen(false);
  }, [sidebarCollapsed, fileTreeOpen]);

  const toggleSide = useCallback((panel: "files" | "git" | "memory") => {
    setSidePanel(prev => prev === panel ? null : panel);
  }, []);

  useEffect(() => { saveRunboxes(runboxes); }, [runboxes]);

  useEffect(() => {
    if (!activeId) return;
    const rb = runboxes.find(r => r.id === activeId);
    if (!rb) return;
    const cwd = cwdMap[activeId] || rb.cwd;
    const refresh = () =>
      invoke<string>("git_current_branch", { cwd })
        .then(b => { if (b) setBranchMap(p => ({ ...p, [activeId]: b })); })
        .catch(() => {});
    refresh();
    const tid = setInterval(refresh, 5000);
    return () => clearInterval(tid);
  }, [activeId, cwdMap]);

  const onCreate = useCallback(async (name: string, cwd: string, docker?: boolean) => {
    const id: string = crypto.randomUUID();
    invoke("git_ensure", { cwd, runboxId: id }).catch(() => {});
    setRunboxes(p => [...p, { id, name, cwd }]);
    setActiveId(id);
  }, []);

  const onRename = useCallback((id: string, name: string) =>
    setRunboxes(p => p.map(r => r.id === id ? { ...r, name } : r)), []);

  const onDelete = useCallback((id: string) => {
    invoke("memory_delete_for_runbox", { runboxId: id }).catch(() => {});
    setRunboxes(p => {
      const next = p.filter(r => r.id !== id);
      setActiveId(a => a === id ? (next[0]?.id ?? null) : a);
      return next;
    });
  }, []);

  const safeId          = runboxes.find(r => r.id === activeId)?.id ?? runboxes[0]?.id ?? null;
  const runboxesSummary = runboxes.map(r => ({ id: r.id, name: r.name }));

  const contentMarginLeft = sidebarCollapsed ? 0 : SIDEBAR_TOTAL;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", background: C.bg0, overflow: "hidden" }}>

      {/* ── Floating Sidebar ── */}
      <Sidebar
        runboxes={runboxes}
        activeId={safeId}
        cwdMap={cwdMap}
        collapsed={sidebarCollapsed}
        onToggle={handleSidebarToggle}
        onSelect={id => { setActiveId(id); }}
        onCreate={onCreate}
        onRename={onRename}
        onDelete={onDelete}
        fileTreeOpen={fileTreeOpen}
        onFileTreeToggle={handleFileTreeToggle}
        onOpenFile={(path) => fileOpenerRefs.current[safeId ?? ""]?.open(path)}
      />

      {/* ── Workspace rows ── */}
      {runboxes.map(rb => (
        <div
          key={rb.id}
          style={{
            display:       safeId === rb.id ? "flex" : "none",
            flex:          1,
            flexDirection: "column",
            minHeight:     0,
          }}>
          <WorkspaceView
            runbox={rb}
            branch={branchMap[rb.id] ?? ""}
            activeSessionId={activeSessionId}
            runboxes={runboxesSummary}
            sidePanel={sidePanel}
            sidebarCollapsed={sidebarCollapsed}
            fileTreeOpen={fileTreeOpen}
            contentMarginLeft={contentMarginLeft}
            onSidePanelToggle={toggleSide}
            onSidebarToggle={handleSidebarToggle}
            onFileTreeToggle={handleFileTreeToggle}
            toolbarSlot={
              <div style={{ display: "flex", alignItems: "center", gap: 1 }}>
                <StripIcon title="Memory"        active={sidePanel === "memory"} onClick={() => toggleSide("memory")}><IcoBrain on /></StripIcon>
                <StripIcon title="Changed Files" active={sidePanel === "files"}  onClick={() => toggleSide("files")} ><IcoFiles on /></StripIcon>
                <StripIcon title="Git"           active={sidePanel === "git"}    onClick={() => toggleSide("git")}   ><IcoGit   on /></StripIcon>
              </div>
            }
            onCwdChange={cwd => setCwdMap(p => ({ ...p, [rb.id]: cwd }))}
            onSessionChange={sid => setActiveSessionId(sid)}
            onOpenDiff={ref => { diffOpenerRefs.current[rb.id] = ref; }}
            onOpenFile={ref => { fileOpenerRefs.current[rb.id] = ref; }}
          />
        </div>
      ))}

      {runboxes.length === 0 && <EmptyState onCreate={() => setShowModal(true)} />}

      {showModal && (
        <CreateRunboxModal
          onSubmit={(n, c) => { onCreate(n, c); setShowModal(false); }}
          onClose={() => setShowModal(false)}
        />
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@400..700&display=swap');

        @keyframes sbFadeUp { from{opacity:0;transform:translateY(8px) scale(.98)} to{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes spin     { to{transform:rotate(360deg)} }

        * { box-sizing: border-box; }

        /* ── Scrollbar ── */
        ::-webkit-scrollbar       { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${C.bg3}; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: ${C.bg4}; }
        ::selection { background: rgba(255,255,255,.12); color: rgba(255,255,255,.90); }

        /* ── Pixelify Sans brand ── */
        .stackbox-brand {
          font-family: "Pixelify Sans", sans-serif !important;
          font-optical-sizing: auto;
          font-weight: 600;
        }

        /* ── Toolbar strip icons: hover/active → white bg + black icon ── */
        .strip-icon-btn {
          transition: background .12s, color .12s !important;
        }
        .strip-icon-btn:hover,
        .strip-icon-btn[data-active="true"] {
          background: rgba(255,255,255,.92) !important;
          border-radius: 7px;
        }
        .strip-icon-btn:hover svg,
        .strip-icon-btn[data-active="true"] svg {
          stroke: #0b0e10 !important;
          color: #0b0e10 !important;
        }
        .strip-icon-btn:hover path,
        .strip-icon-btn:hover circle,
        .strip-icon-btn:hover line,
        .strip-icon-btn:hover rect,
        .strip-icon-btn[data-active="true"] path,
        .strip-icon-btn[data-active="true"] circle,
        .strip-icon-btn[data-active="true"] line,
        .strip-icon-btn[data-active="true"] rect {
          stroke: #0b0e10 !important;
          fill: none !important;
        }
      `}</style>
    </div>
  );
}