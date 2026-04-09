// ui/Divider.tsx
import { BORDER, C } from "../design";

interface Props { label?: string; vertical?: boolean; margin?: number }

export function Divider({ label, vertical, margin = 8 }: Props) {
  if (vertical) {
    return <div style={{ width: 1, alignSelf: "stretch", background: BORDER.base, margin: `0 ${margin}px` }} />;
  }
  if (label) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: `${margin}px 0` }}>
        <div style={{ flex: 1, height: 1, background: BORDER.base }} />
        <span style={{ fontSize: 11, color: C.t3, whiteSpace: "nowrap" }}>{label}</span>
        <div style={{ flex: 1, height: 1, background: BORDER.base }} />
      </div>
    );
  }
  return <div style={{ height: 1, background: BORDER.base, margin: `${margin}px 0` }} />;
}
