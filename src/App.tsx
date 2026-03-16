import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { Sidebar }         from "./sidebar/Sidebar";
import { WorkspaceView }      from "./runbox/WorkspaceView";
import { BrowserPanel }    from "./panels/BrowserPanel";
import { BusPanel }        from "./panels/BusPanel";
import { AgentPanel }   from "./panels/AgentPanel";
import { CreateRunboxModal }  from "./sidebar/CreateRunboxModal";
import MemoryPanel         from "./panels/MemoryPanel";

import { C, SANS, tbtn, loadRunboxes, saveRunboxes } from "./shared/constants";
import { IcoAgents, IcoBus, IcoBrain } from "./shared/icons";
import { useDragResize } from "./shared/hooks";
import type { Runbox } from "./shared/types";

function ToolBtn({ on, onClick, title, badge, children }: {
  on: boolean; onClick: () => void; title: string; badge?: number; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} title={title}
      style={{ width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", background: on ? C.bg4 : "none", border: `1px solid ${on ? C.borderMd : "transparent"}`, borderRadius: 7, cursor: "pointer", transition: "all .12s", position: "relative" }}
      onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = C.bg3; el.style.borderColor = C.border; }}
      onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = on ? C.bg4 : "none"; el.style.borderColor = on ? C.borderMd : "transparent"; }}>
      {children}
      {badge !== undefined && badge > 0 && (
        <span style={{ position: "absolute", top: -3, right: -3, minWidth: 14, height: 14, borderRadius: 7, background: C.teal, color: C.bg0, fontSize: 9, fontWeight: 800, fontFamily: SANS, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px", border: `1.5px solid ${C.bg1}` }}>
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}

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
  const [browserOpen,      setBrowserOpen]      = useState(false);
  const [memoryOpen,       setMemoryOpen]       = useState(false);
  const [busOpen,          setBusOpen]          = useState(false);
  const busOpenRef         = useRef(false);
  const [busUnread,        setBusUnread]        = useState(0);
  const [agentsOpen,       setAgentsOpen]       = useState(false);
  const [activeSessionId,  setActiveSessionId]  = useState<string | null>(null);
  const [pendingUrl,       setPendingUrl]       = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [branchMap,        setBranchMap]        = useState<Record<string, string>>({});
  const [panelWidth,       onPanelDragDown]     = useDragResize(320, "left", 260, 680);
  const diffOpenerRefs     = useRef<Record<string, { open: (fc: any) => void }>>({});

  // Persist runboxes
  useEffect(() => { saveRunboxes(runboxes); }, [runboxes]);

  // Poll git branch for active runbox
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
    const tid = setInterval(refresh, 5000);
    return () => clearInterval(tid);
  }, [activeId, cwdMap]);

  // Browser auto-opens when agent prints a URL
  useEffect(() => {
    const unsub = listen<string>("browser-open-url", ({ payload: url }) => {
      setBrowserOpen(true);
      setPendingUrl(url);
    });
    return () => { unsub.then(f => f()); };
  }, []);

  // Forward bus-spawn-request events to Rust
  useEffect(() => {
    const unsub = listen<{ child_session_id: string; runbox_id: string; from: string; task: string; agent_cmd?: string; cwd: string }>(
      "bus-spawn-request",
      ({ payload }) => {
        invoke("bus_spawn", { runboxId: payload.runbox_id, from: payload.from, task: payload.task, agentCmd: payload.agent_cmd, cwd: payload.cwd })
          .catch(e => console.error("[bus-spawn]", e));
      },
    );
    return () => { unsub.then(f => f()); };
  }, []);

  const closeSidePanels = () => {
    setMemoryOpen(false); setBusOpen(false); busOpenRef.current = false; setAgentsOpen(false);
  };

  const onCreate = useCallback(async (name: string, cwd: string) => {
    const id: string = crypto.randomUUID();
    invoke("git_ensure", { cwd, runboxId: id }).catch(() => {});
    setRunboxes(p => [...p, { id, name, cwd }]);
    setActiveId(id);
  }, []);

  const onRename = useCallback((id: string, name: string) =>
    setRunboxes(p => p.map(r => r.id === id ? { ...r, name } : r)), []);

  const onDelete = useCallback((id: string) => {
    invoke("memory_delete_for_runbox",       { runboxId: id }).catch(() => {});
    invoke("bus_messages_delete_for_runbox", { runboxId: id }).catch(() => {});
    setRunboxes(p => {
      const next = p.filter(r => r.id !== id);
      setActiveId(a => a === id ? (next[0]?.id ?? null) : a);
      return next;
    });
    if (id === activeId) setMemoryOpen(false);
  }, [activeId]);

  const safeId   = runboxes.find(r => r.id === activeId)?.id ?? runboxes[0]?.id ?? null;
  const activeRb = runboxes.find(r => r.id === safeId);

  // Shared drag handle for right panels
  const RightPanelDragHandle = () => (
    <div onMouseDown={onPanelDragDown}
      style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, cursor: "col-resize", zIndex: 30, transition: "background .15s" }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = C.tealBorder}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"} />
  );

  return (
    <div style={{ display: "flex", height: "100%", width: "100%", background: C.bg0, overflow: "hidden" }}>

      {/* Sidebar */}
      <Sidebar
        runboxes={runboxes} activeId={safeId} cwdMap={cwdMap}
        collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(v => !v)}
        onSelect={id => setActiveId(id)} onCreate={onCreate}
        onRename={onRename} onDelete={onDelete}
      />

      {/* Main content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, position: "relative" }}>
        {runboxes.map(rb => (
          <div key={rb.id} style={{ display: safeId === rb.id ? "flex" : "none", flex: 1, flexDirection: "column", minHeight: 0 }}>
            <WorkspaceView
              runbox={rb}
              branch={branchMap[rb.id] ?? ""}
              toolbarSlot={<>
                <ToolBtn on={agentsOpen} title="Sub-agents"
                  onClick={() => { const o = !agentsOpen; closeSidePanels(); setAgentsOpen(o); }}>
                  <IcoAgents on={agentsOpen} />
                </ToolBtn>
                <ToolBtn on={busOpen} title="Agent Bus" badge={busUnread}
                  onClick={() => { const o = !busOpen; closeSidePanels(); setBusOpen(o); busOpenRef.current = o; if (o) setBusUnread(0); }}>
                  <IcoBus on={busOpen} />
                </ToolBtn>
                <ToolBtn on={memoryOpen} title="Memory"
                  onClick={() => { const o = !memoryOpen; closeSidePanels(); setMemoryOpen(o); }}>
                  <IcoBrain on={memoryOpen} />
                </ToolBtn>
              </>}
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

      {/* Browser panel — auto-opens from PTY URL detection */}
      <BrowserPanel
        open={browserOpen} pendingUrl={pendingUrl}
        onPendingUrlConsumed={() => setPendingUrl(null)}
        onClosePanel={() => setBrowserOpen(false)}
      />

      {/* Memory panel */}
      {memoryOpen && activeRb && (
        <div style={{ width: panelWidth, flexShrink: 0, display: "flex", flexDirection: "column", background: C.bg1, borderLeft: `1px solid ${C.border}`, position: "relative" }}>
          <RightPanelDragHandle />
          <MemoryPanel runboxId={activeRb.id} runboxName={activeRb.name}
            runboxes={runboxes.map(r => ({ id: r.id, name: r.name }))}
            onClose={() => setMemoryOpen(false)} />
        </div>
      )}

      {/* Sub-agents panel */}
      {agentsOpen && activeRb && (
        <div style={{ width: panelWidth, flexShrink: 0, display: "flex", flexDirection: "column", background: C.bg1, borderLeft: `1px solid ${C.border}`, position: "relative" }}>
          <RightPanelDragHandle />
          <AgentPanel runboxId={activeRb.id} parentSessionId={activeSessionId} onClose={() => setAgentsOpen(false)} />
        </div>
      )}

      {/* Bus panel */}
      {busOpen && activeRb && (
        <div style={{ width: panelWidth, flexShrink: 0, display: "flex", flexDirection: "column", background: C.bg1, borderLeft: `1px solid ${C.border}`, position: "relative" }}>
          <RightPanelDragHandle />
          <BusPanel runboxId={activeRb.id} onClose={() => setBusOpen(false)}
            onNewMessage={() => { if (!busOpenRef.current) setBusUnread(n => n + 1); }} />
        </div>
      )}

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