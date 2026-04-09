// ui/Input.tsx
import { BG, C, BORDER, RADIUS, SEM } from "../design";

interface Props extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  iconLeft?: React.ReactNode;
}

export function Input({ label, error, iconLeft, style, ...rest }: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {label && <label style={{ fontSize: 12, color: C.t2, fontWeight: 500 }}>{label}</label>}
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        {iconLeft && (
          <span style={{ position: "absolute", left: 9, color: C.t3, display: "flex" }}>{iconLeft}</span>
        )}
        <input
          style={{
            width: "100%", padding: iconLeft ? "6px 10px 6px 30px" : "6px 10px",
            background: BG[2], border: `1px solid ${error ? SEM.redBorder : BORDER.base}`,
            borderRadius: RADIUS.sm, color: C.t1, fontSize: 13,
            outline: "none", boxSizing: "border-box",
            ...style,
          }}
          {...rest}
        />
      </div>
      {error && <span style={{ fontSize: 11, color: SEM.red }}>{error}</span>}
    </div>
  );
}
