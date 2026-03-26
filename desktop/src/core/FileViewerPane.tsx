import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import hljs from "highlight.js/lib/core";

// ── Languages (all commonly used ones) ───────────────────────────────────────
import typescript   from "highlight.js/lib/languages/typescript";
import javascript   from "highlight.js/lib/languages/javascript";
import rust         from "highlight.js/lib/languages/rust";
import python       from "highlight.js/lib/languages/python";
import json         from "highlight.js/lib/languages/json";
import markdown     from "highlight.js/lib/languages/markdown";
import css          from "highlight.js/lib/languages/css";
import xml          from "highlight.js/lib/languages/xml";      // html / jsx
import ini          from "highlight.js/lib/languages/ini";      // toml ≈ ini
import yaml         from "highlight.js/lib/languages/yaml";
import bash         from "highlight.js/lib/languages/bash";
import go           from "highlight.js/lib/languages/go";
import java         from "highlight.js/lib/languages/java";
import cpp          from "highlight.js/lib/languages/cpp";
import csharp       from "highlight.js/lib/languages/csharp";
import php          from "highlight.js/lib/languages/php";
import ruby         from "highlight.js/lib/languages/ruby";
import swift        from "highlight.js/lib/languages/swift";
import kotlin       from "highlight.js/lib/languages/kotlin";
import scala        from "highlight.js/lib/languages/scala";
import sql          from "highlight.js/lib/languages/sql";
import dockerfile   from "highlight.js/lib/languages/dockerfile";
import graphql      from "highlight.js/lib/languages/graphql";
import lua          from "highlight.js/lib/languages/lua";
import r            from "highlight.js/lib/languages/r";
import perl         from "highlight.js/lib/languages/perl";
import haskell      from "highlight.js/lib/languages/haskell";
import elixir       from "highlight.js/lib/languages/elixir";
import dart         from "highlight.js/lib/languages/dart";
import powershell   from "highlight.js/lib/languages/powershell";
import makefile     from "highlight.js/lib/languages/makefile";
import nginx        from "highlight.js/lib/languages/nginx";
import diff         from "highlight.js/lib/languages/diff";
import protobuf     from "highlight.js/lib/languages/protobuf";

hljs.registerLanguage("typescript",  typescript);
hljs.registerLanguage("javascript",  javascript);
hljs.registerLanguage("rust",        rust);
hljs.registerLanguage("python",      python);
hljs.registerLanguage("json",        json);
hljs.registerLanguage("markdown",    markdown);
hljs.registerLanguage("css",         css);
hljs.registerLanguage("html",        xml);
hljs.registerLanguage("xml",         xml);
hljs.registerLanguage("toml",        ini);
hljs.registerLanguage("yaml",        yaml);
hljs.registerLanguage("bash",        bash);
hljs.registerLanguage("go",          go);
hljs.registerLanguage("java",        java);
hljs.registerLanguage("cpp",         cpp);
hljs.registerLanguage("c",           cpp);
hljs.registerLanguage("csharp",      csharp);
hljs.registerLanguage("php",         php);
hljs.registerLanguage("ruby",        ruby);
hljs.registerLanguage("swift",       swift);
hljs.registerLanguage("kotlin",      kotlin);
hljs.registerLanguage("scala",       scala);
hljs.registerLanguage("sql",         sql);
hljs.registerLanguage("dockerfile",  dockerfile);
hljs.registerLanguage("graphql",     graphql);
hljs.registerLanguage("lua",         lua);
hljs.registerLanguage("r",           r);
hljs.registerLanguage("perl",        perl);
hljs.registerLanguage("haskell",     haskell);
hljs.registerLanguage("elixir",      elixir);
hljs.registerLanguage("dart",        dart);
hljs.registerLanguage("powershell",  powershell);
hljs.registerLanguage("makefile",    makefile);
hljs.registerLanguage("nginx",       nginx);
hljs.registerLanguage("diff",        diff);
hljs.registerLanguage("protobuf",    protobuf);

const MONO = "Menlo, Monaco, 'Courier New', monospace";

// ── VS Code Dark+ colour theme ────────────────────────────────────────────────
const THEME = `
.hljs                   { color: #d4d4d4; }
.hljs-keyword           { color: #569cd6; }
.hljs-built_in          { color: #4ec9b0; }
.hljs-type              { color: #4ec9b0; }
.hljs-class             { color: #4ec9b0; }
.hljs-string            { color: #ce9178; }
.hljs-number            { color: #b5cea8; }
.hljs-literal           { color: #569cd6; }
.hljs-comment           { color: #6a9955; font-style: italic; }
.hljs-title.function_   { color: #dcdcaa; }
.hljs-title             { color: #dcdcaa; }
.hljs-title.class_      { color: #4ec9b0; }
.hljs-meta              { color: #9cdcfe; }
.hljs-property          { color: #9cdcfe; }
.hljs-name              { color: #4ec9b0; }
.hljs-attr              { color: #9cdcfe; }
.hljs-attribute         { color: #ce9178; }
.hljs-variable          { color: #9cdcfe; }
.hljs-variable.language_{ color: #569cd6; }
.hljs-regexp            { color: #d16969; }
.hljs-operator          { color: #d4d4d4; }
.hljs-punctuation       { color: #d4d4d4; }
.hljs-section           { color: #569cd6; font-weight: bold; }
.hljs-emphasis          { font-style: italic; }
.hljs-strong            { font-weight: bold; }
.hljs-bullet            { color: #6796e6; }
.hljs-addition          { color: #b5cea8; background: rgba(181,206,168,.1); }
.hljs-deletion          { color: #ce9178; background: rgba(206,145,120,.1); }
.hljs-params            { color: #d4d4d4; }
.hljs-tag               { color: #569cd6; }
.hljs-selector-tag      { color: #d7ba7d; }
.hljs-selector-id       { color: #d7ba7d; }
.hljs-selector-class    { color: #d7ba7d; }
.hljs-symbol            { color: #569cd6; }
.hljs-link              { color: #ce9178; text-decoration: underline; }
.hljs-code              { color: #ce9178; }
.hljs-doctag            { color: #608b4e; }
.hljs-formula           { color: #9cdcfe; }
.hljs-quote             { color: #6a9955; font-style: italic; }
.hljs-subst             { color: #d4d4d4; }
.hljs-template-tag      { color: #569cd6; }
.hljs-template-variable { color: #9cdcfe; }
`;

// ── Extension → language map ──────────────────────────────────────────────────
function getLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    // Web
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    mjs: "javascript", cjs: "javascript",
    css: "css", scss: "css", less: "css", sass: "css",
    html: "html", htm: "html", xml: "xml", svg: "xml",
    // Data / config
    json: "json", jsonc: "json", json5: "json",
    yaml: "yaml", yml: "yaml",
    toml: "toml", ini: "toml", cfg: "toml", env: "bash",
    // Systems
    rs: "rust", go: "go",
    c: "c", h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp",
    cs: "csharp",
    // JVM
    java: "java", kt: "kotlin", kts: "kotlin", scala: "scala", groovy: "java",
    // Scripting
    py: "python", pyw: "python", pyi: "python",
    rb: "ruby", rake: "ruby",
    php: "php", phtml: "php",
    lua: "lua", pl: "perl", pm: "perl",
    r: "r",
    // Mobile / cross-platform
    swift: "swift", dart: "dart",
    // Shell
    sh: "bash", bash: "bash", zsh: "bash", fish: "bash", ps1: "powershell",
    // Docs
    md: "markdown", mdx: "markdown", rst: "markdown",
    // DB
    sql: "sql",
    // Infra
    dockerfile: "dockerfile",
    // Functional
    hs: "haskell", ex: "elixir", exs: "elixir",
    // Network / proto
    proto: "protobuf", graphql: "graphql", gql: "graphql",
    // Build
    makefile: "makefile", mk: "makefile",
    // Config
    nginx: "nginx",
    // Diff
    diff: "diff", patch: "diff",
  };
  // Special case: filename is exactly "Dockerfile"
  if (path.split(/[/\\]/).pop()?.toLowerCase() === "dockerfile") return "dockerfile";
  if (path.split(/[/\\]/).pop()?.toLowerCase() === "makefile")   return "makefile";
  return map[ext] ?? "text";
}

const DIRS = ["r", "l", "b", "t", "br", "bl", "tr", "tl"] as const;

interface FileViewerPaneProps {
  id:            string;
  path:          string;
  x:             number;
  y:             number;
  w:             number;
  h:             number;
  zIndex:        number;
  isActive:      boolean;
  onActivate:    () => void;
  onClose:       () => void;
  onSplitDown?:  () => void;
  onDragStart:   (e: React.MouseEvent) => void;
  onResizeStart: (e: React.MouseEvent, dir: string) => void;
}

// ── Highlight whole file → per-line HTML, keeping spans self-contained ────────
function highlightLines(code: string, lang: string): string[] {
  let html: string;
  try {
    if (lang !== "text" && hljs.getLanguage(lang)) {
      html = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    } else {
      html = code
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }
  } catch {
    html = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  const rawLines   = html.split("\n");
  const openStack: string[] = [];
  const result:    string[] = [];
  const reOpen  = /<span([^>]*)>/g;
  const reClose = /<\/span>/g;

  for (const raw of rawLines) {
    const prefix = openStack.map(a => `<span${a}>`).join("");
    const full   = prefix + raw;

    reOpen.lastIndex  = 0;
    reClose.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = reOpen.exec(raw))  !== null) openStack.push(m[1]);
    let closes = 0;
    while (reClose.exec(raw) !== null) closes++;
    for (let i = 0; i < closes; i++) openStack.pop();

    result.push(full + "</span>".repeat(openStack.length));
  }
  return result;
}

function resizeStyle(dir: string): React.CSSProperties {
  if (dir === "r")  return { top: 8, right: -3,  width: 6, height: "calc(100% - 16px)", cursor: "ew-resize" };
  if (dir === "l")  return { top: 8, left: -3,   width: 6, height: "calc(100% - 16px)", cursor: "ew-resize" };
  if (dir === "b")  return { bottom: -3, left: 8, width: "calc(100% - 16px)", height: 6, cursor: "ns-resize" };
  if (dir === "t")  return { top: -3, left: 8, width: "calc(100% - 16px)", height: 6, cursor: "ns-resize" };
  if (dir === "br") return { bottom: -3, right: -3, width: 14, height: 14, cursor: "nwse-resize" };
  if (dir === "bl") return { bottom: -3, left: -3,  width: 14, height: 14, cursor: "nesw-resize" };
  if (dir === "tr") return { top: -3, right: -3,    width: 14, height: 14, cursor: "nesw-resize" };
  return                   { top: -3, left: -3,     width: 14, height: 14, cursor: "nwse-resize" };
}

// ── Split icon ────────────────────────────────────────────────────────────────
const IcoSplitDown = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <line x1="3" y1="12" x2="21" y2="12"/>
  </svg>
);

export default function FileViewerPane({
  id, path, x, y, w, h, zIndex,
  isActive, onActivate, onClose, onSplitDown, onDragStart, onResizeStart,
}: FileViewerPaneProps) {
  const [content, setContent] = useState<string | null>(null);
  const [error,   setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fileName = path.split(/[/\\]/).pop() ?? path;
  const lang     = getLanguage(path);

  useEffect(() => {
    setLoading(true); setError(null); setContent(null);
    invoke<string>("read_text_file", { path })
      .then(c  => { setContent(c);       setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, [path]);

  const highlightedLines = useMemo(
    () => content != null ? highlightLines(content, lang) : [],
    [content, lang],
  );

  const lineNumW = highlightedLines.length >= 10000 ? 56
                 : highlightedLines.length >= 1000  ? 48 : 40;

  return (
    <div
      onMouseDown={onActivate}
      style={{
        position: "absolute",
        left: x, top: y, width: w, height: h, zIndex,
        display: "flex", flexDirection: "column",
        background: "#0f1012",
        borderRadius: 10,
        border: isActive
          ? "1.5px solid rgba(255,255,255,.32)"
          : "1px solid rgba(255,255,255,.06)",
        overflow: "hidden", boxSizing: "border-box",
        transition: "border-color .15s",
        boxShadow: isActive
          ? "0 8px 32px rgba(0,0,0,.5)"
          : "0 2px 8px rgba(0,0,0,.3)",
      }}
    >
      <style>{THEME}</style>

      {/* Resize handles */}
      {DIRS.map(dir => (
        <div key={dir}
          style={{ position: "absolute", zIndex: 100, ...resizeStyle(dir) }}
          onMouseDown={e => { e.stopPropagation(); onResizeStart(e, dir); }}
        />
      ))}

      {/* ── Title bar ── */}
      <div
        onMouseDown={e => {
          if ((e.target as HTMLElement).closest(".fv-btn")) return;
          onDragStart(e);
        }}
        style={{
          height: 36, flexShrink: 0,
          display: "flex", alignItems: "center",
          padding: "0 8px 0 12px", gap: 8,
          background: isActive ? "rgba(255,255,255,.05)" : "rgba(255,255,255,.025)",
          borderBottom: `1px solid ${isActive ? "rgba(255,255,255,.1)" : "rgba(255,255,255,.05)"}`,
          cursor: "grab", userSelect: "none", borderRadius: "10px 10px 0 0",
        }}
      >
        {/* Traffic lights */}
        <div className="fv-btn" style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
          <div
            onClick={e => { e.stopPropagation(); onClose(); }}
            style={{ width: 12, height: 12, borderRadius: "50%", background: "#ff5f57",
              cursor: "pointer", filter: isActive ? "none" : "grayscale(1) brightness(.35)" }}
          />
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#febc2e",
            filter: isActive ? "none" : "grayscale(1) brightness(.35)" }} />
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#27c93f",
            filter: isActive ? "none" : "grayscale(1) brightness(.35)" }} />
        </div>

        <div style={{ width: 1, height: 12, background: "rgba(255,255,255,.08)", flexShrink: 0 }} />

        {/* File icon */}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
          stroke="rgba(255,255,255,.4)" strokeWidth="2" style={{ flexShrink: 0 }}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>

        {/* Filename only — NOT the full path */}
        <span style={{
          flex: 1, minWidth: 0, fontSize: 11, fontFamily: MONO,
          color: isActive ? "rgba(255,255,255,.75)" : "rgba(255,255,255,.3)",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          fontWeight: isActive ? 500 : 400,
        }}>
          {fileName}
        </span>

        {/* Lang badge */}
        <span style={{
          fontSize: 9, fontFamily: MONO, letterSpacing: ".05em", flexShrink: 0,
          color: "rgba(255,255,255,.3)", background: "rgba(255,255,255,.06)",
          border: "1px solid rgba(255,255,255,.08)", borderRadius: 4, padding: "1px 7px",
        }}>
          {lang}
        </span>

        {/* Split down button */}
        {onSplitDown && (
          <SplitBtn onClick={e => { e.stopPropagation(); onSplitDown(); }} />
        )}
      </div>

      {/* ── Code content ── */}
      <div style={{
        flex: 1, minHeight: 0, overflow: "auto",
        opacity: isActive ? 1 : 0.45, transition: "opacity .2s",
        scrollbarWidth: "thin",
        scrollbarColor: "rgba(255,255,255,.12) transparent",
      }}>
        {loading && (
          <div style={{ padding: 20, color: "#555", fontSize: 12, fontFamily: MONO }}>Loading…</div>
        )}
        {error && (
          <div style={{ padding: 20, color: "#e05252", fontSize: 12, fontFamily: MONO }}>
            Cannot read file: {error}
          </div>
        )}

        {highlightedLines.length > 0 && (
          <table style={{
            borderCollapse: "collapse", width: "100%",
            fontSize: 13, fontFamily: MONO, lineHeight: "1.65",
          }}>
            <tbody>
              {highlightedLines.map((html, i) => (
                <tr key={i} style={{ verticalAlign: "top" }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,.03)"}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
                >
                  {/* Line number — sticky gutter */}
                  <td style={{
                    padding: "0 12px 0 16px",
                    color: "rgba(255,255,255,.2)",
                    userSelect: "none", textAlign: "right",
                    minWidth: lineNumW, width: lineNumW, fontSize: 12,
                    borderRight: "1px solid rgba(255,255,255,.05)",
                    position: "sticky", left: 0, background: "#0f1012",
                  }}>
                    {i + 1}
                  </td>
                  {/* Highlighted code */}
                  <td
                    style={{ padding: "0 24px 0 16px", whiteSpace: "pre" }}
                    dangerouslySetInnerHTML={{ __html: html || "\u00a0" }}
                  />
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Split button component ────────────────────────────────────────────────────
function SplitBtn({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      className="fv-btn"
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      title="Split down"
      style={{
        border: "none", cursor: "pointer", flexShrink: 0,
        width: 24, height: 24, borderRadius: 4, padding: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: hov ? "#fff" : "rgba(255,255,255,.35)",
        background: hov ? "rgba(255,255,255,.08)" : "transparent",
        transition: "all .1s",
      } as React.CSSProperties}
    >
      <IcoSplitDown />
    </button>
  );
}