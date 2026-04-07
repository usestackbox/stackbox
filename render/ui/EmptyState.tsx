// ui/EmptyState.tsx
// Reusable empty/placeholder state used in workspace and panel views.

import { C, SANS } from "../design";

interface Props {
  icon?: React.ReactNode;
  title?: string;
  message: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ icon, title, message, action }: Props) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        padding: "40px 20px",
        userSelect: "none",
      }}
    >
      {icon && <span style={{ opacity: 0.3, fontSize: 22 }}>{icon}</span>}
      {title && (
        <span style={{ fontSize: 13, fontWeight: 600, color: C.t1, fontFamily: SANS }}>
          {title}
        </span>
      )}
      <span style={{ fontSize: 12, color: C.t2, fontFamily: SANS, textAlign: "center" }}>
        {message}
      </span>
      {action && (
        <button
          onClick={action.onClick}
          style={{
            marginTop: 4,
            padding: "6px 18px",
            background: "transparent",
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            color: C.t2,
            fontSize: 11,
            fontFamily: SANS,
            cursor: "pointer",
            transition: "all .15s",
          }}
          onMouseEnter={(e) => {
            const el = e.currentTarget as HTMLElement;
            el.style.background = C.bg3;
            el.style.color = C.t0;
            el.style.borderColor = C.borderMd;
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget as HTMLElement;
            el.style.background = "transparent";
            el.style.color = C.t2;
            el.style.borderColor = C.border;
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
