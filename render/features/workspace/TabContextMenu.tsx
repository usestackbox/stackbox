// features/workspace/TabContextMenu.tsx
import { useEffect, useRef } from "react";
import { C, MONO } from "../../design";
import type { WinState } from "./types";

function winLabel(win: WinState): string {
  if (win.kind === "browser") return win.label ?? "browser";
  return win.cwd.split(/[/\\]/).filter(Boolean).pop() ?? "~";
}

interface TabContextMenuProps {
  x:           number;
  y:           number;
  win:         WinState;
  isFirst:     boolean;
  isLast:      boolean;
  onClose:     () => void;
  onCloseTab:  () => void;
  onRestore?:  () => void;
  onMoveLeft:  () => void;
  onMoveRight: () => void;
}

interface MenuItem {
  label:    string;
  action:   () => void;
  danger?:  boolean;
  disabled?: boolean;
}

export function TabContextMenu({
  x, y, win, isFirst, isLast,
  onClose, onCloseTab, onRestore, onMoveLeft, onMoveRight,
}: TabContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      const handler = (e: MouseEvent) => {
        if (ref.current && !ref.current.contains(e.target as Node)) onClose();
      };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }, 50);
    return () => clearTimeout(t);
  }, [onClose]);

  const left = Math.min(x, window.innerWidth  - 200);
  const top  = Math.min(y, window.innerHeight - 180);

  const items: MenuItem[] = [
    ...(win.minimized
      ? [{ label: "Restore", action: () => { onRestore?.(); onClose(); } }]
      : []),
    { label: "Move Left",  action: () => { onMoveLeft();  onClose(); }, disabled: isFirst },
    { label: "Move Right", action: () => { onMoveRight(); onClose(); }, disabled: isLast  },
    { label: "Close",      action: () => { onCloseTab();  onClose(); }, danger: true },
  ];

  return (
    <div ref={ref} style={{
      position: "fixed", zIndex: 9999, left, top,
      background: "rgba(18,18,22,0.97)",
      backdropFilter: "blur(16px)",
      border: "1px solid rgba(255,255,255,.1)",
      borderRadius: 8,
      boxShadow: "0 12px 40px rgba(0,0,0,.7)",
      padding: "4px 0", minWidth: 170,
      fontFamily: MONO,
    }}>
      <div style={{
        padding: "5px 12px 7px",
        fontSize: 10,
        color: "rgba(255,255,255,.3)",
        borderBottom: "1px solid rgba(255,255,255,.06)",
        marginBottom: 3,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {winLabel(win)}
      </div>

      {items.map((item, i) => (
        <div
          key={i}
          onClick={item.disabled ? undefined : item.action}
          style={{
            padding: "7px 12px",
            cursor: item.disabled ? "default" : "pointer",
            fontSize: 12,
            color: item.disabled
              ? "rgba(255,255,255,.2)"
              : item.danger
                ? C.red
                : "rgba(255,255,255,.75)",
            transition: "background .08s",
          }}
          onMouseEnter={e => {
            if (!item.disabled)
              (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,.06)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
          }}
        >
          {item.label}
        </div>
      ))}
    </div>
  );
}