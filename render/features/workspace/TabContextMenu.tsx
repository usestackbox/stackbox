// features/workspace/TabContextMenu.tsx
import { useEffect, useRef } from "react";
import { C, MONO } from "../../design";
import type { WinState } from "./types";

function winLabel(win: WinState): string {
  if (win.kind === "browser") return win.label ?? "browser";
  return win.cwd.split(/[/\\]/).filter(Boolean).pop() ?? "~";
}

interface TabContextMenuProps {
  x:                number;
  y:                number;
  win:              WinState;
  isFirst:          boolean;
  isLast:           boolean;
  onClose:          () => void;
  onCloseTab:       () => void;
  onRestore?:       () => void;
  onMoveLeft:       () => void;
  onMoveRight:      () => void;
  // ── New actions ──────────────────────────────────────────
  onNewTerminal?:   () => void;
  onSplitDown?:     () => void;
  onSplitRight?:    () => void;
  onNextTerminal?:  () => void;
  onPrevTerminal?:  () => void;
  onOpenChanges?:   () => void;
  onNewWorkspace?:  () => void;
}

interface MenuItem {
  label:     string;
  shortcut?: string;
  action:    () => void;
  danger?:   boolean;
  disabled?: boolean;
  icon?:     string;
}

// Tiny inline SVG icons via emoji-style unicode chars for cleanliness
function MenuIcon({ char }: { char: string }) {
  return (
    <span style={{
      fontSize: 11, width: 14, display: "inline-flex",
      alignItems: "center", justifyContent: "center",
      opacity: 0.6, flexShrink: 0,
    }}>
      {char}
    </span>
  );
}

export function TabContextMenu({
  x, y, win, isFirst, isLast,
  onClose, onCloseTab, onRestore,
  onMoveLeft, onMoveRight,
  onNewTerminal, onSplitDown, onSplitRight,
  onNextTerminal, onPrevTerminal, onOpenChanges, onNewWorkspace,
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

  const left = Math.min(x, window.innerWidth  - 210);
  const top  = Math.min(y, window.innerHeight - 300);

  const itemStyle = (disabled?: boolean, danger?: boolean): React.CSSProperties => ({
    padding: "7px 12px",
    cursor: disabled ? "default" : "pointer",
    fontSize: 12,
    display: "flex",
    alignItems: "center",
    gap: 8,
    color: disabled
      ? "rgba(255,255,255,.2)"
      : danger
        ? C.red
        : "rgba(255,255,255,.78)",
    transition: "background .08s",
    borderRadius: 4,
    userSelect: "none",
  });

  const hoverBg = (e: React.MouseEvent, active: boolean) => {
    (e.currentTarget as HTMLElement).style.background = active
      ? "rgba(255,255,255,.07)" : "transparent";
  };

  type Section = { heading?: string; items: MenuItem[] };

  const sections: Section[] = [
    // ── Navigation ──────────────────────────────
    {
      items: [
        ...(onPrevTerminal ? [{ label: "Previous Terminal", shortcut: "⌃⇧Tab", action: () => { onPrevTerminal(); onClose(); }, icon: "←" }] : []),
        ...(onNextTerminal ? [{ label: "Next Terminal",     shortcut: "⌃Tab",  action: () => { onNextTerminal(); onClose(); }, icon: "→" }] : []),
      ],
    },
    // ── Terminal ops ─────────────────────────────
    {
      items: [
        ...(onNewTerminal ? [{ label: "New Terminal",  shortcut: "⌃⇧T", action: () => { onNewTerminal(); onClose(); }, icon: "+" }] : []),
        ...(onSplitDown   ? [{ label: "Split Down",               action: () => { onSplitDown(); onClose(); },  icon: "⊟" }] : []),
        ...(onSplitRight  ? [{ label: "Split Right",              action: () => { onSplitRight(); onClose(); }, icon: "⊞" }] : []),
      ],
    },
    // ── Arrange ──────────────────────────────────
    {
      items: [
        ...(win.minimized ? [{ label: "Restore", action: () => { onRestore?.(); onClose(); }, icon: "▣" }] : []),
        { label: "Move Left",  action: () => { onMoveLeft();  onClose(); }, disabled: isFirst, icon: "◀" },
        { label: "Move Right", action: () => { onMoveRight(); onClose(); }, disabled: isLast,  icon: "▶" },
      ],
    },
    // ── Workspace ────────────────────────────────
    {
      items: [
        ...(onOpenChanges  ? [{ label: "Open Changes",    shortcut: "⌃⇧G", action: () => { onOpenChanges(); onClose(); }, icon: "⎇" }] : []),
        ...(onNewWorkspace ? [{ label: "New Workspace",   shortcut: "⌃⇧N", action: () => { onNewWorkspace(); onClose(); }, icon: "⊕" }] : []),
      ],
    },
    // ── Danger ───────────────────────────────────
    {
      items: [
        { label: "Close Tab", action: () => { onCloseTab(); onClose(); }, danger: true, icon: "✕" },
      ],
    },
  ];

  // Filter out empty sections
  const visibleSections = sections.filter(s => s.items.length > 0);

  return (
    <div ref={ref} style={{
      position: "fixed", zIndex: 9999, left, top,
      background: "rgba(16,17,21,0.97)",
      backdropFilter: "blur(20px)",
      border: "1px solid rgba(255,255,255,.1)",
      borderRadius: 10,
      boxShadow: "0 16px 48px rgba(0,0,0,.75), 0 4px 16px rgba(0,0,0,.4)",
      padding: "5px",
      minWidth: 200,
      fontFamily: MONO,
    }}>
      {/* Title row */}
      <div style={{
        padding: "5px 10px 7px",
        fontSize: 10,
        color: "rgba(255,255,255,.3)",
        borderBottom: "1px solid rgba(255,255,255,.06)",
        marginBottom: 3,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {winLabel(win)}
      </div>

      {visibleSections.map((section, si) => (
        <div key={si}>
          {si > 0 && (
            <div style={{ height: 1, background: "rgba(255,255,255,.06)", margin: "3px 2px" }} />
          )}
          {section.items.map((item, ii) => (
            <div
              key={ii}
              onClick={item.disabled ? undefined : item.action}
              style={itemStyle(item.disabled, item.danger)}
              onMouseEnter={e => { if (!item.disabled) hoverBg(e, true); }}
              onMouseLeave={e => hoverBg(e, false)}
            >
              {item.icon && <MenuIcon char={item.icon} />}
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.shortcut && (
                <span style={{ fontSize: 10, color: "rgba(255,255,255,.22)", fontFamily: MONO }}>
                  {item.shortcut}
                </span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
