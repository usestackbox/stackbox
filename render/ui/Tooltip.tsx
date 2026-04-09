// ui/Tooltip.tsx
import { useState, useRef } from "react";
import { BG, C, BORDER, RADIUS, SHADOW } from "../design";

interface Props {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: "top" | "bottom" | "left" | "right";
}

export function Tooltip({ content, children, side = "top" }: Props) {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const offset: React.CSSProperties =
    side === "top" ? { bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)" }
    : side === "bottom" ? { top: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)" }
    : side === "left" ? { right: "calc(100% + 6px)", top: "50%", transform: "translateY(-50%)" }
    : { left: "calc(100% + 6px)", top: "50%", transform: "translateY(-50%)" };

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <div style={{
          position: "absolute", ...offset, zIndex: 2000,
          background: BG[5], border: `1px solid ${BORDER.mid}`,
          borderRadius: RADIUS.xs, padding: "4px 8px", whiteSpace: "nowrap",
          fontSize: 12, color: C.t1, boxShadow: SHADOW.sm, pointerEvents: "none",
        }}>
          {content}
        </div>
      )}
    </div>
  );
}
