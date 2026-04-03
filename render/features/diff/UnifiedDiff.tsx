// features/diff/UnifiedDiff.tsx
import { useMemo } from "react";
import { C, MONO } from "../../design";
import { type DiffLine, charDiff, highlightDiffLine } from "./diffUtils";

interface Props { lines: DiffLine[]; lang: string; }

export function UnifiedDiff({ lines, lang }: Props) {
  const inlineDiffs = useMemo(() => {
    const map = new Map<number, { old: React.ReactNode; new: React.ReactNode }>();
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].kind === "remove" && i + 1 < lines.length && lines[i + 1].kind === "add") {
        const d = charDiff(lines[i].content, lines[i + 1].content);
        map.set(i, d); map.set(i + 1, d);
      }
    }
    return map;
  }, [lines]);

  return (
    <div style={{ flex: 1, overflow: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: 38 }} />
          <col style={{ width: 14 }} />
          <col />
        </colgroup>
        <tbody>
          {lines.map((row, i) => {
            const isMeta = row.kind === "meta" || row.kind === "hunk";
            const isAdd  = row.kind === "add";
            const isRem  = row.kind === "remove";
            const rowBg  = isAdd ? "rgba(40,160,80,.10)" : isRem ? "rgba(200,60,60,.16)" : row.kind === "hunk" ? "rgba(255,255,255,.018)" : "transparent";
            const gutBg  = isAdd ? "rgba(40,160,80,.18)" : isRem ? "rgba(200,60,60,.28)" : "rgba(255,255,255,.018)";
            const textColor = isAdd ? "#b8ddb8" : isRem ? "#ddb8b8" : row.kind === "hunk" ? "#505050" : row.kind === "meta" ? "#3a3a3a" : "#707070";

            const inlinePair = inlineDiffs.get(i);
            let content: React.ReactNode;
            if (inlinePair) {
              content = isRem ? inlinePair.old : inlinePair.new;
            } else if (row.kind === "add" || row.kind === "remove" || row.kind === "context") {
              content = <span dangerouslySetInnerHTML={{ __html: highlightDiffLine(row.content, lang) }} />;
            } else {
              content = row.content;
            }

            return (
              <tr key={i} style={{ background: rowBg }}>
                <td style={{ padding: "0 6px", textAlign: "right", fontSize: 10, fontFamily: MONO, color: "#6f6565", userSelect: "none", background: gutBg, borderRight: `1px solid ${C.border}`, lineHeight: "20px" }}>
                  {isMeta ? "" : (row.newNum ?? "")}
                </td>
                <td style={{ textAlign: "center", fontFamily: MONO, fontSize: 11, color: isAdd ? "#4db864" : isRem ? "#e05555" : "transparent", userSelect: "none", background: gutBg, borderRight: `1px solid ${C.border}`, lineHeight: "20px" }}>
                  {isAdd ? "+" : isRem ? "−" : ""}
                </td>
                <td style={{ paddingLeft: 10, paddingRight: 8, lineHeight: "20px", verticalAlign: "top" }}>
                  <span style={{ fontSize: 12.5, color: textColor, fontFamily: MONO, whiteSpace: "pre-wrap", wordBreak: "break-all", fontStyle: row.kind === "hunk" ? "italic" : "normal" }}>
                    {content}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}