// ui/Skeleton.tsx
import { BG } from "../design";

interface Props { width?: number | string; height?: number; radius?: number; style?: React.CSSProperties }

export function Skeleton({ width = "100%", height = 16, radius = 4, style }: Props) {
  return (
    <>
      <div style={{
        width, height, borderRadius: radius,
        background: `linear-gradient(90deg, ${BG[3]} 25%, ${BG[4]} 50%, ${BG[3]} 75%)`,
        backgroundSize: "200% 100%",
        animation: "sb-shimmer 1.4s ease infinite",
        ...style,
      }} />
      <style>{"@keyframes sb-shimmer { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }"}</style>
    </>
  );
}
