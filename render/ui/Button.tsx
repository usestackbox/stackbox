// ui/Button.tsx
import { BG, C, SEM, RADIUS, BORDER } from "../design";
import { Spinner } from "./Spinner";

type Variant = "primary" | "ghost" | "danger" | "secondary";

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  size?: "sm" | "md";
}

const VARIANTS: Record<Variant, React.CSSProperties> = {
  primary: { background: "#3b82f6", color: "#fff", border: "1px solid #2563eb" },
  secondary: { background: BG[4], color: C.t1, border: `1px solid ${BORDER.base}` },
  ghost: { background: "transparent", color: C.t2, border: "1px solid transparent" },
  danger: { background: SEM.redBg, color: SEM.red, border: `1px solid ${SEM.redBorder}` },
};

export function Button({ variant = "secondary", loading, size = "md", children, disabled, style, ...rest }: Props) {
  const pad = size === "sm" ? "4px 10px" : "7px 14px";
  return (
    <button
      disabled={disabled || loading}
      style={{
        ...VARIANTS[variant],
        padding: pad, borderRadius: RADIUS.sm,
        fontSize: size === "sm" ? 12 : 13, fontWeight: 500,
        cursor: disabled || loading ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        display: "inline-flex", alignItems: "center", gap: 6,
        transition: "opacity .15s",
        ...style,
      }}
      {...rest}
    >
      {loading && <Spinner size={12} />}
      {children}
    </button>
  );
}
