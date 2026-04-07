import { C, FS, SP } from "../../design/tokens";
import { fmtShortcut } from "../../hooks/useKeyboard";
import type { PaletteAction } from "./paletteActions";

interface Props {
  action: PaletteAction;
  active: boolean;
  onSelect: () => void;
  onHover: () => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  git: C.green,
  workspace: C.blue,
  file: C.t1,
  settings: C.t1,
  nav: C.t1,
  tools: C.amber,
};

export function PaletteItem({ action, active, onSelect, onHover }: Props) {
  return (
    <div
      onMouseDown={(e) => {
        e.preventDefault();
        onSelect();
      }}
      onMouseEnter={onHover}
      style={{
        display: "flex",
        alignItems: "center",
        gap: SP[2],
        padding: `${SP[2]}px ${SP[3]}px`,
        borderRadius: C.r2,
        background: active ? C.bg5 : "transparent",
        cursor: "pointer",
        transition: "background 80ms",
      }}
    >
      {action.icon && (
        <span style={{ fontSize: 15, width: 22, textAlign: "center", flexShrink: 0 }}>
          {action.icon}
        </span>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: FS.sm,
            color: active ? C.t0 : C.t1,
            fontWeight: active ? 500 : 400,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {action.label}
        </div>
        {action.description && (
          <div
            style={{
              fontSize: FS.xs,
              color: C.t2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              marginTop: 1,
            }}
          >
            {action.description}
          </div>
        )}
      </div>

      <span
        style={{
          fontSize: FS.xs,
          color: CATEGORY_COLORS[action.category] ?? C.t2,
          opacity: 0.65,
          flexShrink: 0,
        }}
      >
        {action.category}
      </span>

      {action.shortcut && (
        <span
          style={{
            fontSize: FS.xs,
            color: C.t2,
            background: C.bg4,
            border: `1px solid ${C.border}`,
            borderRadius: C.r1,
            padding: `1px ${SP[2]}px`,
            flexShrink: 0,
            fontFamily: "monospace",
            letterSpacing: "0.02em",
          }}
        >
          {fmtShortcut(action.shortcut)}
        </span>
      )}
    </div>
  );
}
