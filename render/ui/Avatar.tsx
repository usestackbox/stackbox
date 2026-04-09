// ui/Avatar.tsx
import { RADIUS } from "../design";

interface Props { name: string; size?: number }

function colorFromName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return `hsl(${Math.abs(h) % 360},55%,42%)`;
}

export function Avatar({ name, size = 28 }: Props) {
  const initials = name.split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: RADIUS.sm,
      background: colorFromName(name),
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.38, fontWeight: 700, color: "#fff",
      userSelect: "none", flexShrink: 0,
    }}>{initials}</div>
  );
}
