// sidebar/IconPicker.tsx
import { useEffect, useRef, useState } from "react";
import { C, FS, MONO, SANS } from "../design";

const ICON_GROUPS = [
  {
    label: "Dev",
    icons: ["⚡", "🔥", "🚀", "💻", "🖥️", "⌨️", "🖱️", "🔧", "🔨", "⚙️", "🛠️", "🔩", "💡", "🔌", "📡"],
  },
  {
    label: "Files",
    icons: ["📁", "📂", "🗂️", "📄", "📝", "📋", "📊", "📈", "📉", "🗃️", "🗄️", "💾", "💿", "📦", "🗑️"],
  },
  {
    label: "Nature",
    icons: ["🌿", "🌱", "🌲", "🌳", "🍀", "🌻", "🌸", "🌊", "⛰️", "🌙", "⭐", "☀️", "❄️", "🌈", "🔮"],
  },
  {
    label: "Objects",
    icons: ["🎯", "🎲", "🧩", "🔑", "🔐", "🏆", "🎖️", "🧲", "💎", "⚗️", "🧪", "🔬", "🎸", "🎨", "✏️"],
  },
  {
    label: "Symbols",
    icons: [
      "✅",
      "❌",
      "⚠️",
      "💬",
      "💭",
      "❓",
      "❗",
      "🔴",
      "🟠",
      "🟡",
      "🟢",
      "🔵",
      "🟣",
      "⚫",
      "⚪",
    ],
  },
] as const;

interface Props {
  anchorX: number;
  anchorY: number;
  onSelect: (icon: string) => void;
  onClose: () => void;
}

export function IconPicker({ anchorX, anchorY, onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [activeGroup, setActiveGroup] = useState(0);

  useEffect(() => {
    setTimeout(() => searchRef.current?.focus(), 30);
  }, []);

  useEffect(() => {
    const onOut = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onOut);
    return () => document.removeEventListener("mousedown", onOut);
  }, [onClose]);

  const filtered = search.trim()
    ? ICON_GROUPS.flatMap((g) => g.icons).filter((ic) => ic.includes(search))
    : ICON_GROUPS[activeGroup].icons;

  const W = 260;
  const H = 320;
  const left = Math.min(anchorX, window.innerWidth - W - 8);
  const top = Math.min(anchorY, window.innerHeight - H - 8);

  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        left,
        top,
        width: W,
        height: H,
        background: C.bg2,
        border: `1px solid ${C.borderMd}`,
        borderRadius: C.r4,
        boxShadow: C.shadowXl,
        display: "flex",
        flexDirection: "column",
        zIndex: 99999,
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "10px 10px 6px", flexShrink: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: C.bg0,
            border: `1px solid ${C.border}`,
            borderRadius: C.r2,
            padding: "5px 10px",
          }}
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke={C.t3}
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search icons…"
            style={{
              background: "none",
              border: "none",
              outline: "none",
              color: C.t0,
              fontSize: FS.md,
              fontFamily: SANS,
              flex: 1,
            }}
          />
        </div>
      </div>

      {!search && (
        <div
          style={{
            display: "flex",
            gap: 2,
            padding: "0 10px 6px",
            flexShrink: 0,
            overflowX: "auto",
          }}
        >
          {ICON_GROUPS.map((g, i) => (
            <button
              key={g.label}
              onClick={() => setActiveGroup(i)}
              style={{
                border: "none",
                cursor: "pointer",
                borderRadius: C.r2,
                padding: "3px 9px",
                fontSize: FS.xxs,
                fontFamily: MONO,
                fontWeight: 700,
                letterSpacing: ".08em",
                whiteSpace: "nowrap",
                background: activeGroup === i ? C.bg4 : "transparent",
                color: activeGroup === i ? C.t0 : C.t3,
                transition: "all .12s",
              }}
            >
              {g.label}
            </button>
          ))}
        </div>
      )}

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "4px 10px 10px",
          display: "grid",
          gridTemplateColumns: "repeat(6, 1fr)",
          gap: 4,
          alignContent: "start",
        }}
      >
        {filtered.map((icon, i) => (
          <button
            key={i}
            onClick={() => {
              onSelect(icon);
              onClose();
            }}
            style={{
              border: "none",
              cursor: "pointer",
              borderRadius: C.r2,
              fontSize: 20,
              lineHeight: 1,
              padding: "6px 0",
              background: "transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background .1s, transform .1s",
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLElement;
              el.style.background = C.bg3;
              el.style.transform = "scale(1.15)";
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLElement;
              el.style.background = "transparent";
              el.style.transform = "scale(1)";
            }}
          >
            {icon}
          </button>
        ))}
        {filtered.length === 0 && (
          <div
            style={{
              gridColumn: "1/-1",
              padding: "20px 0",
              textAlign: "center",
              color: C.t3,
              fontSize: FS.sm,
              fontFamily: SANS,
            }}
          >
            No icons found
          </div>
        )}
      </div>
    </div>
  );
}
