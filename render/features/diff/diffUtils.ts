// features/diff/diffUtils.ts
import hljs from "highlight.js/lib/core";

// VS Code Dark+ theme string
export const HLJS_DIFF_THEME = `
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
.hljs-variable           { color: #9cdcfe; }
.hljs-regexp             { color: #d16969; }
.hljs-operator           { color: #d4d4d4; }
.hljs-tag                { color: #569cd6; }
.hljs-selector-tag       { color: #d7ba7d; }
`;

export type Kind = "add" | "remove" | "hunk" | "meta" | "context";

export interface DiffLine {
  raw:     string;
  kind:    Kind;
  content: string;
  oldNum:  number | null;
  newNum:  number | null;
}

function classify(l: string): Kind {
  if (l.startsWith("+++") || l.startsWith("---") || l.startsWith("diff ") || l.startsWith("index ") || l.startsWith("new file") || l.startsWith("deleted file")) return "meta";
  if (l.startsWith("@@")) return "hunk";
  if (l.startsWith("+"))  return "add";
  if (l.startsWith("-"))  return "remove";
  return "context";
}

export function parseDiff(diff: string): DiffLine[] {
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

export function getDiffLanguage(path: string): string {
  const ext  = path.split(".").pop()?.toLowerCase() ?? "";
  const name = path.split(/[/\\]/).pop()?.toLowerCase() ?? "";
  if (name === "dockerfile") return "dockerfile";
  if (name === "makefile")   return "makefile";
  const map: Record<string, string> = {
    ts:"typescript", tsx:"typescript", js:"javascript", jsx:"javascript",
    css:"css", scss:"css", html:"html", json:"json", yaml:"yaml", yml:"yaml",
    rs:"rust", go:"go", py:"python", sh:"bash", md:"markdown",
    c:"c", cpp:"cpp", cs:"csharp", java:"java", kt:"kotlin", rb:"ruby",
  };
  return map[ext] ?? "text";
}

export function highlightDiffLine(content: string, lang: string): string {
  const escaped = content.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  if (!content.trim() || lang === "text") return escaped;
  try {
    if (hljs.getLanguage(lang))
      return hljs.highlight(content, { language: lang, ignoreIllegals: true }).value;
  } catch { /* fall through */ }
  return escaped;
}

export function charDiff(oldStr: string, newStr: string): { old: React.ReactNode; new: React.ReactNode } {
  let start = 0;
  while (start < oldStr.length && start < newStr.length && oldStr[start] === newStr[start]) start++;
  let oe = oldStr.length - 1, ne = newStr.length - 1;
  while (oe > start && ne > start && oldStr[oe] === newStr[ne]) { oe--; ne--; }

  return {
    old: (
      <span>
        <span style={{ color: "#c0b0b0" }}>{oldStr.slice(0, start)}</span>
        {oldStr.slice(start, oe + 1) && <span style={{ background: "rgba(200,60,60,.40)", color: "#e09090", borderRadius: 2, padding: "0 1px" }}>{oldStr.slice(start, oe + 1)}</span>}
        <span style={{ color: "#c0b0b0" }}>{oldStr.slice(oe + 1)}</span>
      </span>
    ),
    new: (
      <span>
        <span style={{ color: "#c8c8c8" }}>{newStr.slice(0, start)}</span>
        {newStr.slice(start, ne + 1) && <span style={{ background: "rgba(40,140,70,.28)", color: "#aaddaa", borderRadius: 2, padding: "0 1px" }}>{newStr.slice(start, ne + 1)}</span>}
        <span style={{ color: "#c8c8c8" }}>{newStr.slice(ne + 1)}</span>
      </span>
    ),
  };
}

export function extColor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["ts","tsx"].includes(ext)) return "#4a7ab5";
  if (["js","jsx"].includes(ext)) return "#a09040";
  if (["rs"].includes(ext))       return "#b04040";
  if (["css","scss"].includes(ext)) return "#4060a0";
  if (["json"].includes(ext))     return "#808040";
  if (["md"].includes(ext))       return "#5080a0";
  if (["go"].includes(ext))       return "#3a8080";
  return "rgba(255,255,255,.40)";
}