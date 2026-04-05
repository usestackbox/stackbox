// features/diff/StatBar.tsx
import { MONO } from "../../design";

interface Props { ins: number; del: number; }

export function StatBar({ ins, del }: Props) {
  const total = ins + del;
  if (!total) return null;
  const g = Math.round((ins / total) * 5);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
      <span style={{ fontSize: 10, fontFamily: MONO, fontWeight: 600, display: "flex", gap: 4 }}>
        <span style={{ color: "rgba(74,222,128,0.7)" }}>+{ins}</span>
        <span style={{ color: "rgba(248,113,113,0.7)" }}>-{del}</span>
      </span>
      <div style={{ display: "flex", gap: 1.5 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} style={{ width: 8, height: 8, borderRadius: 2, background: i < g ? "rgba(74,222,128,.40)" : "rgba(248,113,113,.35)" }} />
        ))}
      </div>
    </div>
  );
}