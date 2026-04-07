// features/editor/LiveEditor.tsx
import { type CSSProperties, useCallback, useEffect, useMemo, useRef } from "react";
import { C } from "../../design";
import type { FindMatch } from "./FindBar";
import { GutterInner } from "./GutterInner";
import type { HljsCore } from "./hljs";

// ── Typography constants ───────────────────────────────────────────────────────
export const FONT = `'JetBrains Mono','Cascadia Code','Fira Code','Consolas',monospace`;
export const FONT_SIZE = 13;
export const LINE_HEIGHT = 20;
export const PAD_TOP = 12;
export const PAD_LEFT = 14;
export const PAD_BOTTOM = 40;

const sharedTextStyle: CSSProperties = {
  fontFamily: FONT,
  fontSize: FONT_SIZE,
  lineHeight: `${LINE_HEIGHT}px`,
  tabSize: 2,
  whiteSpace: "pre",
  wordWrap: "normal",
  overflowWrap: "normal",
  margin: 0,
  padding: `${PAD_TOP}px ${PAD_LEFT}px ${PAD_BOTTOM}px ${PAD_LEFT}px`,
  boxSizing: "border-box",
};

// ── Highlight helpers ─────────────────────────────────────────────────────────
function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function doHighlight(hljs: HljsCore | null, code: string, lang: string) {
  if (!hljs || !code) return escapeHtml(code);
  try {
    if (lang !== "plaintext" && hljs.getLanguage(lang))
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    return hljs.highlightAuto(code).value;
  } catch {
    return escapeHtml(code);
  }
}

function highlightLines(code: string, lang: string, hljs: HljsCore | null): string[] {
  const html = doHighlight(hljs, code, lang);
  const rawLines = html.split("\n");
  const stack: string[] = [];
  const result: string[] = [];
  const reOpen = /<span([^>]*)>/g;
  const reClose = /<\/span>/g;
  for (const raw of rawLines) {
    const prefix = stack.map((a) => `<span${a}>`).join("");
    reOpen.lastIndex = 0;
    reClose.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = reOpen.exec(raw)) !== null) stack.push(m[1]);
    let closes = 0;
    while (reClose.exec(raw) !== null) closes++;
    for (let i = 0; i < closes; i++) stack.pop();
    result.push(prefix + raw + "</span>".repeat(stack.length));
  }
  return result;
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  code: string;
  lang: string;
  hljs: HljsCore | null;
  onChange: (v: string) => void;
  findMatches: FindMatch[];
  activeMatch: number;
  style?: CSSProperties;
}

export function LiveEditor({ code, lang, hljs, onChange, findMatches, activeMatch, style }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const lines = useMemo(() => code.split("\n"), [code]);
  const lineCount = lines.length;
  const gutterWidth = lineCount >= 10000 ? 60 : lineCount >= 1000 ? 52 : 44;
  const contentH = PAD_TOP + lineCount * LINE_HEIGHT + PAD_BOTTOM;
  const maxLineLen = useMemo(() => Math.max(...lines.map((l) => l.length)), [lines]);
  const contentW = Math.max(800, maxLineLen * 7.8 + PAD_LEFT * 2 + gutterWidth + 40);

  const hlLines = useMemo(() => highlightLines(code, lang, hljs), [code, lang, hljs]);

  const annotatedLines = useMemo(() => {
    if (!findMatches.length) return hlLines;
    const byLine = new Map<number, { col: number; len: number; isActive: boolean }[]>();
    findMatches.forEach((m, idx) => {
      if (!byLine.has(m.line)) byLine.set(m.line, []);
      byLine.get(m.line)?.push({ col: m.col, len: m.len, isActive: idx === activeMatch });
    });
    return hlLines.map((html, li) => {
      const ms = byLine.get(li);
      if (!ms) return html;
      const plain = lines[li] ?? "";
      let escaped = escapeHtml(plain);
      const sorted = [...ms].sort((a, b) => b.col - a.col);
      for (const m of sorted) {
        const start = escapeHtml(plain.slice(0, m.col)).length;
        const matchTxt = escapeHtml(plain.slice(m.col, m.col + m.len));
        const bg = m.isActive ? "rgba(255,200,0,.55)" : "rgba(255,200,0,.22)";
        escaped = `${escaped.slice(0, start)}<mark style="background:${bg};border-radius:2px;padding:0 1px;color:inherit">${matchTxt}</mark>${escaped.slice(start + matchTxt.length)}`;
      }
      return escaped;
    });
  }, [hlLines, findMatches, activeMatch, lines]);

  useEffect(() => {
    if (!findMatches.length || !scrollRef.current) return;
    const match = findMatches[activeMatch];
    if (!match) return;
    const sc = scrollRef.current;
    const targetY = PAD_TOP + match.line * LINE_HEIGHT;
    const viewH = sc.clientHeight;
    if (targetY < sc.scrollTop + 40 || targetY + LINE_HEIGHT > sc.scrollTop + viewH - 40)
      sc.scrollTop = Math.max(0, targetY - viewH / 2);
  }, [activeMatch, findMatches]);

  // Reset scroll on file switch (detect by first 100 chars)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
      scrollRef.current.scrollLeft = 0;
    }
  }, [code.slice(0, 100)]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const ta = e.currentTarget;
      if (e.key === "Tab") {
        e.preventDefault();
        const s = ta.selectionStart;
        const end = ta.selectionEnd;
        if (e.shiftKey) {
          const lineStart = ta.value.lastIndexOf("\n", s - 1) + 1;
          const spaces = ta.value.slice(lineStart).match(/^ {1,2}/)?.[0].length ?? 0;
          if (spaces > 0) {
            const next = ta.value.slice(0, lineStart) + ta.value.slice(lineStart + spaces);
            onChange(next);
            requestAnimationFrame(() => {
              ta.selectionStart = ta.selectionEnd = Math.max(lineStart, s - spaces);
            });
          }
        } else {
          const next = `${ta.value.slice(0, s)}  ${ta.value.slice(end)}`;
          onChange(next);
          requestAnimationFrame(() => {
            ta.selectionStart = ta.selectionEnd = s + 2;
          });
        }
      }
    },
    [onChange]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      e.preventDefault();
      const raw = e.clipboardData.getData("text");
      const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const ta = e.currentTarget;
      const s = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = ta.value.slice(0, s) + normalized + ta.value.slice(end);
      onChange(next);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = s + normalized.length;
      });
    },
    [onChange]
  );

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        overflow: "hidden",
        background: "#0b0e10",
        ...style,
      }}
    >
      {/* Gutter */}
      <div
        style={{
          width: gutterWidth,
          flexShrink: 0,
          overflow: "hidden",
          background: "#0b0e10",
          borderRight: `1px solid ${C.border}`,
          userSelect: "none",
          zIndex: 2,
        }}
      >
        <GutterInner
          lineCount={lineCount}
          lineHeight={LINE_HEIGHT}
          padTop={PAD_TOP}
          padBottom={PAD_BOTTOM}
          gutterWidth={gutterWidth}
          fontSize={FONT_SIZE}
          scrollRef={scrollRef}
        />
      </div>

      {/* Single scroll owner */}
      <div
        ref={scrollRef}
        className="sb-scroll"
        style={{ flex: 1, minWidth: 0, overflow: "auto", position: "relative" }}
      >
        <div style={{ position: "relative", width: contentW, height: contentH }}>
          {/* Highlight layer */}
          <div
            aria-hidden
            className="sb-hljs"
            style={{
              ...sharedTextStyle,
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              minHeight: contentH,
              color: "#abb2bf",
              pointerEvents: "none",
              userSelect: "none",
              zIndex: 0,
            }}
          >
            {annotatedLines.map((html, i) => (
              <div
                key={i}
                style={{ height: LINE_HEIGHT, lineHeight: `${LINE_HEIGHT}px` }}
                dangerouslySetInnerHTML={{ __html: html || "\u00a0" }}
              />
            ))}
          </div>
          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={code}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            className="sb-textarea"
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            style={{
              ...sharedTextStyle,
              position: "absolute",
              top: 0,
              left: 0,
              width: contentW,
              height: contentH,
              zIndex: 1,
              cursor: "text",
            }}
          />
        </div>
      </div>
    </div>
  );
}
