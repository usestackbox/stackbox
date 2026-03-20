import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { Sidebar }            from "./sidebar/Sidebar";
import { WorkspaceView }      from "./runbox/WorkspaceView";
import { CreateRunboxModal }  from "./sidebar/CreateRunboxModal";

import { C, SANS, loadRunboxes, saveRunboxes } from "./shared/constants";
import { useDragResize }                        from "./shared/hooks";
import type { Runbox }                          from "./shared/types";

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, background: C.bg0 }}>
      <div style={{ width: 42, height: 42, borderRadius: 12, border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", background: C.bg2 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.t2} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
        </svg>
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.t0, marginBottom: 6, fontFamily: SANS }}>No runboxes</div>
        <div style={{ fontSize: 12, color: C.t1, marginBottom: 22, lineHeight: 1.8, fontFamily: SANS }}>Create a runbox to open a terminal session.</div>
        <button onClick={onCreate}
          style={{ padding: "9px 24px", background: C.t0, border: "none", borderRadius: 9, color: C.bg0, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: SANS, transition: "opacity .15s" }}
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
  const [activeId,         setActiveId]         = useState<string | null>(() => loadRunboxes()[0]?.id ?? null);
  const [showModal,        setShowModal]        = useState(false);
  const [cwdMap,           setCwdMap]           = useState<Record<string, string>>({});
  const [activeSessionId,  setActiveSessionId]  = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [branchMap,        setBranchMap]        = useState<Record<string, string>>({});
  const diffOpenerRefs     = useRef<Record<string, { open: (fc: any) => void }>>({});

  useEffect(() => { saveRunboxes(runboxes); }, [runboxes]);

  useEffect(() => {
    if (!activeId) return;
    const rb  = runboxes.find(r => r.id === activeId);
    if (!rb) return;
    const cwd     = cwdMap[activeId] || rb.cwd;
    const refresh = () =>
      invoke<string>("git_current_branch", { cwd })
        .then(b => { if (b) setBranchMap(p => ({ ...p, [activeId]: b })); })
        .catch(() => {});
    refresh();
    const tid = setInterval(refresh, 5000);
    return () => clearInterval(tid);
  }, [activeId, cwdMap]);

  const onCreate = useCallback(async (name: string, cwd: string) => {
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

  const safeId   = runboxes.find(r => r.id === activeId)?.id ?? runboxes[0]?.id ?? null;
  const runboxesSummary = runboxes.map(r => ({ id: r.id, name: r.name }));

  return (
    <div style={{ display: "flex", height: "100%", width: "100%", background: C.bg0, overflow: "hidden" }}>

      <Sidebar
        runboxes={runboxes} activeId={safeId} cwdMap={cwdMap}
        collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(v => !v)}
        onSelect={id => setActiveId(id)} onCreate={onCreate}
        onRename={onRename} onDelete={onDelete}
      />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, position: "relative" }}>
        {runboxes.map(rb => (
          <div key={rb.id} style={{ display: safeId === rb.id ? "flex" : "none", flex: 1, flexDirection: "column", minHeight: 0 }}>
            <WorkspaceView
              runbox={rb}
              branch={branchMap[rb.id] ?? ""}
              activeSessionId={activeSessionId}
              runboxes={runboxesSummary}
              onCwdChange={cwd => setCwdMap(p => ({ ...p, [rb.id]: cwd }))}
              onSessionChange={sid => setActiveSessionId(sid)}
              onOpenDiff={ref => { diffOpenerRefs.current[rb.id] = ref; }}
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
      </div>

      <style>{`
        @keyframes sbFadeUp { from{opacity:0;transform:translateY(8px) scale(.98)} to{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes spin     { to{transform:rotate(360deg)} }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #2d333b; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #3d4451; }
        ::selection { background: rgba(63,182,139,.22); color: #e6edf3; }
      `}</style>
    </div>
  );
}