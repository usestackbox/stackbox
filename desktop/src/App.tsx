// src/App.tsx
import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

import { WorkspaceView, StripIcon } from "./runbox/WorkspaceView";
import { Sidebar }            from "./sidebar/Sidebar";
import { CreateRunboxModal }  from "./sidebar/CreateRunboxModal";
import { IcoBrain, IcoFiles, IcoGit } from "./shared/icons";

import { C, SANS, loadRunboxes, saveRunboxes } from "./shared/constants";
import type { Runbox } from "./shared/types";

// ── Layout constants ──────────────────────────────────────────────────────────

const SIDEBAR_W     = 220;
const SIDEBAR_LEFT  = 8;
const SIDEBAR_GAP   = 8;
const SIDEBAR_TOTAL = SIDEBAR_W + SIDEBAR_LEFT + SIDEBAR_GAP; // 236px

type SidePanel = "files" | "git" | "memory" | null;

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  // ── Runbox state ──────────────────────────────────────────────────────────
  const [runboxes,  setRunboxes]  = useState<Runbox[]>(() => loadRunboxes());
  const [activeId,  setActiveId]  = useState<string | null>(() => loadRunboxes()[0]?.id ?? null);
  const [cwdMap,    setCwdMap]    = useState<Record<string, string>>({});
  const [branchMap, setBranchMap] = useState<Record<string, string>>({});
  const [showModal, setShowModal] = useState(false);

  // ── Sidebar / panel state ─────────────────────────────────────────────────
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [fileTreeOpen,     setFileTreeOpen]     = useState(false);
  const [sidePanel,        setSidePanel]        = useState<SidePanel>(null);
  const [sidebarTotal,     setSidebarTotal]     = useState(SIDEBAR_TOTAL);
  const [activeSessionId,  setActiveSessionId]  = useState<string | null>(null);

  // ── Imperative refs (diff / file opener per runbox) ───────────────────────
  const diffOpenerRefs = useRef<Record<string, { open: (fc: any)    => void }>>({});
  const fileOpenerRefs = useRef<Record<string, { open: (path: string) => void }>>({});

  // ── Persist runboxes ──────────────────────────────────────────────────────
  useEffect(() => { saveRunboxes(runboxes); }, [runboxes]);

  // ── Branch polling ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeId) return;
    const rb = runboxes.find(r => r.id === activeId);
    if (!rb) return;

    const cwd     = cwdMap[activeId] || rb.cwd;
    const refresh = () =>
      invoke<string>("git_current_branch", { cwd })
        .then(b => { if (b) setBranchMap(p => ({ ...p, [activeId]: b })); })
        .catch(() => {});

    refresh();
    const tid = setInterval(refresh, 5_000);
    return () => clearInterval(tid);
  }, [activeId, cwdMap]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sidebar toggle logic ──────────────────────────────────────────────────
  const handleSidebarToggle = useCallback(() => {
    if (sidebarCollapsed) {
      setSidebarCollapsed(false);
      setFileTreeOpen(false);
      return;
    }
    if (fileTreeOpen) { setFileTreeOpen(false); return; }
    setSidebarCollapsed(true);
  }, [sidebarCollapsed, fileTreeOpen]);

  const handleFileTreeToggle = useCallback(() => {
    if (sidebarCollapsed) { setSidebarCollapsed(false); setFileTreeOpen(true); return; }
    if (!fileTreeOpen)    { setFileTreeOpen(true); return; }
    setSidebarCollapsed(true);
    setFileTreeOpen(false);
  }, [sidebarCollapsed, fileTreeOpen]);

  // ── Side panel toggle ─────────────────────────────────────────────────────
  const toggleSide = useCallback((panel: NonNullable<SidePanel>) => {
    setSidePanel(prev => prev === panel ? null : panel);
  }, []);

  // ── Sidebar width sync ────────────────────────────────────────────────────
  useEffect(() => {
    if (sidebarCollapsed) { setSidebarTotal(0); return; }
    if (!fileTreeOpen)    { setSidebarTotal(SIDEBAR_TOTAL); }
    // When fileTreeOpen=true, Sidebar calls onFileTreeWidth to set the value.
  }, [sidebarCollapsed, fileTreeOpen]);

  // ── CRUD ──────────────────────────────────────────────────────────────────
  const onCreate = useCallback(async (name: string, cwd: string) => {
    const id = crypto.randomUUID();
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

  // ── Derived ───────────────────────────────────────────────────────────────
  const safeId          = runboxes.find(r => r.id === activeId)?.id ?? runboxes[0]?.id ?? null;
  const runboxesSummary = runboxes.map(r => ({ id: r.id, name: r.name }));
  const contentMarginLeft = sidebarCollapsed ? 0 : sidebarTotal;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      display: "flex", flexDirection: "column",
      height: "100%", width: "100%",
      background: C.bg0, overflow: "hidden", position: "relative",
    }}>
      {/* ── Floating Sidebar ── */}
      <Sidebar
        runboxes={runboxes}
        activeId={safeId}
        cwdMap={cwdMap}
        collapsed={sidebarCollapsed}
        onToggle={handleSidebarToggle}
        onSelect={id => setActiveId(id)}
        onCreate={onCreate}
        onRename={onRename}
        onDelete={onDelete}
        fileTreeOpen={fileTreeOpen}
        onFileTreeToggle={handleFileTreeToggle}
        onOpenFile={path => fileOpenerRefs.current[safeId ?? ""]?.open(path)}
        onFileTreeWidth={w => { if (!sidebarCollapsed) setSidebarTotal(w); }}
      />

      {/* ── Workspace rows (one per runbox, only active is visible) ── */}
      {runboxes.map(rb => (
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

      {/* ── Empty state ── */}
      {(runboxes.length === 0 || !safeId) && (
        <EmptyState
          hasRunboxes={runboxes.length > 0}
          contentMarginLeft={contentMarginLeft}
          onNew={() => setShowModal(true)}
        />
      )}

      {showModal && (
        <CreateRunboxModal
          onSubmit={(n, c) => { onCreate(n, c); setShowModal(false); }}
          onClose={() => setShowModal(false)}
        />
      )}

      <style>{`
        @keyframes sbFadeUp {
          from { opacity:0; transform:translateY(8px) scale(.98); }
          to   { opacity:1; transform:translateY(0) scale(1); }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────

function EmptyState({ hasRunboxes, contentMarginLeft, onNew }: {
  hasRunboxes:       boolean;
  contentMarginLeft: number;
  onNew:             () => void;
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
      {/* Logo mark */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none"
          stroke="rgba(255,255,255,.08)" strokeWidth="1.1"
          strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2.5"/>
          <polyline points="8 21 12 17 16 21"/>
          <line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
        <span className="stackbox-brand" style={{
          fontSize: 22, letterSpacing: "0.07em",
          color: "rgba(255,255,255,.07)",
        }}>
          Stackbox
        </span>
      </div>

      {/* CTA */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <p style={{
          margin: 0, fontSize: 12,
          color: "rgba(255,255,255,.16)",
          fontFamily: SANS, letterSpacing: ".02em",
        }}>
          {hasRunboxes ? "No runbox selected" : "No runboxes yet"}
        </p>
        <button
          onClick={onNew}
          style={{
            padding: "6px 18px",
            background: "transparent",
            border: "1px solid rgba(255,255,255,.08)",
            borderRadius: 8,
            color: "rgba(255,255,255,.22)",
            fontSize: 11, fontFamily: SANS, cursor: "pointer",
            transition: "all .15s",
          }}
          onMouseEnter={e => {
            const el = e.currentTarget as HTMLElement;
            el.style.background   = "rgba(255,255,255,.04)";
            el.style.borderColor  = "rgba(255,255,255,.16)";
            el.style.color        = "rgba(255,255,255,.50)";
          }}
          onMouseLeave={e => {
            const el = e.currentTarget as HTMLElement;
            el.style.background   = "transparent";
            el.style.borderColor  = "rgba(255,255,255,.08)";
            el.style.color        = "rgba(255,255,255,.22)";
          }}
        >
          + New Runbox
        </button>
      </div>
    </div>
  );
}