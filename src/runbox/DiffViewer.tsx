import { C, MONO, SANS, reltime } from "../shared/constants";
import type { DiffTab } from "../shared/types";

type DiffLineKind = "add" | "remove" | "hunk" | "meta" | "context";

function classifyDiffLine(l: string): DiffLineKind {
  if (
    l.startsWith("+++") || l.startsWith("---") || l.startsWith("diff ") ||
    l.startsWith("index ") || l.startsWith("new file") || l.startsWith("deleted file")
  ) return "meta";
  if (l.startsWith("@@")) return "hunk";
  if (l.startsWith("+"))  return "add";
  if (l.startsWith("-"))  return "remove";
  return "context";
}

const DIFF_BG: Record<DiffLineKind, string> = {
  add:     "rgba(63,185,80,.07)",
  remove:  "rgba(248,81,73,.07)",
  hunk:    "rgba(88,166,255,.07)",
  meta:    "transparent",
  context: "transparent",
};
const DIFF_FG: Record<DiffLineKind, string> = {
  add: C.green, remove: C.redBright, hunk: C.blue, meta: C.t2, context: C.t1,
};
const DIFF_BORDER: Record<DiffLineKind, string> = {
  add: C.green, remove: C.redBright, hunk: C.blue, meta: "transparent", context: "transparent",
};

function parseDiffLines(diff: string) {
  let oldLine = 0, newLine = 0;
  return diff.split("\n").map(raw => {
    const kind = classifyDiffLine(raw);
    if (kind === "hunk") {
      const m = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) { oldLine = parseInt(m[1]) - 1; newLine = parseInt(m[2]) - 1; }
      return { raw, kind, oldNum: null as number | null, newNum: null as number | null };
    }
    if (kind === "add")     { newLine++; return { raw, kind, oldNum: null,    newNum: newLine }; }
    if (kind === "remove")  { oldLine++; return { raw, kind, oldNum: oldLine, newNum: null    }; }
    if (kind === "context") { oldLine++; newLine++; return { raw, kind, oldNum: oldLine, newNum: newLine }; }
    return { raw, kind, oldNum: null, newNum: null };
  });
}

export function DiffViewer({ tab }: { tab: DiffTab }) {
  const lines    = parseDiffLines(tab.diff);
  const fileName = tab.path.split(/[/\\]/).pop() ?? tab.path;
  const dirPart  = tab.path.slice(0, tab.path.length - fileName.length);
  const cc       = tab.changeType === "created" ? C.green : tab.changeType === "deleted" ? C.redBright : C.amber;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg0, overflow: "hidden" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", borderBottom: `1px solid ${C.border}`, flexShrink: 0, background: C.bg1 }}>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: cc, background: `${cc}18`, border: `1px solid ${cc}33`, borderRadius: 3, padding: "2px 6px", fontFamily: SANS, flexShrink: 0 }}>
          {tab.changeType}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 12, color: C.t2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dirPart}</span>
        <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: C.t0 }}>{fileName}</span>
        <span style={{ flex: 1 }} />
        {tab.insertions > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: C.green,     fontFamily: MONO }}>+{tab.insertions}</span>}
        {tab.deletions  > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: C.redBright, fontFamily: MONO }}>−{tab.deletions}</span>}
        <span style={{ fontSize: 10, color: C.t3, fontFamily: SANS }}>{reltime(tab.openedAt)}</span>
      </div>

      {/* Diff body */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {!tab.diff.trim() ? (
          <div style={{ padding: "48px 0", textAlign: "center", color: C.t2, fontSize: 12, fontFamily: SANS }}>
            {tab.changeType === "deleted" ? "File deleted — no content to show." : "No diff captured."}
          </div>
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: 48 }} />
              <col style={{ width: 48 }} />
              <col />
            </colgroup>
            <tbody>
              {lines.map((row, i) => {
                const isMeta = row.kind === "meta" || row.kind === "hunk";
                return (
                  <tr key={i} style={{ background: DIFF_BG[row.kind] }}>
                    <td style={{ padding: "0 6px", textAlign: "right", fontSize: 10, color: row.kind === "remove" ? "rgba(248,81,73,.4)" : C.t3, userSelect: "none", fontFamily: MONO, verticalAlign: "top", paddingTop: 2 }}>
                      {isMeta ? "" : (row.oldNum ?? "")}
                    </td>
                    <td style={{ padding: "0 6px", textAlign: "right", fontSize: 10, color: row.kind === "add" ? "rgba(63,185,80,.4)" : C.t3, userSelect: "none", fontFamily: MONO, verticalAlign: "top", paddingTop: 2, borderRight: `1px solid ${C.border}` }}>
                      {isMeta ? "" : (row.newNum ?? "")}
                    </td>
                    <td style={{ paddingLeft: 12, paddingRight: 8, borderLeft: `3px solid ${DIFF_BORDER[row.kind]}`, fontSize: 12.5, color: DIFF_FG[row.kind], fontFamily: MONO, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-all", verticalAlign: "top", fontStyle: row.kind === "hunk" ? "italic" : "normal" }}>
                      {row.raw}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}