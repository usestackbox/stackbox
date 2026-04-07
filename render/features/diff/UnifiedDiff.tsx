// features/diff/UnifiedDiff.tsx
import { useMemo } from "react";
import { C, MONO } from "../../design";
import { type DiffLine, charDiff, highlightDiffLine } from "./diffUtils";

interface Props {
  lines: DiffLine[];
  lang: string;
}

export function UnifiedDiff({ lines, lang }: Props) {
  const inlineDiffs = useMemo(() => {
    const map = new Map<number, { old: React.ReactNode; new: React.ReactNode }>();
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].kind === "remove" && i + 1 < lines.length && lines[i + 1].kind === "add") {
        const d = charDiff(lines[i].content, lines[i + 1].content);
        map.set(i, d);
        map.set(i + 1, d);
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
            const isAdd = row.kind === "add";
            const isRem = row.kind === "remove";
            const rowBg = isAdd
              ? "rgba(74,222,128,.07)"
              : isRem
                ? "rgba(248,113,113,.07)"
                : row.kind === "hunk"
                  ? "rgba(255,255,255,.015)"
                  : "transparent";
            const gutBg = isAdd
              ? "rgba(74,222,128,.12)"
              : isRem
                ? "rgba(248,113,113,.12)"
                : "rgba(255,255,255,.015)";
            const textColor = isAdd
              ? "rgba(180,230,180,0.85)"
              : isRem
                ? "rgba(230,170,170,0.85)"
                : row.kind === "hunk"
                  ? "rgba(100,130,160,0.6)"
                  : row.kind === "meta"
                    ? "rgba(100,100,100,0.5)"
                    : "rgba(190,190,190,0.65)";

            const inlinePair = inlineDiffs.get(i);
            let content: React.ReactNode;
            if (inlinePair) {
              content = isRem ? inlinePair.old : inlinePair.new;
            } else if (row.kind === "add" || row.kind === "remove" || row.kind === "context") {
              content = (
                <span dangerouslySetInnerHTML={{ __html: highlightDiffLine(row.content, lang) }} />
              );
            } else {
              content = row.content;
            }

            return (
              <tr key={i} style={{ background: rowBg }}>
                <td
                  style={{
                    padding: "0 6px",
                    textAlign: "right",
                    fontSize: 10,
                    fontFamily: MONO,
                    color: "#6f6565",
                    userSelect: "none",
                    background: gutBg,
                    borderRight: `1px solid ${C.border}`,
                    lineHeight: "20px",
                  }}
                >
                  {isMeta ? "" : (row.newNum ?? "")}
                </td>
                <td
                  style={{
                    textAlign: "center",
                    fontFamily: MONO,
                    fontSize: 11,
                    color: isAdd
                      ? "rgba(74,222,128,0.6)"
                      : isRem
                        ? "rgba(248,113,113,0.6)"
                        : "transparent",
                    userSelect: "none",
                    background: gutBg,
                    borderRight: `1px solid ${C.border}`,
                    lineHeight: "20px",
                  }}
                >
                  {isAdd ? "+" : isRem ? "−" : ""}
                </td>
                <td
                  style={{
                    paddingLeft: 10,
                    paddingRight: 8,
                    lineHeight: "20px",
                    verticalAlign: "top",
                  }}
                >
                  <span
                    style={{
                      fontSize: 12.5,
                      color: textColor,
                      fontFamily: MONO,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                      fontStyle: row.kind === "hunk" ? "italic" : "normal",
                    }}
                  >
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
