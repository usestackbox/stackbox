// ui/Modal.tsx
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { BG, BORDER, SHADOW, RADIUS, C } from "../design";
import { useClickOutside } from "../hooks";

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  width?: number | string;
  children: React.ReactNode;
}

export function Modal({ open, onClose, title, width = 520, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, onClose);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,.7)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div ref={ref} style={{
        width, maxWidth: "90vw", maxHeight: "85vh",
        background: BG[3], border: `1px solid ${BORDER.mid}`,
        borderRadius: RADIUS.lg, boxShadow: SHADOW.xl,
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        {title && (
          <div style={{
            padding: "16px 20px", borderBottom: `1px solid ${BORDER.subtle}`,
            fontSize: 14, fontWeight: 600, color: C.t1, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            {title}
            <button onClick={onClose} style={{
              background: "none", border: "none", color: C.t3,
              cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 2px",
            }}>×</button>
          </div>
        )}
        <div style={{ overflow: "auto", flex: 1 }}>{children}</div>
      </div>
    </div>,
    document.body
  );
}
