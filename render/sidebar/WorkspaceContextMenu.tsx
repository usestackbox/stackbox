// sidebar/WorkspaceContextMenu.tsx
import { useEffect, useRef, useState } from "react";
import { C, FS, MONO, SANS } from "../design";

interface Props {
  x: number;
  y: number;
  wsName: string;
  onDelete: () => void;
  onChangeName: () => void;
  onChangeDir: () => void;
  onChangeIcon?: () => void;
  onClose: () => void;
}

export function WorkspaceContextMenu({
  x,
  y,
  wsName,
  onDelete,
  onChangeName,
  onChangeDir,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [vis, setVis] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVis(true), 10);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const onOut = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onOut);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onOut);
      document.removeEventListener("keydown", onEsc);
    };
  }, [onClose]);

  const left = Math.min(x, window.innerWidth - 200 - 12);
  const top = Math.min(y, window.innerHeight - 180);

  const items = [
    {
      label: "Change Name",
      danger: false,
      action: () => {
        onChangeName();
        onClose();
      },
      icon: (
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      ),
    },
    {
      label: "Change Directory",
      danger: false,
      action: () => {
        onChangeDir();
        onClose();
      },
      icon: (
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      ),
    },
    {
      label: "Delete workspace",
      danger: true,
      action: () => {
        onDelete();
        onClose();
      },
      icon: (
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14H6L5 6" />
          <path d="M10 11v6M14 11v6M9 6V4h6v2" />
        </svg>
      ),
    },
  ];

  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        left,
        top,
        width: 200,
        background: C.bg2,
        border: `1px solid ${C.border}`,
        borderRadius: C.r4,
        boxShadow: C.shadowLg,
        zIndex: 99998,
        overflow: "hidden",
        padding: 5,
        opacity: vis ? 1 : 0,
        transform: vis ? "scale(1) translateY(0)" : "scale(.95) translateY(-4px)",
        transformOrigin: "top left",
        transition: "opacity .15s ease, transform .15s cubic-bezier(.16,1,.3,1)",
      }}
    >
      <div
        style={{
          padding: "5px 10px",
          fontSize: FS.xxs,
          fontFamily: MONO,
          fontWeight: 700,
          letterSpacing: ".12em",
          color: C.t3,
          userSelect: "none",
        }}
      >
        {wsName.toUpperCase()}
      </div>
      <div style={{ height: 1, background: C.border, margin: "0 0 4px" }} />

      {items.map((item, i) => (
        <button
          key={i}
          onClick={item.action}
          style={{
            width: "100%",
            border: "none",
            cursor: "pointer",
            background: "transparent",
            borderRadius: C.r2,
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "7px 10px",
            textAlign: "left",
            color: item.danger ? C.red : C.t1,
            fontSize: FS.md,
            fontFamily: SANS,
            transition: "background .08s, color .08s",
          }}
          onMouseEnter={(e) => {
            const el = e.currentTarget as HTMLElement;
            el.style.background = item.danger ? C.redBg : C.bg3;
            el.style.color = item.danger ? C.red : C.t0;
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget as HTMLElement;
            el.style.background = "transparent";
            el.style.color = item.danger ? C.red : C.t1;
          }}
        >
          <span style={{ opacity: 0.55, display: "flex", alignItems: "center", flexShrink: 0 }}>
            {item.icon}
          </span>
          {item.label}
        </button>
      ))}
    </div>
  );
}
