import { useRef, useEffect } from "react";
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
}

function PaneLeaf({ node, activePane, onActivate, onClose, onSplitH, onSplitV, onSlotMount, onSlotUnmount }: PaneLeafProps) {
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
      style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0, position: "relative", outline: isActive ? "1px solid rgba(63,182,139,.16)" : "none", outlineOffset: -1 }}
    >
      {/* Split / close controls — visible only when active */}
      <div style={{ position: "absolute", top: 7, right: 9, zIndex: 20, background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 8, padding: "3px 4px", display: "flex", gap: 2, opacity: isActive ? 1 : 0, transition: "opacity .15s", pointerEvents: isActive ? "auto" : "none" }}>
        <button title="Split right" onClick={e => { e.stopPropagation(); onSplitH(node.id); }} style={tbtn}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.tealText}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.t2}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="1" y="2" width="14" height="12" rx="2"/><line x1="8" y1="2" x2="8" y2="14"/></svg>
        </button>
        <button title="Split down" onClick={e => { e.stopPropagation(); onSplitV(node.id); }} style={tbtn}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.tealText}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.t2}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="1" y="2" width="14" height="12" rx="2"/><line x1="1" y1="8" x2="15" y2="8"/></svg>
        </button>
        <button title="Close pane" onClick={e => { e.stopPropagation(); onClose(node.id); }} style={tbtn}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.red}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.t2}>×</button>
      </div>

      <div ref={slotRef} style={{ flex: 1, minHeight: 0, minWidth: 0, opacity: isActive ? 1 : 0.3, transition: "opacity .2s" }} />
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
}

export function PaneTree(props: PaneTreeProps) {
  const { node, ...rest } = props;
  if (node.type === "split") {
    const isH = node.dir === "h";
    return (
      <div style={{ display: "flex", flexDirection: isH ? "row" : "column", flex: 1, minHeight: 0, minWidth: 0 }}>
        <div style={{ flex: 1, display: "flex", minHeight: 0, minWidth: 0, borderRight: isH ? `1px solid ${C.border}` : "none", borderBottom: !isH ? `1px solid ${C.border}` : "none" }}>
          <PaneTree node={node.a} {...rest} />
        </div>
        <div style={{ flex: 1, display: "flex", minHeight: 0, minWidth: 0 }}>
          <PaneTree node={node.b} {...rest} />
        </div>
      </div>
    );
  }
  return <PaneLeaf node={node} {...rest} />;
}