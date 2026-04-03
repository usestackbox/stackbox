// ui/ContextMenu.tsx
// Generic portal-based context menu — used by FilePanel and GitPanel.

import { useRef, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { C, MONO, SANS } from "../design";

export type CtxMenuItem =
  | { label: string; shortcut?: string; danger?: boolean; disabled?: boolean; onClick: () => void }
  | "separator";

interface Props {
  x:       number;
  y:       number;
  title?:  string;
  items:   CtxMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, title, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => { const t = setTimeout(() => setVisible(true), 10); return () => clearTimeout(t); }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey  = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const t = setTimeout(() => {
      document.addEventListener("mousedown", onDown);
      document.addEventListener("keydown",   onKey);
    }, 50);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const ITEM_H   = 28;
  const SEP_H    = 7;
  const itemCount = items.filter(i => i !== "separator").length;
  const sepCount  = items.filter(i => i === "separator").length;
  const estH      = 8 + itemCount * ITEM_H + sepCount * SEP_H;
  const cx = Math.min(x, window.innerWidth  - 185);
  const cy = Math.min(y, window.innerHeight - estH - 8);

  return createPortal(
    <div
      ref={ref}
      onClick={e => e.stopPropagation()}
      style={{
        position: "fixed", top: cy, left: cx, zIndex: 99999,
        minWidth: 175,
        background: "rgba(18,20,24,0.96)",
        backdropFilter: "blur(28px) saturate(180%)",
        border: "1px solid rgba(255,255,255,.08)",
        borderRadius: 9, padding: "4px",
        boxShadow: "0 24px 64px rgba(0,0,0,.75), 0 4px 16px rgba(0,0,0,.5)",
        fontFamily: SANS,
        opacity:   visible ? 1 : 0,
        transform: visible ? "scale(1) translateY(0)" : "scale(.95) translateY(-6px)",
        transformOrigin: "top left",
        transition: "opacity .14s ease, transform .14s cubic-bezier(.16,1,.3,1)",
      }}
    >
      {title && (
        <>
          <div style={{ padding: "3px 10px 5px", fontSize: 9, fontFamily: MONO, fontWeight: 700, letterSpacing: ".1em", color: "rgba(255,255,255,.22)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title.toUpperCase()}
          </div>
          <div style={{ height: 1, background: "rgba(255,255,255,.07)", marginBottom: 3 }} />
        </>
      )}
      {items.map((item, i) =>
        item === "separator"
          ? <div key={i} style={{ height: 1, background: "rgba(255,255,255,.07)", margin: "3px 0" }} />
          : <CtxItem key={item.label} {...item} onClose={onClose} />
      )}
    </div>,
    document.body,
  );
}

function CtxItem({ label, shortcut, danger, disabled, onClick, onClose }: {
  label: string; shortcut?: string; danger?: boolean; disabled?: boolean;
  onClick: () => void; onClose: () => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onClick={() => { if (!disabled) { onClick(); onClose(); } }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", alignItems: "center", padding: "0 10px",
        height: ITEM_H, borderRadius: 6,
        cursor:     disabled ? "default" : "pointer",
        background: hov && !disabled ? (danger ? "rgba(239,68,68,.18)" : "rgba(255,255,255,.08)") : "transparent",
        color: disabled ? "rgba(255,255,255,.2)" : danger ? (hov ? "#fca5a5" : "#f87171") : (hov ? "#fff" : "rgba(255,255,255,.78)"),
        transition: "background .08s, color .08s",
        gap: 8,
      }}
    >
      <span style={{ fontSize: 12, fontFamily: SANS, fontWeight: 450, flex: 1 }}>{label}</span>
      {shortcut && <span style={{ fontSize: 10, fontFamily: MONO, color: "rgba(255,255,255,.2)" }}>{shortcut}</span>}
    </div>
  );
}

const ITEM_H = 28;
