import { useMemo } from "react";
import hljs from "highlight.js/lib/core";
import { C, MONO, SANS } from "../shared/constants";
import type { DiffTab } from "../shared/types";

// Languages are registered on the hljs singleton by FileViewerPane at module load.

// ── VS Code Dark+ theme ───────────────────────────────────────────────────────
const HLJS_THEME = `
.hljs                    { color: #d4d4d4; }
.hljs-keyword            { color: #569cd6; }
.hljs-built_in           { color: #4ec9b0; }
.hljs-type               { color: #4ec9b0; }
.hljs-string             { color: #ce9178; }
.hljs-number             { color: #b5cea8; }
.hljs-literal            { color: #569cd6; }
.hljs-comment            { color: #6a9955; font-style: italic; }
.hljs-title.function_    { color: #dcdcaa; }
.hljs-title              { color: #dcdcaa; }
.hljs-title.class_       { color: #4ec9b0; }
.hljs-meta               { color: #9cdcfe; }
.hljs-property           { color: #9cdcfe; }
.hljs-attr               { color: #9cdcfe; }
.hljs-attribute          { color: #ce9178; }
.hljs-variable           { color: #9cdcfe; }
.hljs-variable.language_ { color: #569cd6; }
.hljs-regexp             { color: #d16969; }
.hljs-operator           { color: #d4d4d4; }
.hljs-punctuation        { color: #d4d4d4; }
.hljs-section            { color: #569cd6; font-weight: bold; }
.hljs-bullet             { color: #6796e6; }
.hljs-params             { color: #d4d4d4; }
.hljs-tag                { color: #569cd6; }
.hljs-selector-tag       { color: #d7ba7d; }
.hljs-symbol             { color: #569cd6; }
.hljs-link               { color: #ce9178; text-decoration: underline; }
.hljs-code               { color: #ce9178; }
.hljs-doctag             { color: #608b4e; }
.hljs-formula            { color: #9cdcfe; }
.hljs-quote              { color: #6a9955; font-style: italic; }
.hljs-subst              { color: #d4d4d4; }
.hljs-template-tag       { color: #569cd6; }
.hljs-template-variable  { color: #9cdcfe; }
`;

function getLanguage(path: string): string {
  const ext  = path.split(".").pop()?.toLowerCase() ?? "";
  const name = path.split(/[/\\]/).pop()?.toLowerCase() ?? "";
  if (name === "dockerfile") return "dockerfile";
  if (name === "makefile")   return "makefile";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    mjs: "javascript", cjs: "javascript",
    css: "css", scss: "css", less: "css",
    html: "html", htm: "html", xml: "xml", svg: "xml",
    json: "json", jsonc: "json",
    yaml: "yaml", yml: "yaml",
    toml: "toml", ini: "toml", env: "bash",
    rs: "rust", go: "go",
    c: "c", h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp",
    cs: "csharp",
    java: "java", kt: "kotlin", scala: "scala",
    py: "python", pyw: "python",
    rb: "ruby", php: "php", lua: "lua", pl: "perl",
    r: "r", swift: "swift", dart: "dart",
    sh: "bash", bash: "bash", zsh: "bash", ps1: "powershell",
    md: "markdown", mdx: "markdown",
    sql: "sql", proto: "protobuf", graphql: "graphql", gql: "graphql",
    hs: "haskell", ex: "elixir", exs: "elixir",
    diff: "diff", patch: "diff",
  };
  return map[ext] ?? "text";
}

function highlightLine(content: string, lang: string): string {
  const escaped = content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  if (!content.trim() || lang === "text") return escaped;
  try {
    if (hljs.getLanguage(lang)) {
      return hljs.highlight(content, { language: lang, ignoreIllegals: true }).value;
    }
  } catch { /* fall through */ }
  return escaped;
}

type Kind = "add" | "remove" | "hunk" | "meta" | "context";
interface Line { raw: string; kind: Kind; content: string; oldNum: number | null; newNum: number | null; }

function classify(l: string): Kind {
  if (l.startsWith("+++") || l.startsWith("---") || l.startsWith("diff ") || l.startsWith("index ") || l.startsWith("new file") || l.startsWith("deleted file")) return "meta";
  if (l.startsWith("@@")) return "hunk";
  if (l.startsWith("+")) return "add";
  if (l.startsWith("-")) return "remove";
  return "context";
}

function parse(diff: string): Line[] {
  let old = 0, neu = 0;
  return diff.split("\n").map(raw => {
    const kind    = classify(raw);
    const content = (kind === "add" || kind === "remove") ? raw.slice(1) : raw;
    if (kind === "hunk") {
      const m = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) { old = parseInt(m[1]) - 1; neu = parseInt(m[2]) - 1; }
      return { raw, kind, content: raw, oldNum: null, newNum: null };
    }
    if (kind === "add")     { neu++; return { raw, kind, content, oldNum: null, newNum: neu }; }
    if (kind === "remove")  { old++; return { raw, kind, content, oldNum: old,  newNum: null }; }
    if (kind === "context") { old++; neu++; return { raw, kind, content, oldNum: old, newNum: neu }; }
    return { raw, kind, content, oldNum: null, newNum: null };
  });
}

// ── Character-level inline diff ──────────────────────────────────────────────
function charDiff(oldStr: string, newStr: string): { old: React.ReactNode; new: React.ReactNode } {
  let start = 0;
  while (start < oldStr.length && start < newStr.length && oldStr[start] === newStr[start]) start++;
  let oldEnd = oldStr.length - 1;
  let newEnd = newStr.length - 1;
  while (oldEnd > start && newEnd > start && oldStr[oldEnd] === newStr[newEnd]) { oldEnd--; newEnd--; }

  const oldChanged = oldStr.slice(start, oldEnd + 1);
  const newChanged = newStr.slice(start, newEnd + 1);

  return {
    old: (
      <span>
        <span style={{ color: "#c0b0b0" }}>{oldStr.slice(0, start)}</span>
        {oldChanged && <span style={{ background: "rgba(200,60,60,.40)", color: "#e09090", borderRadius: 2, padding: "0 1px" }}>{oldChanged}</span>}
        <span style={{ color: "#c0b0b0" }}>{oldStr.slice(oldEnd + 1)}</span>
      </span>
    ),
    new: (
      <span>
        <span style={{ color: "#c8c8c8" }}>{newStr.slice(0, start)}</span>
        {newChanged && <span style={{ background: "rgba(40,140,70,.28)", color: "#aaddaa", borderRadius: 2, padding: "0 1px" }}>{newChanged}</span>}
        <span style={{ color: "#c8c8c8" }}>{newStr.slice(newEnd + 1)}</span>
      </span>
    ),
  };
}

function extColor(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["ts","tsx"].includes(ext)) return "#4a7ab5";
  if (["js","jsx"].includes(ext)) return "#a09040";
  if (["rs"].includes(ext))       return "#b04040";
  if (["css","scss"].includes(ext)) return "#4060a0";
  if (["json"].includes(ext))     return "#808040";
  if (["md"].includes(ext))       return "#5080a0";
  if (["go"].includes(ext))       return "#3a8080";
  return C.t2;
}

function StatBar({ ins, del }: { ins: number; del: number }) {
  const total = ins + del; if (!total) return null;
  const g = Math.round((ins / total) * 5);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
      <span style={{ fontSize: 10, fontFamily: MONO, fontWeight: 600, display: "flex", gap: 4 }}>
        <span style={{ color: "#4a9955" }}>+{ins}</span>
        <span style={{ color: "#e05555" }}>-{del}</span>
      </span>
      <div style={{ display: "flex", gap: 1.5 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} style={{
            width: 8, height: 8, borderRadius: 2,
            background: i < g ? "rgba(60,180,90,.60)" : "rgba(200,60,60,.55)",
          }} />
        ))}
      </div>
    </div>
  );
}

// ── Unified diff view ────────────────────────────────────────────────────────
function Unified({ lines, lang }: { lines: Line[]; lang: string }) {
  const inlineDiffs = useMemo(() => {
    const map = new Map<number, { old: React.ReactNode; new: React.ReactNode }>();
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].kind === "remove" && i + 1 < lines.length && lines[i + 1].kind === "add") {
        const d = charDiff(lines[i].content, lines[i + 1].content);
        map.set(i,     d);
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
            const isAdd  = row.kind === "add";
            const isRem  = row.kind === "remove";

            // FIX: deletion row bg was rgba(180,60,60,.09) — near-invisible on #0d0d0d
            // Increased to .18 so the reddish tint is actually perceptible
            const rowBg = isAdd
              ? "rgba(40,160,80,.10)"
              : isRem
              ? "rgba(200,60,60,.16)"
              : row.kind === "hunk" ? "rgba(255,255,255,.018)"
              : "transparent";

            // FIX: deletion gutter bg was .14 — bumped to .26 for clear visual band
            const gutterBg = isAdd
              ? "rgba(40,160,80,.18)"
              : isRem ? "rgba(200,60,60,.28)"
              : "rgba(255,255,255,.018)";

            // FIX: deletion text was #9a9a9a — still readable but warm it up slightly
            const textColor = isAdd ? "#b8ddb8"
              : isRem ? "#ddb8b8"
              : row.kind === "hunk" ? "#505050"
              : row.kind === "meta" ? "#3a3a3a"
              : "#707070";

            const inlinePair = inlineDiffs.get(i);
            // charDiff pairs get character-level highlighting (React nodes).
            // Everything else gets hljs syntax highlighting.
            let content: React.ReactNode;
            if (inlinePair) {
              content = isRem ? inlinePair.old : inlinePair.new;
            } else if (row.kind === "add" || row.kind === "remove" || row.kind === "context") {
              content = (
                <span dangerouslySetInnerHTML={{ __html: highlightLine(row.content, lang) }} />
              );
            } else {
              content = row.content;
            }

            return (
              <tr key={i} style={{ background: rowBg }}>
                <td style={{ padding: "0 6px", textAlign: "right", fontSize: 10, fontFamily: MONO, color: "#6f6565", userSelect: "none", background: gutterBg, borderRight: `1px solid ${C.border}`, lineHeight: "20px" }}>
                  {isMeta ? "" : (row.newNum ?? "")}
                </td>
                {/* FIX: deletion gutter '−' was #883333 — very dark red, barely visible */}
                <td style={{ textAlign: "center", fontFamily: MONO, fontSize: 11, color: isAdd ? "#4db864" : isRem ? "#e05555" : "transparent", userSelect: "none", background: gutterBg, borderRight: `1px solid ${C.border}`, lineHeight: "20px" }}>
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

// ── DiffViewer ────────────────────────────────────────────────────────────────
export function DiffViewer({
  tab, allTabs, onClose, onSelectTab,
}: {
  tab: DiffTab;
  allTabs?: DiffTab[];
  onClose: () => void;
  onSelectTab?: (id: string) => void;
}) {
  const lines    = parse(tab.diff);
  const lang     = getLanguage(tab.path);
  const tabs     = allTabs ?? [tab];
  const tabIdx   = tabs.findIndex(t => t.id === tab.id);
  const hasPrev  = tabIdx > 0;
  const hasNext  = tabIdx < tabs.length - 1;
  const fileName = tab.path.split(/[/\\]/).pop() ?? tab.path;
  const dirPart  = tab.path.slice(0, tab.path.length - fileName.length);
  const ec       = extColor(tab.path);

  const badgeColor = tab.changeType === "deleted" ? "#cc5555"
                   : tab.changeType === "created" ? "#4a9955"
                   : "#666666";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg0 }}>
      <style>{HLJS_THEME}</style>

      {/* ── Top bar ── */}
      <div style={{
        display: "flex", alignItems: "center", height: 38, flexShrink: 0,
        borderBottom: `1px solid ${C.border}`,
        background: C.bg1, paddingLeft: 0, gap: 0,
      }}>

        {/* ← Files – back button */}
        <button
          onClick={onClose}
          title="Back to file list"
          style={{
            height: "100%", padding: "0 12px",
            background: "none", border: "none",
            borderRight: `1px solid ${C.border}`,
            color: C.t2, cursor: "pointer",
            fontSize: 11, fontWeight: 600, letterSpacing: ".04em",
            display: "flex", alignItems: "center", gap: 5,
            transition: "color .1s, background .1s",
            fontFamily: SANS,
            flexShrink: 0,
          }}
          onMouseEnter={e => {
            const el = e.currentTarget as HTMLElement;
            el.style.color = C.t0;
            el.style.background = "rgba(255,255,255,.04)";
          }}
          onMouseLeave={e => {
            const el = e.currentTarget as HTMLElement;
            el.style.color = C.t2;
            el.style.background = "none";
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Files
        </button>

        {/* File language color strip */}
        <div style={{ width: 3, height: 14, borderRadius: 2, background: ec, flexShrink: 0, marginLeft: 12 }} />

        {/* File path */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, flex: 1, minWidth: 0, padding: "0 10px" }}>
          {dirPart && (
            <span style={{ fontSize: 11, fontFamily: MONO, color: C.t3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>
              {dirPart}
            </span>
          )}
          <span style={{ fontSize: 12, fontFamily: MONO, fontWeight: 600, color: C.t0, whiteSpace: "nowrap" }}>
            {fileName}
          </span>
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase",
            color: badgeColor, background: "rgba(255,255,255,.04)",
            border: `1px solid rgba(255,255,255,.09)`,
            borderRadius: 3, padding: "1px 6px", fontFamily: SANS, flexShrink: 0, marginLeft: 2,
          }}>{tab.changeType}</span>
        </div>

        <StatBar ins={tab.insertions} del={tab.deletions} />

        {/* ‹ › file navigation */}
        {tabs.length > 1 && (
          <div style={{ display: "flex", alignItems: "center", height: "100%", borderLeft: `1px solid ${C.border}`, marginLeft: 8 }}>
            <button
              onClick={() => hasPrev && onSelectTab?.(tabs[tabIdx - 1].id)}
              disabled={!hasPrev}
              title="Previous file"
              style={{ height: "100%", padding: "0 10px", background: "none", border: "none", color: hasPrev ? C.t1 : C.t3, cursor: hasPrev ? "pointer" : "default", fontSize: 14 }}
            >‹</button>
            <span style={{ fontSize: 10, fontFamily: MONO, color: C.t2, minWidth: 32, textAlign: "center" }}>
              {tabIdx + 1}/{tabs.length}
            </span>
            <button
              onClick={() => hasNext && onSelectTab?.(tabs[tabIdx + 1].id)}
              disabled={!hasNext}
              title="Next file"
              style={{ height: "100%", padding: "0 10px", background: "none", border: "none", color: hasNext ? C.t1 : C.t3, cursor: hasNext ? "pointer" : "default", fontSize: 14 }}
            >›</button>
          </div>
        )}
      </div>

      {/* ── File path sub-bar ── */}
      <div style={{
        display: "flex", alignItems: "center", height: 28, padding: "0 14px",
        flexShrink: 0, borderBottom: `1px solid ${C.border}`,
        background: "rgba(255,255,255,.012)",
      }}>
        <span style={{ fontFamily: MONO, fontSize: 11, color: C.t2, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {tab.path}
        </span>
        {(tab.insertions > 0 || tab.deletions > 0) && (
          <span style={{ display: "flex", gap: 6, flexShrink: 0, fontSize: 10, fontFamily: MONO }}>
            {tab.insertions > 0 && <span style={{ color: "#4a9955" }}>+{tab.insertions}</span>}
            {/* FIX: was #663333 — too dark on #0d0d0d background */}
            {tab.deletions  > 0 && <span style={{ color: "#e05555" }}>-{tab.deletions}</span>}
          </span>
        )}
      </div>

      {/* ── Empty state ── */}
      {!tab.diff.trim() && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
            <polyline points="13 2 13 9 20 9"/>
          </svg>
          <span style={{ fontSize: 12, color: C.t2, fontFamily: SANS }}>
            {tab.changeType === "deleted" ? "File deleted." : "No diff available."}
          </span>
        </div>
      )}

      {/* ── Unified diff ── */}
      {tab.diff.trim() && (
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          <Unified lines={lines} lang={lang} />
        </div>
      )}
    </div>
  );
}