// ui/ResizeHandle.tsx
// Drag handle for resizing side panels (right-edge only).

import { useRef } from "react";
import { C } from "../design";

interface Props { onResize: (w: number) => void; }

export function ResizeHandle({ onResize }: Props) {
  const dragging = useRef(false);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const w = window.innerWidth - ev.clientX - 48;
      if (w > 200 && w < 780) onResize(w);
    };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      onMouseDown={onMouseDown}
      style={{ width: 4, flexShrink: 0, cursor: "col-resize", background: "transparent", transition: "background .1s" }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = C.borderMd}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
    />
  );
}
