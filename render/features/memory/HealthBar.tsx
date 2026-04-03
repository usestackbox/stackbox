// features/memory/HealthBar.tsx
import { C, MONO } from "../../design";
import { effectiveLevel } from "./memoryTypes";
import type { Memory } from "./memoryTypes";

interface Props { memories: Memory[] }

export function HealthBar({ memories }: Props) {
  const locked    = memories.filter(m => effectiveLevel(m) === "LOCKED"    && !m.resolved);
  const preferred = memories.filter(m => effectiveLevel(m) === "PREFERRED" && !m.resolved);
  const sessions  = memories.filter(m => effectiveLevel(m) === "SESSION"   && !m.resolved);
  if (locked.length === 0 && preferred.length === 0) return null;

  const stats = [
    { v: locked.length,    label: "locked rules",   color: C.amber },
    { v: preferred.length, label: "preferred facts", color: C.blue  },
    { v: sessions.length,  label: "sessions",        color: C.teal  },
  ].filter(s => s.v > 0);

  return (
    <div style={{ margin: "6px 10px 0", padding: "9px 12px", background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 10, flexShrink: 0 }}>
      <div style={{ fontSize: 9, fontFamily: MONO, letterSpacing: ".10em", color: C.t3, marginBottom: 7 }}>MEMORY HEALTH</div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        {stats.map(({ v, label, color }) => (
          <div key={label} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: 17, fontFamily: MONO, fontWeight: 700, color, letterSpacing: "-.02em" }}>{v}</span>
            <span style={{ fontSize: 9, color: C.t2, fontFamily: MONO }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}