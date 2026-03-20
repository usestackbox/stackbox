// src/runbox/WorkspaceView.tsx
import { useState, useRef, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import RunPane from "../core/RunPane";
import { WorkspaceTabBar } from "./WorkspaceTabBar";
import { DiffViewer } from "./DiffViewer";
import { FileChangeList } from "../panels/FileChangeList";
import { GitWorktreePanel } from "../panels/Gitworktreepanel";
import MemoryPanel from "../panels/MemoryPanel";
import { PaneTree, newLeaf, removeLeaf, splitLeaf, collectIds } from "./PaneTree";
import { C, MONO, SANS, PORT, tbtn } from "../shared/constants";
import type { Runbox, DiffTab, PaneNode } from "../shared/types";
import { IcoBrain, IcoFiles, IcoGit,  } from "../shared/icons";

interface TermRect { left: number; top: number; width: number; height: number; }

interface WorkspaceViewProps {
  runbox:           Runbox;
  branch:           string;
  toolbarSlot?:     React.ReactNode;
  activeSessionId?: string | null;
  runboxes?:        Array<{ id: string; name: string }>;
  onCwdChange:      (cwd: string) => void;
  onSessionChange?: (sid: string) => void;
  onOpenDiff:       (ref: { open: (fc: any) => void }) => void;
}

// ── Strip icon button ─────────────────────────────────────────────────────────
function StripIcon({ children, title, active, onClick }: {
  children: React.ReactNode; title: string; active?: boolean; onClick: () => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button title={title} onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        width: 40, height: 40, flexShrink: 0, margin: "2px 4px",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: active ? C.bg3 : hov ? C.bg2 : "transparent",
        border: `1px solid ${active ? C.borderMd : "transparent"}`,
        borderRadius: 10,
        cursor: "pointer", transition: "all .12s",
      }}>
      {children}
    </button>
  );
}

// ── Resize handle ─────────────────────────────────────────────────────────────
function ResizeHandle({ onResize }: { onResize: (w: number) => void }) {
  const dragging = useRef(false);
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault(); dragging.current = true;
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const w = window.innerWidth - e.clientX - 48;
      if (w > 200 && w < 680) onResize(w);
    };
    const onUp = () => { dragging.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  };
  return (
    <div onMouseDown={onMouseDown}
      style={{ width: 4, flexShrink: 0, cursor: "col-resize", background: "transparent", transition: "background .1s" }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = C.borderMd}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"} />
  );
}

// ── Search panel ──────────────────────────────────────────────────────────────
function SearchPanel({ runboxId, onClose }: { runboxId: string; onClose: () => void }) {
  const [query,   setQuery]   = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 60); }, []);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    try {
      const r = await fetch(`http://localhost:${PORT}/events?runbox_id=${runboxId}&limit=200`);
      const rows = await r.json();
      const lo = q.toLowerCase();
      setResults((rows as any[]).filter(evt => {
        try { return JSON.stringify(JSON.parse(evt.payload_json)).toLowerCase().includes(lo) || evt.event_type.toLowerCase().includes(lo); }
        catch { return evt.payload_json.toLowerCase().includes(lo); }
      }).slice(0, 40));
    } catch { setResults([]); }
    finally { setLoading(false); }
  }, [runboxId]);

  useEffect(() => { const t = setTimeout(() => search(query), 250); return () => clearTimeout(t); }, [query, search]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg1 }}>
      <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ position: "relative" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.t2} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search commands, files, events…"
            style={{
              width: "100%", boxSizing: "border-box",
              background: C.bg2, border: `1px solid ${C.border}`,
              borderRadius: 10, color: C.t0, fontSize: 12,
              padding: "8px 10px 8px 32px", outline: "none", fontFamily: MONO,
              transition: "border-color .15s",
            }}
            onFocus={e => e.currentTarget.style.borderColor = C.borderHi}
            onBlur={e  => e.currentTarget.style.borderColor = C.border} />
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading && <div style={{ padding: "20px", textAlign: "center" }}><Spinner /></div>}
        {!loading && query && results.length === 0 && <EmptyMsg text={`No results for "${query}"`} />}
        {!loading && !query && <EmptyMsg text={"Search workspace events, commands, and files."} />}
        {!loading && results.map((evt: any) => (
          <div key={evt.id} style={{ padding: "8px 14px", borderBottom: `1px solid ${C.border}`, cursor: "default" }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = C.bg2}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}>
            <span style={{ fontSize: 9, fontWeight: 700, color: C.t3, fontFamily: MONO, textTransform: "uppercase", letterSpacing: ".07em", display: "block", marginBottom: 3 }}>{evt.event_type}</span>
            <span style={{ fontSize: 11, fontFamily: MONO, color: C.t1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{evt.payload_json.slice(0, 80)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Spinner() {
  return <div style={{ width: 16, height: 16, border: `2px solid ${C.border}`, borderTopColor: C.t1, borderRadius: "50%", animation: "sp .7s linear infinite", margin: "0 auto" }} />;
}
function EmptyMsg({ text }: { text: string }) {
  return <div style={{ padding: "28px 16px", textAlign: "center", color: C.t2, fontSize: 12, fontFamily: SANS, lineHeight: 1.7 }}>{text}</div>;
}

function PanelHeader({ title, icon, onClose }: { title: string; icon?: React.ReactNode; onClose: () => void }) {
  return (
    <div style={{
      height: 48, padding: "0 12px 0 14px", flexShrink: 0,
      borderBottom: `1px solid ${C.border}`,
      display: "flex", alignItems: "center", gap: 8, background: C.bg1,
    }}>
      {icon && <span style={{ flexShrink: 0, opacity: .6 }}>{icon}</span>}
      <span style={{ fontSize: 13, fontWeight: 600, color: C.t0, flex: 1, fontFamily: SANS }}>{title}</span>
      <button onClick={onClose}
        style={{ ...tbtn, width: 28, height: 28, borderRadius: 8, fontSize: 14 }}
        onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = C.bg3; el.style.color = C.t0; }}
        onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.color = C.t2; }}>✕</button>
    </div>
  );
}

type FilesView = "list" | "diff";
type SidePanel = "files" | "git" | "search" | "memory" | null;

export function WorkspaceView({
  runbox, branch, toolbarSlot, activeSessionId, runboxes, onCwdChange, onSessionChange, onOpenDiff,
}: WorkspaceViewProps) {
  const firstLeaf = useRef(newLeaf());
  const [paneRoot,   setPaneRoot]   = useState<PaneNode>(() => firstLeaf.current);
  const [activePane, setActivePane] = useState<string>(() => firstLeaf.current.id);
  const [paneCwds,   setPaneCwds]   = useState<Record<string, string>>({});
  const [sidePanel,  setSidePanel]  = useState<SidePanel>(null);
  const [filesView,  setFilesView]  = useState<FilesView>("list");
  const [activeDiff, setActiveDiff] = useState<DiffTab | null>(null);
  const [panelWidth, setPanelWidth] = useState(320);

  const slotMapRef  = useRef<Record<string, HTMLDivElement>>({});
  const [termRects, setTermRects]   = useState<Record<string, TermRect>>({});
  const wrapperRef  = useRef<HTMLDivElement>(null);
  const leafIds     = collectIds(paneRoot);

  useEffect(() => {
    onOpenDiff({ open: (fc: any) => {
      setActiveDiff({ id: `diff-${fc.path}`, path: fc.path, diff: fc.diff, changeType: fc.change_type, insertions: fc.insertions, deletions: fc.deletions, openedAt: Date.now() });
      setSidePanel("files"); setFilesView("diff");
    }});
  }, [onOpenDiff]);

  useEffect(() => {
    if (!activeDiff) return;
    const unsub = listen<any[]>("git:live-diff", ({ payload }) => {
      const f = payload.find((f: any) => f.path === activeDiff.path);
      if (!f) return;
      setActiveDiff(prev => prev ? { ...prev, diff: f.diff, changeType: f.change_type, insertions: f.insertions, deletions: f.deletions } : null);
    });
    return () => { unsub.then(fn => fn()); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDiff?.path]);

  const onSlotMount   = useCallback((id: string, el: HTMLDivElement) => { slotMapRef.current[id] = el; }, []);
  const onSlotUnmount = useCallback((id: string) => { delete slotMapRef.current[id]; }, []);

  useEffect(() => {
    const wrapper = wrapperRef.current; if (!wrapper) return;
    const compute = (el: HTMLDivElement): TermRect => {
      const s = el.getBoundingClientRect(), w = wrapper.getBoundingClientRect();
      return { left: s.left - w.left, top: s.top - w.top, width: s.width, height: s.height };
    };
    const obs: ResizeObserver[] = [];
    for (const [id, el] of Object.entries(slotMapRef.current)) {
      setTermRects(p => ({ ...p, [id]: compute(el) }));
      const o = new ResizeObserver(() => setTermRects(p => ({ ...p, [id]: compute(el) })));
      o.observe(el); obs.push(o);
    }
    const wo = new ResizeObserver(() => {
      setTermRects(p => { const n = { ...p }; for (const [id, el] of Object.entries(slotMapRef.current)) n[id] = compute(el); return n; });
    });
    wo.observe(wrapper); obs.push(wo);
    return () => obs.forEach(o => o.disconnect());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leafIds.join(",")]);

  useEffect(() => {
    const cwd = paneCwds[activePane]; if (cwd) onCwdChange(cwd);
  }, [paneCwds, activePane, onCwdChange]);

  const handleClose = useCallback((id: string) => {
    setPaneRoot((prev: PaneNode) => {
      if (collectIds(prev).length === 1) return prev;
      const next = removeLeaf(prev, id); if (!next) return prev;
      setActivePane((ap: string) => ap === id ? collectIds(next)[0] : ap);
      setTermRects((r: Record<string, TermRect>) => { const n = { ...r }; delete n[id]; return n; });
      return next;
    });
  }, []);

  const doSplit = useCallback((id: string, dir: "h" | "v") => {
    setPaneRoot((prev: PaneNode) => { const added = newLeaf(); setActivePane(added.id); return splitLeaf(prev, id, dir, added); });
  }, []);

  const openFileDiff = useCallback((fc: any) => {
    setActiveDiff({ id: `diff-${fc.path}`, path: fc.path, diff: fc.diff, changeType: fc.change_type, insertions: fc.insertions, deletions: fc.deletions, openedAt: Date.now() });
    setFilesView("diff");
  }, []);

  const toggleSide = useCallback((panel: SidePanel) => {
    if (panel === sidePanel) { setSidePanel(null); setActiveDiff(null); setFilesView("list"); return; }
    setSidePanel(panel);
    if (panel !== "files") { setActiveDiff(null); setFilesView("list"); }
  }, [sidePanel]);

  const memoryRunboxes = runboxes ?? [{ id: runbox.id, name: runbox.name }];

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <WorkspaceTabBar
        leafIds={leafIds} activePane={activePane} paneCwds={paneCwds}
        runboxCwd={runbox.cwd} branch={branch} toolbarSlot={toolbarSlot}
        onSelect={id => setActivePane(id)}
        onNewTerm={() => { setSidePanel(null); setActiveDiff(null); setFilesView("list"); doSplit(activePane, "h"); }}
        onClose={handleClose}
      />

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>

        {/* Terminal */}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, position: "relative" }}>
          <div ref={wrapperRef} style={{ position: "absolute", inset: 0, display: "flex", background: C.bg0, zIndex: 1 }}>
            <PaneTree
              node={paneRoot} activePane={activePane}
              onActivate={setActivePane} onClose={handleClose}
              onSplitH={id => doSplit(id, "h")} onSplitV={id => doSplit(id, "v")}
              onSlotMount={onSlotMount} onSlotUnmount={onSlotUnmount}
            />
            {leafIds.map(id => {
              const rect = termRects[id];
              return (
                <div key={id} style={{ position: "absolute", left: rect?.left ?? 0, top: rect?.top ?? 0, width: rect?.width ?? 0, height: rect?.height ?? 0, visibility: rect && rect.width > 0 ? "visible" : "hidden", zIndex: 1 }}>
                  <RunPane
                    runboxCwd={runbox.cwd} runboxId={runbox.id}
                    sessionId={`${runbox.id}-${id}`}
                    onCwdChange={cwd => setPaneCwds(p => ({ ...p, [id]: cwd }))}
                    isActive={activePane === id}
                    onActivate={() => setActivePane(id)}
                    onSessionChange={sid => onSessionChange?.(sid)}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Files panel */}
        {sidePanel === "files" && (
          <div style={{ width: panelWidth, flexShrink: 0, borderLeft: `1px solid ${C.border}`, display: "flex", background: filesView === "diff" ? C.bg0 : C.bg1, animation: "slideIn .14s ease-out" }}>
            <ResizeHandle onResize={setPanelWidth} />
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              {filesView === "list" && (
                <>
                  <PanelHeader title="Changed Files" icon={<IcoFiles on />}
                    onClose={() => { setSidePanel(null); setActiveDiff(null); setFilesView("list"); }} />
                  <div style={{ flex: 1, overflow: "auto" }}>
                    <FileChangeList runboxId={runbox.id} runboxCwd={runbox.cwd} onFileClick={openFileDiff} />
                  </div>
                </>
              )}
              {filesView === "diff" && activeDiff && (
                <DiffViewer tab={activeDiff} onClose={() => { setActiveDiff(null); setFilesView("list"); }} />
              )}
            </div>
          </div>
        )}

        {/* Other panels */}
        {sidePanel && sidePanel !== "files" && (
          <div style={{ width: panelWidth, flexShrink: 0, borderLeft: `1px solid ${C.border}`, display: "flex", background: C.bg1, animation: "slideIn .14s ease-out" }}>
            <ResizeHandle onResize={setPanelWidth} />
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              {sidePanel === "git"    && <GitWorktreePanel runboxCwd={runbox.cwd} runboxId={runbox.id} branch={branch} onClose={() => setSidePanel(null)} />}
              {sidePanel === "search" && <SearchPanel runboxId={runbox.id} onClose={() => setSidePanel(null)} />}
              {sidePanel === "memory" && <MemoryPanel runboxId={runbox.id} runboxName={runbox.name} runboxes={memoryRunboxes} onClose={() => setSidePanel(null)} />}
            </div>
          </div>
        )}

        {/* Right icon strip */}
        <div style={{
          width: 48, flexShrink: 0,
          background: C.bg1, borderLeft: `1px solid ${C.border}`,
          display: "flex", flexDirection: "column", alignItems: "center",
          paddingTop: 4,
        }}>
          <StripIcon title="Memory"        active={sidePanel === "memory"} onClick={() => toggleSide("memory")}><IcoBrain  on={sidePanel === "memory"} /></StripIcon>
          <StripIcon title="Changed Files" active={sidePanel === "files"}  onClick={() => toggleSide("files")} ><IcoFiles  on={sidePanel === "files"}  /></StripIcon>
          <StripIcon title="Git"           active={sidePanel === "git"}    onClick={() => toggleSide("git")}   ><IcoGit    on={sidePanel === "git"}    /></StripIcon>
          <div style={{ flex: 1 }} />
        </div>
      </div>

      <style>{`
        @keyframes slideIn { from { opacity:0; transform:translateX(10px); } to { opacity:1; transform:translateX(0); } }
        @keyframes sp { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}