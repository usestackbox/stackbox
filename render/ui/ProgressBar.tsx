// ui/ProgressBar.tsx
import { BG, BORDER, RADIUS } from "../design";

interface Props {
  value: number; // 0–100
  color?: string;
  height?: number;
  animated?: boolean;
}

export function ProgressBar({ value, color = "#3b82f6", height = 4, animated }: Props) {
  return (
    <div style={{
      width: "100%", height, background: BG[4],
      border: `1px solid ${BORDER.subtle}`, borderRadius: RADIUS.full, overflow: "hidden",
    }}>
      <div style={{
        height: "100%", width: `${Math.min(100, Math.max(0, value))}%`,
        background: color, borderRadius: RADIUS.full,
        transition: animated ? "width .3s ease" : undefined,
      }} />
    </div>
  );
}
