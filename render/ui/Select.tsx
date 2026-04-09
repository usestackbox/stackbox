// ui/Select.tsx
import { BG, C, BORDER, RADIUS } from "../design";

interface Option { value: string; label: string }
interface Props extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "onChange"> {
  options: Option[];
  label?: string;
  onChange?: (value: string) => void;
}

export function Select({ options, label, onChange, style, ...rest }: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {label && <label style={{ fontSize: 12, color: C.t2, fontWeight: 500 }}>{label}</label>}
      <select
        onChange={e => onChange?.(e.target.value)}
        style={{
          background: BG[2], border: `1px solid ${BORDER.base}`,
          borderRadius: RADIUS.sm, color: C.t1, fontSize: 13,
          padding: "6px 28px 6px 10px", appearance: "none",
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23666'/%3E%3C/svg%3E")`,
          backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center",
          cursor: "pointer", ...style,
        }}
        {...rest}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
