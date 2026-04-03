// features/terminal/PaneSplit.tsx
import { useRef, useState, useCallback } from "react";
import { DragHandle } from "./DragHandle";
import { PaneTree }   from "./PaneTree";
import type { SplitNode, TermNode } from "../../types";

interface PaneSplitProps {
  node:          SplitNode;
  activePane:    string;
  onActivate:    (id: string) => void;
  onClose:       (id: string) => void;
  onSplitH:      (id: string) => void;
  onSplitV:      (id: string) => void;
  onSlotMount:   (id: string, el: HTMLDivElement) => void;
  onSlotUnmount: (id: string) => void;
  flex?:         number;
}

export function PaneSplit({ node, flex = 1, ...rest }: PaneSplitProps) {
  const isH          = node.dir === "h";
  const containerRef = useRef<HTMLDivElement>(null);
  const [splitPct, setSplitPct] = useState(50);

  const handleResize = useCallback((delta: number) => {
    if (!containerRef.current) return;
    const total = isH
      ? containerRef.current.offsetWidth
      : containerRef.current.offsetHeight;
    if (total === 0) return;
    const pct = (delta / total) * 100;
    setSplitPct(prev => Math.min(85, Math.max(15, prev + pct)));
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