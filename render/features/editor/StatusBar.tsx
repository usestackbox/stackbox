// features/editor/StatusBar.tsx
import { C, MONO } from "../../design";

interface Props {
  lang:    string;
  lines:   number;
  chars:   number;
  isDirty: boolean;
}

export function StatusBar({ lang, lines, chars, isDirty }: Props) {
  return (
    <div style={{
      height: 22, flexShrink: 0,
      display: "flex", alignItems: "center",
      paddingInline: 12, gap: 14,
      background: C.bg1, borderTop: `1px solid ${C.border}`,
    }}>
      {isDirty && (
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#fbbf24", flexShrink: 0 }} />
      )}
      <span style={{ fontSize: 10, fontFamily: MONO, color: C.t3, letterSpacing: ".04em" }}>
        {lang.toUpperCase()}
      </span>
      <span style={{ fontSize: 10, fontFamily: MONO, color: C.t3 }}>
        {lines.toLocaleString()} {lines === 1 ? "line" : "lines"}
      </span>
      <span style={{ fontSize: 10, fontFamily: MONO, color: C.t3 }}>
        {chars.toLocaleString()} chars
      </span>
      {isDirty && (
        <span style={{ fontSize: 10, fontFamily: MONO, color: "#fbbf24", marginLeft: "auto" }}>
          unsaved
        </span>
      )}
    </div>
  );
}