// ui/Kbd.tsx
import { BG, C, BORDER, RADIUS } from "../design";

interface Props { children: React.ReactNode }

export function Kbd({ children }: Props) {
  return (
    <kbd style={{
      background: BG[4], color: C.t2, border: `1px solid ${BORDER.mid}`,
      borderRadius: RADIUS.xs, padding: "2px 5px",
      fontSize: 11, fontFamily: "inherit", fontWeight: 600,
      boxShadow: "0 1px 0 rgba(255,255,255,.08)",
    }}>{children}</kbd>
  );
}
