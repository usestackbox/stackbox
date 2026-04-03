// features/terminal/DragHandle.tsx
import { useRef, useState, useCallback } from "react";

interface DragHandleProps {
  dir:      "h" | "v";
  onResize: (delta: number) => void;
}

export function DragHandle({ dir, onResize }: DragHandleProps) {
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
      // Trigger fit() on every ResizeObserver — fixes bash line re-wrapping
      window.dispatchEvent(new Event("resize"));
    };

    const onUp = () => {
      setDragging(false);
      window.dispatchEvent(new Event("resize"));
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
  }, [isH, onResize]);

  const lit = dragging || hovered;

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
      {/* 1px visible divider line */}
      <div style={{
        position:  "absolute",
        top:       isH ? 0 : "50%",
        left:      isH ? "50%" : 0,
        transform: isH ? "translateX(-50%)" : "translateY(-50%)",
        width:     isH ? 1 : "100%",
        height:    isH ? "100%" : 1,
        background: lit ? "rgba(255,255,255,.20)" : "rgba(255,255,255,.07)",
        transition: "background .2s",
        pointerEvents: "none",
      }} />

      {/* Grip dots */}
      <div style={{
        position:      "relative",
        zIndex:        2,
        display:       "flex",
        flexDirection: isH ? "column" : "row",
        gap:           3,
        opacity:       lit ? 1 : 0,
        transition:    "opacity .2s",
        pointerEvents: "none",
      }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width:        2,
            height:       2,
            borderRadius: "50%",
            background:   dragging
              ? "rgba(255,255,255,.70)"
              : "rgba(255,255,255,.40)",
            flexShrink: 0,
          }} />
        ))}
      </div>
    </div>
  );
}