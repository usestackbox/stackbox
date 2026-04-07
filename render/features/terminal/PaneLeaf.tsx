// features/terminal/PaneLeaf.tsx
import { useEffect, useRef } from "react";
import { C } from "../../design";
import type { TermNode } from "../../types";

interface PaneLeafProps {
  node: TermNode;
  activePane: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onSplitH: (id: string) => void;
  onSplitV: (id: string) => void;
  onSlotMount: (id: string, el: HTMLDivElement) => void;
  onSlotUnmount: (id: string) => void;
  flex?: number;
}

const tbtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: C.t2,
  cursor: "pointer",
  padding: "3px 6px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: C.r2,
  lineHeight: 1,
  flexShrink: 0,
};

export function PaneLeaf({
  node,
  activePane,
  onActivate,
  onClose,
  onSplitH,
  onSplitV,
  onSlotMount,
  onSlotUnmount,
  flex = 1,
}: PaneLeafProps) {
  const slotRef = useRef<HTMLDivElement>(null);
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
        flex,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        minWidth: 0,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Split / close controls — visible only when pane is active */}
      <div
        style={{
          position: "absolute",
          top: 7,
          right: 9,
          zIndex: 20,
          background: C.bg2,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          padding: "3px 4px",
          display: "flex",
          gap: 2,
          opacity: isActive ? 1 : 0,
          transition: "opacity .15s",
          pointerEvents: isActive ? "auto" : "none",
        }}
      >
        <button
          title="Split right"
          onClick={(e) => {
            e.stopPropagation();
            onSplitH(node.id);
          }}
          style={tbtn}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = C.tealText)}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = C.t2)}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <rect x="1" y="2" width="14" height="12" rx="2" />
            <line x1="8" y1="2" x2="8" y2="14" />
          </svg>
        </button>

        <button
          title="Split down"
          onClick={(e) => {
            e.stopPropagation();
            onSplitV(node.id);
          }}
          style={tbtn}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = C.tealText)}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = C.t2)}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <rect x="1" y="2" width="14" height="12" rx="2" />
            <line x1="1" y1="8" x2="15" y2="8" />
          </svg>
        </button>

        <button
          title="Close pane"
          onClick={(e) => {
            e.stopPropagation();
            onClose(node.id);
          }}
          style={tbtn}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = C.red)}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = C.t2)}
        >
          ×
        </button>
      </div>

      {/* Slot — TerminalPane is portal-mounted here by parent */}
      <div
        ref={slotRef}
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          opacity: isActive ? 1 : 0.3,
          transition: "opacity .2s",
        }}
      />
    </div>
  );
}
