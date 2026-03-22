// src/runbox/PaneTree.tsx
import { useRef, useEffect, useState, useCallback } from "react";
import { C, tbtn } from "../shared/constants";
import type { PaneNode, TermNode } from "../shared/types";

// ── Sequence counter for new leaf IDs ────────────────────────────────────────
let _seq = 0;
export const newLeaf = (): TermNode => ({ type: "leaf", id: `t${++_seq}` });

// ── Tree mutation helpers ────────────────────────────────────────────────────
export function removeLeaf(node: PaneNode, id: string): PaneNode | null {
  if (node.type === "leaf") return node.id === id ? null : node;
  const a = removeLeaf(node.a, id), b = removeLeaf(node.b, id);
  if (!a && !b) return null;
  if (!a) return b!;
  if (!b) return a;
  return { ...node, a, b };
}

export function splitLeaf(
  node: PaneNode,
  id: string,
  dir: "h" | "v",
  added: TermNode,
): PaneNode {
  if (node.type === "leaf")
    return node.id !== id ? node : { type: "split", dir, a: node, b: added };
  return { ...node, a: splitLeaf(node.a, id, dir, added), b: splitLeaf(node.b, id, dir, added) };
}

export function collectIds(node: PaneNode): string[] {
  if (node.type === "leaf") return [node.id];
  return [...collectIds(node.a), ...collectIds(node.b)];
}

// ── Drag handle ──────────────────────────────────────────────────────────────
function DragHandle({
  dir,
  onResize,
}: {
  dir: "h" | "v";
  onResize: (delta: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [hovered,  setHovered]  = useState(false);
  const startPos = useRef(0);
  const isH = dir === "h";

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    startPos.current = isH ? e.clientX : e.clientY;

    const onMove = (ev: MouseEvent) => {
      const current = isH ? ev.clientX : ev.clientY;
      const delta   = current - startPos.current;
      startPos.current = current;
      onResize(delta);
      // Fire resize event so every RunPane's ResizeObserver
      // triggers fit.fit() + pty_resize — fixes bash line re-wrapping
      window.dispatchEvent(new Event("resize"));
    };

    const onUp = () => {
      setDragging(false);
      // One final resize event on mouse up to ensure clean state
      window.dispatchEvent(new Event("resize"));
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [isH, onResize]);

  const isLit = dragging || hovered;

  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flexShrink: 0,
        width:      isH ? 9 : "100%",
        height:     isH ? "100%" : 9,
        cursor:     isH ? "col-resize" : "row-resize",
        position:   "relative",
        display:    "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10,
        background: "transparent",
      }}
    >
      {/* Single clean 1px visible line */}
      <div style={{
        position:  "absolute",
        top:       isH ? 0 : "50%",
        left:      isH ? "50%" : 0,
        transform: isH ? "translateX(-50%)" : "translateY(-50%)",
        width:     isH ? 1 : "100%",
        height:    isH ? "100%" : 1,
        background: isLit
          ? "rgba(255,255,255,.2)"
          : "rgba(255,255,255,.07)",
        transition: "background .2s",
        pointerEvents: "none",
      }} />

      {/* Grip dots — appear on hover/drag */}
      <div style={{
        position:      "relative",
        zIndex:        2,
        display:       "flex",
        flexDirection: isH ? "column" : "row",
        gap:           3,
        opacity:       isLit ? 1 : 0,
        transition:    "opacity .2s",
        pointerEvents: "none",
      }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width:        2,
            height:       2,
            borderRadius: "50%",
            background:   dragging
              ? "rgba(255,255,255,.7)"
              : "rgba(255,255,255,.4)",
            flexShrink: 0,
          }} />
        ))}
      </div>
    </div>
  );
}

// ── PaneLeaf ─────────────────────────────────────────────────────────────────
interface PaneLeafProps {
  node:          TermNode;
  activePane:    string;
  onActivate:    (id: string) => void;
  onClose:       (id: string) => void;
  onSplitH:      (id: string) => void;
  onSplitV:      (id: string) => void;
  onSlotMount:   (id: string, el: HTMLDivElement) => void;
  onSlotUnmount: (id: string) => void;
  flex?:         number;
}

function PaneLeaf({
  node, activePane, onActivate, onClose, onSplitH, onSplitV,
  onSlotMount, onSlotUnmount, flex = 1,
}: PaneLeafProps) {
  const slotRef  = useRef<HTMLDivElement>(null);
  const isActive = node.id === activePane;

  useEffect(() => {
    if (slotRef.current) onSlotMount(node.id, slotRef.current);
    return () => onSlotUnmount(node.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  return (
    <div
      onClick={() => onActivate(node.id)}
      style={{
        flex, display: "flex", flexDirection: "column",
        minHeight: 0, minWidth: 0, position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Split / close controls — visible only when active */}
      <div style={{
        position: "absolute", top: 7, right: 9, zIndex: 20,
        background: C.bg2, border: `1px solid ${C.border}`,
        borderRadius: 8, padding: "3px 4px",
        display: "flex", gap: 2,
        opacity: isActive ? 1 : 0,
        transition: "opacity .15s",
        pointerEvents: isActive ? "auto" : "none",
      }}>
        <button
          title="Split right"
          onClick={e => { e.stopPropagation(); onSplitH(node.id); }}
          style={tbtn}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.tealText}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.t2}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <rect x="1" y="2" width="14" height="12" rx="2"/><line x1="8" y1="2" x2="8" y2="14"/>
          </svg>
        </button>
        <button
          title="Split down"
          onClick={e => { e.stopPropagation(); onSplitV(node.id); }}
          style={tbtn}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.tealText}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.t2}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <rect x="1" y="2" width="14" height="12" rx="2"/><line x1="1" y1="8" x2="15" y2="8"/>
          </svg>
        </button>
        <button
          title="Close pane"
          onClick={e => { e.stopPropagation(); onClose(node.id); }}
          style={tbtn}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.red}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.t2}
        >
          ×
        </button>
      </div>

      <div
        ref={slotRef}
        style={{
          flex: 1, minHeight: 0, minWidth: 0,
          opacity: isActive ? 1 : 0.3,
          transition: "opacity .2s",
        }}
      />
    </div>
  );
}

// ── PaneSplit — own component so hooks are never called conditionally ─────────
interface PaneSplitProps {
  node:          Extract<PaneNode, { type: "split" }>;
  activePane:    string;
  onActivate:    (id: string) => void;
  onClose:       (id: string) => void;
  onSplitH:      (id: string) => void;
  onSplitV:      (id: string) => void;
  onSlotMount:   (id: string, el: HTMLDivElement) => void;
  onSlotUnmount: (id: string) => void;
  flex?:         number;
}

function PaneSplit({ node, flex = 1, ...rest }: PaneSplitProps) {
  const isH          = node.dir === "h";
  const containerRef = useRef<HTMLDivElement>(null);
  const [splitPct, setSplitPct] = useState(50);

  const handleResize = useCallback((delta: number) => {
    if (!containerRef.current) return;
    const total = isH
      ? containerRef.current.offsetWidth
      : containerRef.current.offsetHeight;
    if (total === 0) return;
    const deltaPct = (delta / total) * 100;
    setSplitPct(prev => Math.min(85, Math.max(15, prev + deltaPct)));
  }, [isH]);

  return (
    <div
      ref={containerRef}
      style={{
        display:       "flex",
        flexDirection: isH ? "row" : "column",
        flex,
        minHeight: 0,
        minWidth:  0,
      }}
    >
      <PaneTree {...rest} node={node.a} flex={splitPct} />
      <DragHandle dir={node.dir} onResize={handleResize} />
      <PaneTree {...rest} node={node.b} flex={100 - splitPct} />
    </div>
  );
}

// ── PaneTree ─────────────────────────────────────────────────────────────────
interface PaneTreeProps {
  node:          PaneNode;
  activePane:    string;
  onActivate:    (id: string) => void;
  onClose:       (id: string) => void;
  onSplitH:      (id: string) => void;
  onSplitV:      (id: string) => void;
  onSlotMount:   (id: string, el: HTMLDivElement) => void;
  onSlotUnmount: (id: string) => void;
  flex?:         number;
}

export function PaneTree(props: PaneTreeProps) {
  const { node, flex = 1, ...rest } = props;

  if (node.type === "split") {
    return <PaneSplit node={node} flex={flex} {...rest} />;
  }

  return <PaneLeaf node={node} flex={flex} {...rest} />;
}