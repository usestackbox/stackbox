// render/features/settings/KeybindsTab.tsx
import { C, MONO, SANS } from "../../design";

const BINDS: { category: string; binds: { label: string; keys: string[] }[] }[] = [
  {
    category: "Global",
    binds: [
      { label: "Command palette", keys: ["⌘", "K"] },
      { label: "New runbox", keys: ["⌘", "N"] },
      { label: "Settings", keys: ["⌘", ","] },
      { label: "Toggle sidebar", keys: ["⌘", "B"] },
      { label: "Toggle file tree", keys: ["⌘", "⇧", "E"] },
    ],
  },
  {
    category: "Terminal",
    binds: [
      { label: "New terminal pane", keys: ["⌘", "T"] },
      { label: "Close pane", keys: ["⌘", "W"] },
      { label: "Split down", keys: ["⌘", "D"] },
      { label: "Split left", keys: ["⌘", "⇧", "D"] },
      { label: "Clear terminal", keys: ["⌘", "L"] },
    ],
  },
  {
    category: "Git",
    binds: [
      { label: "Open Git panel", keys: ["⌘", "⇧", "G"] },
      { label: "Open Memory panel", keys: ["⌘", "⇧", "M"] },
    ],
  },
];

function Kbd({ children }: { children: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 22,
        height: 20,
        padding: "0 5px",
        background: "rgba(255,255,255,.07)",
        border: "1px solid rgba(255,255,255,.14)",
        borderBottom: "2px solid rgba(255,255,255,.22)",
        borderRadius: 4,
        fontSize: 11,
        fontFamily: MONO,
        color: C.t2,
      }}
    >
      {children}
    </span>
  );
}

export function KeybindsTab() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {BINDS.map((group) => (
        <div key={group.category}>
          <p
            style={{
              margin: "0 0 10px",
              fontSize: 11,
              color: C.t3,
              textTransform: "uppercase",
              letterSpacing: ".07em",
            }}
          >
            {group.category}
          </p>
          <div
            style={{
              background: C.bg2,
              border: `1px solid ${C.borderSubtle}`,
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            {group.binds.map((bind, i) => (
              <div
                key={bind.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "9px 14px",
                  borderBottom: i < group.binds.length - 1 ? `1px solid ${C.borderSubtle}` : "none",
                }}
              >
                <span style={{ fontSize: 13, color: C.t1, fontFamily: SANS }}>{bind.label}</span>
                <span style={{ display: "flex", gap: 4 }}>
                  {bind.keys.map((k, ki) => (
                    <Kbd key={ki}>{k}</Kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <p style={{ fontSize: 11, color: C.t3, margin: 0 }}>
        Custom keybind editing coming in a future release.
      </p>
    </div>
  );
}
