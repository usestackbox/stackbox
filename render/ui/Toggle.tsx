// ui/Toggle.tsx
import { SEM } from "../design";

interface Props {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, disabled }: Props) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1 }}>
      <div
        onClick={() => !disabled && onChange(!checked)}
        style={{
          width: 34, height: 18, borderRadius: 9, position: "relative",
          background: checked ? SEM.blue : "rgba(255,255,255,.15)",
          transition: "background .2s", flexShrink: 0,
        }}
      >
        <div style={{
          position: "absolute", top: 2, left: checked ? 16 : 2,
          width: 14, height: 14, borderRadius: "50%",
          background: "#fff", transition: "left .2s",
          boxShadow: "0 1px 3px rgba(0,0,0,.4)",
        }} />
      </div>
      {label && <span style={{ fontSize: 13 }}>{label}</span>}
    </label>
  );
}
