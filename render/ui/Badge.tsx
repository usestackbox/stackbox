// ui/Badge.tsx
import { SEM, RADIUS } from "../design";

type Variant = "default" | "green" | "amber" | "red" | "blue";

interface Props {
  count?: number;
  label?: string;
  variant?: Variant;
  max?: number;
}

const COLORS: Record<Variant, { bg: string; color: string; border: string }> = {
  default: { bg: "rgba(255,255,255,.1)", color: "rgba(255,255,255,.7)", border: "transparent" },
  green:   { bg: SEM.greenBg,  color: SEM.green,  border: SEM.greenBorder },
  amber:   { bg: SEM.amberBg,  color: SEM.amber,  border: SEM.amberBorder },
  red:     { bg: SEM.redBg,    color: SEM.red,     border: SEM.redBorder },
  blue:    { bg: SEM.blueBg,   color: SEM.blue,    border: SEM.blueBorder },
};

export function Badge({ count, label, variant = "default", max = 99 }: Props) {
  const text = label ?? (count !== undefined ? (count > max ? `${max}+` : String(count)) : "");
  if (!text) return null;
  const c = COLORS[variant];
  return (
    <span style={{
      background: c.bg, color: c.color, border: `1px solid ${c.border}`,
      borderRadius: RADIUS.full, padding: "1px 6px",
      fontSize: 11, fontWeight: 600, lineHeight: "16px", display: "inline-block",
    }}>{text}</span>
  );
}
