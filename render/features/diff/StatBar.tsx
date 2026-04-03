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
        <span style={{ color: "#4a9955" }}>+{ins}</span>
        <span style={{ color: "#e05555" }}>-{del}</span>
      </span>
      <div style={{ display: "flex", gap: 1.5 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} style={{ width: 8, height: 8, borderRadius: 2, background: i < g ? "rgba(60,180,90,.60)" : "rgba(200,60,60,.55)" }} />
        ))}
      </div>
    </div>
  );
}