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

  // Dynamic sidebar width — updated by Sidebar via onFileTreeWidth callback
  const [sidebarTotal, setSidebarTotal] = useState(SIDEBAR_TOTAL);

  const diffOpenerRefs = useRef<Record<string, { open: (fc: any) => void }>>({});
  const fileOpenerRefs = useRef<Record<string, { open: (path: string) => void }>>({});

  const handleSidebarToggle = useCallback(() => {
    if (sidebarCollapsed) {
      setSidebarCollapsed(false);
      setFileTreeOpen(false);
      return;
    }
    if (fileTreeOpen) {
      setFileTreeOpen(false);
      return;
    }
    setSidebarCollapsed(true);
  }, [sidebarCollapsed, fileTreeOpen]);

  const handleFileTreeToggle = useCallback(() => {
    if (sidebarCollapsed) { setSidebarCollapsed(false); setFileTreeOpen(true); return; }
    if (!fileTreeOpen)    { setFileTreeOpen(true); return; }
    setSidebarCollapsed(true);
    setFileTreeOpen(false);
  }, [sidebarCollapsed, fileTreeOpen]);

  const toggleSide = useCallback((panel: "files" | "git" | "memory") => {
    setSidePanel(prev => prev === panel ? null : panel);
  }, []);

  // When sidebar collapses/reopens, reset to the standard total
  useEffect(() => {
    if (sidebarCollapsed) setSidebarTotal(0);
    else if (!fileTreeOpen) setSidebarTotal(SIDEBAR_TOTAL);
    // When fileTreeOpen, Sidebar will call onFileTreeWidth to set the correct value
  }, [sidebarCollapsed, fileTreeOpen]);

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

  const contentMarginLeft = sidebarCollapsed ? 0 : sidebarTotal;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", background: C.bg0, overflow: "hidden", position: "relative" }}>

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
        onFileTreeWidth={w => {
          if (!sidebarCollapsed) setSidebarTotal(w);
        }}
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

      {/* ── Empty state — no runboxes, or none selected ── */}
      {(runboxes.length === 0 || !safeId) && (
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
            <svg width="52" height="52" viewBox="0 0 24 24" fill="none"
              stroke="rgba(255,255,255,.1)" strokeWidth="1.1"
              strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2.5"/>
              <polyline points="8 21 12 17 16 21"/>
              <line x1="12" y1="17" x2="12" y2="21"/>
            </svg>
            <span className="stackbox-brand" style={{
              fontSize: 24, letterSpacing: "0.07em",
              color: "rgba(255,255,255,.09)",
            }}>
              Stackbox
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,.18)", fontFamily: SANS, letterSpacing: ".02em" }}>
              {runboxes.length === 0 ? "No runboxes yet" : "No runbox selected"}
            </p>
            <button
              onClick={() => setShowModal(true)}
              style={{ padding: "6px 18px", background: "transparent", border: "1px solid rgba(255,255,255,.09)", borderRadius: 8, color: "rgba(255,255,255,.25)", fontSize: 11, fontFamily: SANS, cursor: "pointer", transition: "all .15s" }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = "rgba(255,255,255,.05)"; el.style.borderColor = "rgba(255,255,255,.18)"; el.style.color = "rgba(255,255,255,.55)"; }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.borderColor = "rgba(255,255,255,.09)"; el.style.color = "rgba(255,255,255,.25)"; }}>
              + New Runbox
            </button>
          </div>
        </div>
      )}

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