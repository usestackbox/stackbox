import { useState, useRef, useEffect, useCallback } from "react";
import RunPane from "../core/RunPane";
import { WorkspaceTabBar } from "./WorkspaceTabBar";
import { DiffViewer } from "./DiffViewer";
import { PaneTree, newLeaf, removeLeaf, splitLeaf, collectIds } from "./PaneTree";
import { C } from "../shared/constants";
import type { Runbox, DiffTab, PaneNode } from "../shared/types";

interface TermRect { left: number; top: number; width: number; height: number; }

interface WorkspaceViewProps {
  runbox:           Runbox;
  branch:           string;
  toolbarSlot?:     React.ReactNode;
  onCwdChange:      (cwd: string) => void;
  onSessionChange?: (sid: string) => void;
  onOpenDiff:       (ref: { open: (fc: { path: string; diff: string; change_type: string; insertions: number; deletions: number }) => void }) => void;
}

export function WorkspaceView({ runbox, branch, toolbarSlot, onCwdChange, onSessionChange, onOpenDiff }: WorkspaceViewProps) {
  const firstLeaf = useRef(newLeaf());
  const [paneRoot,   setPaneRoot]   = useState<PaneNode>(() => firstLeaf.current);
  const [activePane, setActivePane] = useState<string>(() => firstLeaf.current.id);
  const [paneCwds,   setPaneCwds]   = useState<Record<string, string>>({});
  const [diffTabs,   setDiffTabs]   = useState<DiffTab[]>([]);
  const slotMapRef  = useRef<Record<string, HTMLDivElement>>({});
  const [termRects,  setTermRects]  = useState<Record<string, TermRect>>({});
  const wrapperRef  = useRef<HTMLDivElement>(null);
  const leafIds     = collectIds(paneRoot);

  // Expose openDiffTab to parent via callback ref pattern
  useEffect(() => {
    onOpenDiff({
      open: (fc) => {
        setDiffTabs(prev => {
          const existing = prev.find(t => t.path === fc.path);
          if (existing) { setActivePane(existing.id); return prev; }
          const id = `diff-${Date.now()}`;
          setActivePane(id);
          return [...prev, { id, path: fc.path, diff: fc.diff, changeType: fc.change_type, insertions: fc.insertions, deletions: fc.deletions, openedAt: Date.now() }];
        });
      },
    });
  }, [onOpenDiff]);

  const onSlotMount   = useCallback((id: string, el: HTMLDivElement) => { slotMapRef.current[id] = el; }, []);
  const onSlotUnmount = useCallback((id: string) => { delete slotMapRef.current[id]; }, []);

  // Measure terminal slot rects relative to wrapper
  useEffect(() => {
    const wrapper = wrapperRef.current; if (!wrapper) return;
    const compute = (el: HTMLDivElement): TermRect => {
      const s = el.getBoundingClientRect(), w = wrapper.getBoundingClientRect();
      return { left: s.left - w.left, top: s.top - w.top, width: s.width, height: s.height };
    };
    const obs: ResizeObserver[] = [];
    for (const [id, el] of Object.entries(slotMapRef.current)) {
      setTermRects(p => ({ ...p, [id]: compute(el) }));
      const o = new ResizeObserver(() => setTermRects(p => ({ ...p, [id]: compute(el) }))); o.observe(el); obs.push(o);
    }
    const wo = new ResizeObserver(() => {
      setTermRects(p => { const n = { ...p }; for (const [id, el] of Object.entries(slotMapRef.current)) n[id] = compute(el); return n; });
    });
    wo.observe(wrapper); obs.push(wo);
    return () => obs.forEach(o => o.disconnect());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leafIds.join(",")]);

  useEffect(() => {
    const cwd = paneCwds[activePane];
    if (cwd) onCwdChange(cwd);
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

  const handleCloseDiff = useCallback((id: string) => {
    setDiffTabs((prev: DiffTab[]) => {
      const next = prev.filter(t => t.id !== id);
      setActivePane((ap: string) => {
        if (ap !== id) return ap;
        return next[next.length - 1]?.id ?? leafIds[0] ?? ap;
      });
      return next;
    });
  }, [leafIds]);

  const doSplit = useCallback((id: string, dir: "h" | "v") => {
    setPaneRoot((prev: PaneNode) => { const added = newLeaf(); setActivePane(added.id); return splitLeaf(prev, id, dir, added); });
  }, []);

  const activeDiffTab  = diffTabs.find(t => t.id === activePane) ?? null;
  const isTerminalPane = leafIds.includes(activePane);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <WorkspaceTabBar
        leafIds={leafIds} activePane={activePane} paneCwds={paneCwds}
        runboxCwd={runbox.cwd} diffTabs={diffTabs}
        branch={branch} toolbarSlot={toolbarSlot}
        onSelect={id => setActivePane(id)}
        onNewTerm={() => doSplit(activePane, "h")}
        onClose={handleClose}
        onCloseDiff={handleCloseDiff}
      />

      {/* Active diff tab */}
      {activeDiffTab && (
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          <DiffViewer tab={activeDiffTab} />
        </div>
      )}

      {/* Pane tree — always rendered, hidden when diff is active so terminals stay alive */}
      <div ref={wrapperRef} style={{ flex: 1, display: isTerminalPane ? "flex" : "none", minHeight: 0, background: C.bg0, position: "relative" }}>
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
  );
}