/**
 * Workspacepanel.tsx
 *
 * VS Code-style editor:
 *  - bg #0b0e10, header #101518, rounded corners
 *  - All colors from C (constants)
 *  - Inline Find bar: text / word / regex / line-jump, match count, prev/next
 *  - Editable with full syntax highlighting (hljs)
 *  - No insertions/deletions display
 */

import React, {
  useEffect, useRef, useState, useCallback, useMemo, CSSProperties,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { C, MONO, SANS } from "../shared/constants";
import { FileIcon } from "./Filestructurepanel";

// ─── highlight.js lazy singleton ──────────────────────────────────────────────
type HljsCore = typeof import("highlight.js").default;
let hljsPromise: Promise<HljsCore> | null = null;

function getHljs(): Promise<HljsCore> {
  if (hljsPromise) return hljsPromise;
  hljsPromise = (async () => {
    const { default: hljs } = await import("highlight.js/lib/core");
    const [
      { default: javascript }, { default: typescript }, { default: python },
      { default: css },        { default: xml },         { default: json },
      { default: bash },       { default: markdown },    { default: rust },
      { default: go },         { default: java },        { default: cpp },
      { default: csharp },     { default: ruby },        { default: swift },
      { default: kotlin },     { default: sql },         { default: yaml },
      { default: dockerfile }, { default: graphql },
    ] = await Promise.all([
      import("highlight.js/lib/languages/javascript"),
      import("highlight.js/lib/languages/typescript"),
      import("highlight.js/lib/languages/python"),
      import("highlight.js/lib/languages/css"),
      import("highlight.js/lib/languages/xml"),
      import("highlight.js/lib/languages/json"),
      import("highlight.js/lib/languages/bash"),
      import("highlight.js/lib/languages/markdown"),
      import("highlight.js/lib/languages/rust"),
      import("highlight.js/lib/languages/go"),
      import("highlight.js/lib/languages/java"),
      import("highlight.js/lib/languages/cpp"),
      import("highlight.js/lib/languages/csharp"),
      import("highlight.js/lib/languages/ruby"),
      import("highlight.js/lib/languages/swift"),
      import("highlight.js/lib/languages/kotlin"),
      import("highlight.js/lib/languages/sql"),
      import("highlight.js/lib/languages/yaml"),
      import("highlight.js/lib/languages/dockerfile"),
      import("highlight.js/lib/languages/graphql"),
    ]);
    const reg = (aliases: string[], lang: any) => aliases.forEach(a => hljs.registerLanguage(a, lang));
    reg(["javascript","js","jsx","mjs"], javascript);
    reg(["typescript","ts","tsx"],       typescript);
    reg(["python","py"],                 python);
    reg(["css","scss","less"],           css);
    reg(["html","xml","svg"],            xml);
    reg(["json","jsonc"],                json);
    reg(["bash","sh","zsh"],             bash);
    reg(["markdown","md","mdx"],         markdown);
    reg(["rust","rs"],                   rust);
    reg(["go"],                          go);
    reg(["java","groovy"],               java);
    reg(["cpp","c","cc","cxx","h","hpp"],cpp);
    reg(["csharp","cs"],                 csharp);
    reg(["ruby","rb"],                   ruby);
    reg(["swift"],                       swift);
    reg(["kotlin","kt"],                 kotlin);
    reg(["sql"],                         sql);
    reg(["yaml","yml"],                  yaml);
    reg(["dockerfile"],                  dockerfile);
    reg(["graphql","gql"],               graphql);
    return hljs;
  })();
  return hljsPromise;
}

// ─── One Dark Pro theme ────────────────────────────────────────────────────────
const THEME_CSS = `
.sb-hljs .hljs            { background:transparent; color:#abb2bf; }
.sb-hljs .hljs-keyword    { color:#c678dd; }
.sb-hljs .hljs-built_in   { color:#e06c75; }
.sb-hljs .hljs-type       { color:#e5c07b; }
.sb-hljs .hljs-class      { color:#e5c07b; }
.sb-hljs .hljs-string     { color:#98c379; }
.sb-hljs .hljs-number     { color:#d19a66; }
.sb-hljs .hljs-literal    { color:#56b6c2; }
.sb-hljs .hljs-operator   { color:#56b6c2; }
.sb-hljs .hljs-comment    { color:#5c6370; font-style:italic; }
.sb-hljs .hljs-variable   { color:#e06c75; }
.sb-hljs .hljs-attr       { color:#e06c75; }
.sb-hljs .hljs-attribute  { color:#98c379; }
.sb-hljs .hljs-title      { color:#61afef; }
.sb-hljs .hljs-function   { color:#61afef; }
.sb-hljs .hljs-title.function_ { color:#61afef; }
.sb-hljs .hljs-title.class_    { color:#e5c07b; }
.sb-hljs .hljs-params     { color:#abb2bf; }
.sb-hljs .hljs-tag        { color:#e06c75; }
.sb-hljs .hljs-name       { color:#e06c75; }
.sb-hljs .hljs-property   { color:#9cdcfe; }
.sb-hljs .hljs-meta       { color:#61afef; }
.sb-hljs .hljs-symbol     { color:#56b6c2; }
.sb-hljs .hljs-punctuation{ color:#abb2bf; }
.sb-hljs .hljs-regexp     { color:#98c379; }
.sb-hljs .hljs-section    { color:#61afef; font-weight:bold; }
.sb-hljs .hljs-selector-tag   { color:#e06c75; }
.sb-hljs .hljs-selector-class { color:#e5c07b; }
.sb-hljs .hljs-selector-id    { color:#61afef; }
.sb-hljs .hljs-emphasis   { font-style:italic; }
.sb-hljs .hljs-strong     { font-weight:bold; }
.sb-hljs .hljs-link       { color:#98c379; text-decoration:underline; }
.sb-hljs .hljs-code       { color:#98c379; }
.sb-hljs .hljs-bullet     { color:#61afef; }
.sb-hljs .hljs-quote      { color:#5c6370; font-style:italic; }
.sb-hljs .hljs-formula    { color:#9cdcfe; }
.sb-hljs .hljs-variable.language_ { color:#c678dd; }
`;

let themeInjected = false;
function injectTheme() {
  if (themeInjected) return;
  themeInjected = true;
  const s = document.createElement("style");
  s.textContent = THEME_CSS;
  document.head.appendChild(s);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function extToLang(filename: string): string {
  const ext  = filename.split(".").pop()?.toLowerCase() ?? "";
  const name = filename.split(/[/\\]/).pop()?.toLowerCase() ?? "";
  if (name === "dockerfile") return "dockerfile";
  if (name === "makefile")   return "makefile";
  const map: Record<string, string> = {
    ts:"typescript", tsx:"typescript", js:"javascript", jsx:"javascript",
    mjs:"javascript", cjs:"javascript",
    py:"python", pyw:"python",
    css:"css", scss:"css", less:"css",
    html:"html", htm:"html", xml:"xml", svg:"xml",
    json:"json", jsonc:"json",
    yaml:"yaml", yml:"yaml",
    sh:"bash", bash:"bash", zsh:"bash",
    md:"markdown", mdx:"markdown",
    rs:"rust", go:"go",
    c:"c", h:"c", cpp:"cpp", cc:"cpp", cxx:"cpp", hpp:"cpp",
    cs:"csharp", java:"java", kt:"kotlin", rb:"ruby", swift:"swift",
    sql:"sql", graphql:"graphql", gql:"graphql",
    dockerfile:"dockerfile",
  };
  return map[ext] ?? "plaintext";
}

function escapeHtml(s: string): string {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function doHighlight(hljs: HljsCore | null, code: string, lang: string): string {
  if (!hljs || !code) return escapeHtml(code);
  try {
    if (lang !== "plaintext" && hljs.getLanguage(lang))
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    return hljs.highlightAuto(code).value;
  } catch { return escapeHtml(code); }
}

// Build per-line HTML preserving open <span> tags across line breaks
function highlightLines(code: string, lang: string, hljs: HljsCore | null): string[] {
  const html      = doHighlight(hljs, code, lang);
  const rawLines  = html.split("\n");
  const openStack: string[] = [];
  const result:   string[] = [];
  const reOpen    = /<span([^>]*)>/g;
  const reClose   = /<\/span>/g;

  for (const raw of rawLines) {
    const prefix = openStack.map(a => `<span${a}>`).join("");
    reOpen.lastIndex  = 0; reClose.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = reOpen.exec(raw)) !== null) openStack.push(m[1]);
    let closes = 0;
    while (reClose.exec(raw) !== null) closes++;
    for (let i = 0; i < closes; i++) openStack.pop();
    result.push(prefix + raw + "</span>".repeat(openStack.length));
  }
  return result;
}

// ─── Find bar logic ───────────────────────────────────────────────────────────
interface FindMatch { line: number; col: number; len: number; }

function buildMatches(code: string, query: string, opts: {
  caseSensitive: boolean; wholeWord: boolean; useRegex: boolean;
}): FindMatch[] {
  if (!query) return [];
  const matches: FindMatch[] = [];
  try {
    let pattern = opts.useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (opts.wholeWord && !opts.useRegex) pattern = `\\b${pattern}\\b`;
    const flags = opts.caseSensitive ? "g" : "gi";
    const re    = new RegExp(pattern, flags);
    const lines = code.split("\n");
    for (let li = 0; li < lines.length; li++) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(lines[li])) !== null) {
        matches.push({ line: li, col: m.index, len: m[0].length });
        if (m[0].length === 0) re.lastIndex++;
      }
    }
  } catch { /* invalid regex — return empty */ }
  return matches;
}

// ─── Shared text geometry ─────────────────────────────────────────────────────
const FONT        = `'JetBrains Mono','Cascadia Code','Fira Code','Consolas',monospace`;
const FONT_SIZE   = 13;
const LINE_HEIGHT = 1.65;
const PAD_LEFT    = 16;
const PAD_TOP     = 12;

// ─── LiveEditor (highlight + editable textarea overlay) ───────────────────────
interface LiveEditorProps {
  code:        string;
  lang:        string;
  hljs:        HljsCore | null;
  onChange:    (v: string) => void;
  findMatches: FindMatch[];
  activeMatch: number;
  style?:      CSSProperties;
}

export function LiveEditor({
  code, lang, hljs, onChange, findMatches, activeMatch, style,
}: LiveEditorProps) {
  const textareaRef  = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const gutterRef    = useRef<HTMLDivElement>(null);

  const lineHeightPx = FONT_SIZE * LINE_HEIGHT;

  // Textarea scrolls → sync highlight layer and gutter
  const handleScroll = useCallback((e: React.UIEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    if (highlightRef.current) {
      highlightRef.current.style.transform =
        `translate(-${ta.scrollLeft}px, -${ta.scrollTop}px)`;
    }
    if (gutterRef.current) {
      gutterRef.current.scrollTop = ta.scrollTop;
    }
  }, []);

  // Scroll active match into view via textarea
  useEffect(() => {
    if (!findMatches.length) return;
    const match = findMatches[activeMatch];
    if (!match || !textareaRef.current) return;
    const ta      = textareaRef.current;
    const targetY = PAD_TOP + match.line * lineHeightPx;
    const viewH   = ta.clientHeight;
    if (targetY < ta.scrollTop || targetY + lineHeightPx > ta.scrollTop + viewH) {
      ta.scrollTop = Math.max(0, targetY - viewH / 2);
    }
  }, [activeMatch, findMatches, lineHeightPx]);

  // Tab key support
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const ta  = e.currentTarget;
      const s   = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = ta.value.slice(0, s) + "  " + ta.value.slice(end);
      onChange(next);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 2; });
    }
  };

  const lines    = useMemo(() => highlightLines(code, lang, hljs), [code, lang, hljs]);
  const lineNumW = lines.length >= 10000 ? 56 : lines.length >= 1000 ? 48 : 40;

  // Annotate lines with find highlights
  const annotatedLines = useMemo(() => {
    if (!findMatches.length) return lines;
    const byLine = new Map<number, { col: number; len: number; isActive: boolean }[]>();
    findMatches.forEach((m, idx) => {
      if (!byLine.has(m.line)) byLine.set(m.line, []);
      byLine.get(m.line)!.push({ col: m.col, len: m.len, isActive: idx === activeMatch });
    });
    return lines.map((html, li) => {
      const ms = byLine.get(li);
      if (!ms) return html;
      const plain  = code.split("\n")[li] ?? "";
      let escaped  = escapeHtml(plain);
      const sorted = [...ms].sort((a, b) => b.col - a.col);
      for (const m of sorted) {
        const start    = escapeHtml(plain.slice(0, m.col)).length;
        const matchTxt = escapeHtml(plain.slice(m.col, m.col + m.len));
        const bg = m.isActive ? "rgba(255,200,0,.55)" : "rgba(255,200,0,.22)";
        escaped =
          escaped.slice(0, start) +
          `<mark style="background:${bg};border-radius:2px;padding:0 1px;color:inherit">${matchTxt}</mark>` +
          escaped.slice(start + matchTxt.length);
      }
      return escaped;
    });
  }, [lines, findMatches, activeMatch, code]);

  // Shared text style — identical for both highlight div and textarea
  const sharedStyle: CSSProperties = {
    fontFamily:   FONT,
    fontSize:     FONT_SIZE,
    lineHeight:   LINE_HEIGHT,
    margin:       0,
    border:       "none",
    outline:      "none",
    whiteSpace:   "pre",
    wordWrap:     "normal" as const,
    overflowWrap: "normal" as const,
    tabSize:      2,
    padding:      `${PAD_TOP}px ${PAD_LEFT}px 24px ${PAD_LEFT}px`,
    boxSizing:    "border-box" as const,
  };

  return (
    <div style={{
      flex: 1, minHeight: 0, display: "flex",
      background: C.bg0, overflow: "hidden", ...style,
    }}>

      {/* ── Gutter: scrollTop driven by textarea onScroll ── */}
      <div ref={gutterRef} style={{
        width: lineNumW, flexShrink: 0,
        overflowY: "hidden", overflowX: "hidden",
        background: C.bg0, borderRight: `1px solid ${C.border}`,
        userSelect: "none",
        paddingTop: PAD_TOP, paddingBottom: 24,
      }}>
        {lines.map((_, i) => (
          <div key={i} style={{
            height: lineHeightPx, lineHeight: `${lineHeightPx}px`,
            paddingRight: 10, textAlign: "right",
            fontSize: FONT_SIZE - 1, fontFamily: FONT, color: C.t3,
          }}>
            {i + 1}
          </div>
        ))}
      </div>

      {/* ── Code pane: relative wrapper, clips the highlight layer ── */}
      <div style={{ flex: 1, minWidth: 0, position: "relative", overflow: "hidden" }}>

        {/* Highlight — absolutely at origin, scrolled via CSS transform */}
        <div
          ref={highlightRef}
          aria-hidden="true"
          className="sb-hljs"
          style={{
            ...sharedStyle,
            position:      "absolute",
            top: 0, left: 0,
            width:         "max-content",
            minWidth:      "100%",
            color:         "#abb2bf",
            pointerEvents: "none",
            userSelect:    "none",
            zIndex:        0,
          }}
        >
          {annotatedLines.map((html, i) => (
            <div
              key={i}
              style={{ height: lineHeightPx, lineHeight: `${lineHeightPx}px` }}
              dangerouslySetInnerHTML={{ __html: html || "\u00a0" }}
            />
          ))}
        </div>

        {/* Textarea — SOLE scroll owner, fills the code pane */}
        <textarea
          ref={textareaRef}
          value={code}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onScroll={handleScroll}
          onPaste={e => {
            e.preventDefault();
            const raw        = e.clipboardData.getData("text");
            const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
            const ta         = e.currentTarget;
            const start      = ta.selectionStart;
            const end        = ta.selectionEnd;
            const next       = ta.value.slice(0, start) + normalized + ta.value.slice(end);
            onChange(next);
            requestAnimationFrame(() => {
              ta.selectionStart = ta.selectionEnd = start + normalized.length;
            });
          }}
          style={{
            ...sharedStyle,
            position:   "absolute",
            top: 0, left: 0,
            width:      "100%",
            height:     "100%",
            background: "transparent",
            color:      "transparent",
            caretColor: C.tealBright,
            resize:     "none",
            overflow:   "auto",   // ← textarea owns the scroll
            cursor:     "text",
            zIndex:     1,
          }}
        />
      </div>
    </div>
  );
}

// ─── Find Bar ─────────────────────────────────────────────────────────────────
interface FindBarProps {
  code:        string;
  onClose:     () => void;
  onMatch:     (matches: FindMatch[], active: number) => void;
  onNext:      () => void;
  onPrev:      () => void;
  matchCount:  number;
  activeMatch: number;
}

function FindBar({ code, onClose, onMatch, onNext, onPrev, matchCount, activeMatch }: FindBarProps) {
  const [query,         setQuery]         = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord,     setWholeWord]     = useState(false);
  const [useRegex,      setUseRegex]      = useState(false);
  const [lineJump,      setLineJump]      = useState("");
  const [mode,          setMode]          = useState<"find"|"line">("find");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (mode !== "find" || !query) { onMatch([], 0); return; }
    const matches = buildMatches(code, query, { caseSensitive, wholeWord, useRegex });
    onMatch(matches, 0);
  }, [query, caseSensitive, wholeWord, useRegex, code, mode]);

  const handleLineJump = (val: string) => {
    setLineJump(val);
    const n = parseInt(val, 10);
    if (!isNaN(n)) {
      const line = Math.max(0, n - 1);
      onMatch([{ line, col: 0, len: 0 }], 0);
    }
  };

  const TogBtn = ({ label, active, title, onClick }: {
    label: string; active: boolean; title: string; onClick: () => void;
  }) => (
    <button title={title} onClick={onClick} style={{
      border: `1px solid ${active ? C.borderHi : C.border}`,
      background: active ? C.bg4 : "transparent",
      color: active ? C.t0 : C.t2,
      borderRadius: 4, fontSize: 10, fontFamily: MONO, fontWeight: 700,
      padding: "1px 6px", cursor: "pointer", transition: "all .1s",
      lineHeight: "18px", flexShrink: 0,
    }}>{label}</button>
  );

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "6px 10px",
      background: C.bg1,
      borderBottom: `1px solid ${C.border}`,
      flexShrink: 0,
    }}>
      {/* Mode toggle */}
      <div style={{ display: "flex", background: C.bg2, borderRadius: 6, padding: 2, gap: 1, flexShrink: 0 }}>
        {(["find","line"] as const).map(m => (
          <button key={m} onClick={() => { setMode(m); onMatch([], 0); }} style={{
            padding: "2px 8px", borderRadius: 4, border: "none",
            background: mode === m ? C.bg4 : "transparent",
            color: mode === m ? C.t0 : C.t3,
            fontSize: 10, fontFamily: MONO, cursor: "pointer",
            transition: "all .1s", textTransform: "capitalize",
          }}>{m === "line" ? "Line" : "Find"}</button>
        ))}
      </div>

      {mode === "find" ? (
        <>
          {/* Search input */}
          <div style={{
            flex: 1, display: "flex", alignItems: "center", gap: 6,
            background: C.bg2, border: `1px solid ${C.border}`,
            borderRadius: 6, padding: "4px 8px",
          }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth="2.5" strokeLinecap="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter")  { e.shiftKey ? onPrev() : onNext(); }
                if (e.key === "Escape") { onClose(); }
              }}
              placeholder="Search… (Enter ↵  Shift+Enter ↑)"
              style={{
                flex: 1, background: "none", border: "none", outline: "none",
                color: C.t0, fontSize: 12, fontFamily: MONO,
                caretColor: C.tealBright,
              }}
            />
            {query && (
              <span style={{ fontSize: 10, fontFamily: MONO, color: C.t3, flexShrink: 0, whiteSpace: "nowrap" }}>
                {matchCount === 0 ? "no matches" : `${activeMatch + 1}/${matchCount}`}
              </span>
            )}
            {query && (
              <button onClick={() => { setQuery(""); onMatch([], 0); }} style={{
                background: "none", border: "none", cursor: "pointer",
                color: C.t3, padding: 2, display: "flex", alignItems: "center",
              }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            )}
          </div>

          {/* Options */}
          <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
            <TogBtn label="Aa" title="Case sensitive" active={caseSensitive} onClick={() => setCaseSensitive(v => !v)} />
            <TogBtn label="\b" title="Whole word"     active={wholeWord}     onClick={() => setWholeWord(v => !v)}     />
            <TogBtn label=".*" title="Regex"          active={useRegex}      onClick={() => setUseRegex(v => !v)}      />
          </div>

          {/* Prev / Next */}
          <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
            {[
              { title: "Previous (Shift+Enter)", onClick: onPrev, d: "M18 15l-6-6-6 6" },
              { title: "Next (Enter)",           onClick: onNext, d: "M6 9l6 6 6-6"    },
            ].map(({ title, onClick, d }) => (
              <button key={title} title={title} onClick={onClick} style={{
                width: 24, height: 24, border: `1px solid ${C.border}`,
                background: "transparent", borderRadius: 5,
                color: C.t2, cursor: "pointer", display: "flex",
                alignItems: "center", justifyContent: "center",
                transition: "all .1s",
              }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = C.bg3; el.style.color = C.t0; }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.color = C.t2; }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points={d}/>
                </svg>
              </button>
            ))}
          </div>
        </>
      ) : (
        /* Line jump mode */
        <div style={{
          flex: 1, display: "flex", alignItems: "center", gap: 8,
          background: C.bg2, border: `1px solid ${C.border}`,
          borderRadius: 6, padding: "4px 10px",
        }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth="2" strokeLinecap="round">
            <line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/>
            <line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>
          </svg>
          <input
            ref={inputRef}
            value={lineJump}
            onChange={e => handleLineJump(e.target.value)}
            onKeyDown={e => { if (e.key === "Escape") onClose(); }}
            placeholder="Go to line…"
            type="number" min="1"
            style={{
              flex: 1, background: "none", border: "none", outline: "none",
              color: C.t0, fontSize: 12, fontFamily: MONO,
              caretColor: C.tealBright,
            }}
          />
          <span style={{ fontSize: 10, fontFamily: MONO, color: C.t3 }}>
            {lineJump ? `line ${lineJump}` : "type a number"}
          </span>
        </div>
      )}

      {/* Close find bar */}
      <button onClick={onClose} title="Close (Esc)" style={{
        width: 22, height: 22, border: "none", background: "transparent",
        borderRadius: 4, cursor: "pointer", color: C.t3,
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0, transition: "color .1s",
      }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.t0}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.t3}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  );
}

// ─── Status bar (bottom) ──────────────────────────────────────────────────────
function StatusBar({ lang, lines, chars, isDirty }: {
  lang: string; lines: number; chars: number; isDirty: boolean;
}) {
  return (
    <div style={{
      height: 22, flexShrink: 0, display: "flex", alignItems: "center",
      paddingInline: 12, gap: 14,
      background: C.bg1, borderTop: `1px solid ${C.border}`,
    }}>
      {isDirty && (
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.amber, flexShrink: 0 }} />
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
        <span style={{ fontSize: 10, fontFamily: MONO, color: C.amber, marginLeft: "auto" }}>
          unsaved
        </span>
      )}
    </div>
  );
}

// ─── Icon button ──────────────────────────────────────────────────────────────
function IBtn({ children, title, onClick, disabled, active }: {
  children: React.ReactNode; title?: string; onClick: () => void;
  disabled?: boolean; active?: boolean;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button title={title} onClick={onClick} disabled={disabled}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        width: 28, height: 28, border: "none", borderRadius: 6, padding: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.3 : 1,
        background: hov && !disabled ? C.bg3 : active ? C.bg2 : "transparent",
        color: active ? C.t0 : hov && !disabled ? C.t0 : C.t2,
        transition: "all .1s",
      }}>
      {children}
    </button>
  );
}

// ─── FileEditorPane — main export used by WorkspaceView ───────────────────────
interface FileEditorPaneProps {
  path:    string;
  onClose: () => void;
  style?:  CSSProperties;
}

export function FileEditorPane({ path, onClose, style }: FileEditorPaneProps) {
  const [hljs,        setHljs]        = useState<HljsCore | null>(null);
  const [content,     setContent]     = useState<string | null>(null);
  const [draft,       setDraft]       = useState("");
  const [error,       setError]       = useState<string | null>(null);
  const [showFind,    setShowFind]    = useState(false);
  const [findMatches, setFindMatches] = useState<FindMatch[]>([]);
  const [activeMatch, setActiveMatch] = useState(0);

  useEffect(() => { injectTheme(); getHljs().then(setHljs); }, []);

  useEffect(() => {
    setContent(null); setError(null); setDraft("");
    setShowFind(false); setFindMatches([]); setActiveMatch(0);
    invoke<string>("read_text_file", { path })
      .then((text: string) => { setContent(text); setDraft(text); })
      .catch((err: unknown) => setError(String(err)));
  }, [path]);

  // Ctrl+S / Ctrl+F
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); handleSave(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "f") { e.preventDefault(); setShowFind(v => !v); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const fileName = path.split(/[/\\]/).pop() ?? path;
  const lang     = extToLang(fileName);
  const isDirty  = content !== null && draft !== content;
  const lines    = draft.split("\n").length;

  async function handleSave() {
    if (!isDirty) return;
    try {
      await invoke("fs_write_file", { path, content: draft });
      setContent(draft);
    } catch (e) { alert(`Save failed: ${e}`); }
  }

  const handleMatch = useCallback((matches: FindMatch[], active: number) => {
    setFindMatches(matches); setActiveMatch(active);
  }, []);

  const nextMatch = useCallback(() => {
    setActiveMatch(v => findMatches.length ? (v + 1) % findMatches.length : 0);
  }, [findMatches.length]);

  const prevMatch = useCallback(() => {
    setActiveMatch(v => findMatches.length ? (v - 1 + findMatches.length) % findMatches.length : 0);
  }, [findMatches.length]);

  // ── Placeholder states ──
  const placeStyle: CSSProperties = {
    display: "flex", flexDirection: "column", flex: 1,
    alignItems: "center", justifyContent: "center",
    background: C.bg0, color: C.t3, fontFamily: MONO,
    fontSize: 13, gap: 8, ...style,
  };

  if (error) return (
    <div style={placeStyle}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth="1.5" strokeLinecap="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <span style={{ color: C.t2 }}>Failed to open file</span>
      <span style={{ fontSize: 11, color: C.t3, maxWidth: 320, textAlign: "center" }}>{error}</span>
    </div>
  );

  if (content === null) return (
    <div style={placeStyle}>
      <div style={{ width: 16, height: 16, border: `2px solid ${C.border}`, borderTopColor: C.t1, borderRadius: "50%", animation: "sb-spin .7s linear infinite" }} />
      <style>{`@keyframes sb-spin { to { transform:rotate(360deg); } }`}</style>
    </div>
  );

  return (
    <div style={{
      display: "flex", flexDirection: "column", flex: 1, minHeight: 0,
      background: C.bg0, borderRadius: 10, overflow: "hidden", ...style,
    }}>
      {/* ── Header ── */}
      <div style={{
        height: 38, flexShrink: 0,
        display: "flex", alignItems: "center", gap: 6,
        padding: "0 6px 0 12px",
        background: C.bg1,
        borderBottom: `1px solid ${C.border}`,
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
          background: isDirty ? C.amber : "transparent",
          transition: "background .2s",
        }} />

        <FileIcon name={fileName} isDir={false} />

        <span style={{
          flex: 1, fontSize: 12, fontFamily: MONO, color: C.t1,
          fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {fileName}
        </span>

        <span style={{
          fontSize: 9, fontFamily: MONO, letterSpacing: ".06em",
          color: C.t3, background: C.bg3,
          border: `1px solid ${C.border}`, borderRadius: 4,
          padding: "1px 7px", flexShrink: 0, textTransform: "uppercase",
        }}>
          {lang}
        </span>

        <IBtn title="Find (Ctrl+F)" onClick={() => setShowFind(v => !v)} active={showFind}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </IBtn>

        <IBtn title="Save (Ctrl+S)" onClick={handleSave} disabled={!isDirty}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
            <polyline points="17 21 17 13 7 13 7 21"/>
            <polyline points="7 3 7 8 15 8"/>
          </svg>
        </IBtn>

        <IBtn title="Close" onClick={onClose}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="4" y1="4" x2="20" y2="20"/><line x1="20" y1="4" x2="4" y2="20"/>
          </svg>
        </IBtn>
      </div>

      {/* ── Find bar ── */}
      {showFind && (
        <FindBar
          code={draft}
          onClose={() => { setShowFind(false); setFindMatches([]); setActiveMatch(0); }}
          onMatch={handleMatch}
          onNext={nextMatch}
          onPrev={prevMatch}
          matchCount={findMatches.length}
          activeMatch={activeMatch}
        />
      )}

      {/* ── Editor ── */}
      <LiveEditor
        code={draft}
        lang={lang}
        hljs={hljs}
        onChange={setDraft}
        findMatches={findMatches}
        activeMatch={activeMatch}
        style={{ flex: 1, minHeight: 0 }}
      />

      {/* ── Status bar ── */}
      <StatusBar lang={lang} lines={lines} chars={draft.length} isDirty={isDirty} />
    </div>
  );
}

// ─── WorkspacePanel (legacy export) ───────────────────────────────────────────
export interface FileItem { name: string; content: string; language?: string; }

interface WorkspacePanelProps {
  file:    FileItem | null;
  onSave?: (filename: string, content: string) => void;
  onFind?: () => void;
  style?:  CSSProperties;
}

export default function WorkspacePanel({ file, onSave, onFind, style }: WorkspacePanelProps) {
  const [hljs,        setHljs]        = useState<HljsCore | null>(null);
  const [draft,       setDraft]       = useState(file?.content ?? "");
  const [showFind,    setShowFind]    = useState(false);
  const [findMatches, setFindMatches] = useState<FindMatch[]>([]);
  const [activeMatch, setActiveMatch] = useState(0);

  useEffect(() => { injectTheme(); getHljs().then(setHljs); }, []);
  useEffect(() => { setDraft(file?.content ?? ""); }, [file]);

  const lang    = file ? (file.language ?? extToLang(file.name)) : "plaintext";
  const isDirty = Boolean(file && draft !== file.content);

  if (!file) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", flex:1, background: C.bg0, color: C.t3, fontFamily: MONO, fontSize:13, ...style }}>
      Select a file to view
    </div>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", flex:1, minHeight:0, background: C.bg0, borderRadius:10, overflow:"hidden", ...style }}>
      <div style={{ height:38, flexShrink:0, display:"flex", alignItems:"center", gap:6, padding:"0 6px 0 12px", background: C.bg1, borderBottom:`1px solid ${C.border}` }}>
        <span style={{ flex:1, fontSize:12, fontFamily:MONO, color:C.t1, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{file.name}</span>
        <IBtn title="Find (Ctrl+F)" onClick={() => { setShowFind(v=>!v); onFind?.(); }} active={showFind}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </IBtn>
        <IBtn title="Save" onClick={() => { if (isDirty) onSave?.(file.name, draft); }} disabled={!isDirty}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
        </IBtn>
      </div>
      {showFind && (
        <FindBar
          code={draft}
          onClose={() => { setShowFind(false); setFindMatches([]); }}
          onMatch={(m, a) => { setFindMatches(m); setActiveMatch(a); }}
          onNext={() => setActiveMatch(v => findMatches.length ? (v+1)%findMatches.length : 0)}
          onPrev={() => setActiveMatch(v => findMatches.length ? (v-1+findMatches.length)%findMatches.length : 0)}
          matchCount={findMatches.length}
          activeMatch={activeMatch}
        />
      )}
      <LiveEditor code={draft} lang={lang} hljs={hljs} onChange={setDraft} findMatches={findMatches} activeMatch={activeMatch} style={{ flex:1, minHeight:0 }} />
      <StatusBar lang={lang} lines={draft.split("\n").length} chars={draft.length} isDirty={isDirty} />
    </div>
  );
}

export { extToLang as detectLang };
export { LiveEditor as EditorPane };