// features/editor/FindBar.tsx
import { useState, useEffect, useRef, useCallback } from "react";
import { C, MONO } from "../../design";

export interface FindMatch { line: number; col: number; len: number; }

export function buildMatches(
  code: string,
  query: string,
  opts: { caseSensitive: boolean; wholeWord: boolean; useRegex: boolean },
): FindMatch[] {
  if (!query) return [];
  const matches: FindMatch[] = [];
  try {
    let pattern = opts.useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (opts.wholeWord && !opts.useRegex) pattern = `\\b${pattern}\\b`;
    const re = new RegExp(pattern, opts.caseSensitive ? "g" : "gi");
    const lines = code.split("\n");
    for (let li = 0; li < lines.length; li++) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(lines[li])) !== null) {
        matches.push({ line: li, col: m.index, len: m[0].length });
        if (m[0].length === 0) re.lastIndex++;
      }
    }
  } catch { /* invalid regex */ }
  return matches;
}

interface Props {
  code:        string;
  onClose:     () => void;
  onMatch:     (matches: FindMatch[], active: number) => void;
  onNext:      () => void;
  onPrev:      () => void;
  matchCount:  number;
  activeMatch: number;
}

export function FindBar({ code, onClose, onMatch, onNext, onPrev, matchCount, activeMatch }: Props) {
  const [query,         setQuery]         = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord,     setWholeWord]     = useState(false);
  const [useRegex,      setUseRegex]      = useState(false);
  const [lineJump,      setLineJump]      = useState("");
  const [mode,          setMode]          = useState<"find" | "line">("find");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (mode !== "find" || !query) { onMatch([], 0); return; }
    onMatch(buildMatches(code, query, { caseSensitive, wholeWord, useRegex }), 0);
  }, [query, caseSensitive, wholeWord, useRegex, code, mode, onMatch]);

  const handleLineJump = useCallback((val: string) => {
    setLineJump(val);
    const n = parseInt(val, 10);
    if (!isNaN(n)) onMatch([{ line: Math.max(0, n - 1), col: 0, len: 0 }], 0);
  }, [onMatch]);

  const TogBtn = ({ label, active, title, onClick }: { label: string; active: boolean; title: string; onClick: () => void }) => (
    <button title={title} onClick={onClick} style={{
      border: `1px solid ${active ? C.borderHi : C.border}`,
      background: active ? C.bg4 : "transparent",
      color: active ? C.t0 : C.t2, borderRadius: 4,
      fontSize: 10, fontFamily: MONO, fontWeight: 700,
      padding: "1px 6px", cursor: "pointer", transition: "all .1s",
      lineHeight: "18px", flexShrink: 0,
    }}>{label}</button>
  );

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", background: C.bg1, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
      <div style={{ display: "flex", background: C.bg2, borderRadius: 6, padding: 2, gap: 1, flexShrink: 0 }}>
        {(["find", "line"] as const).map(m => (
          <button key={m} onClick={() => { setMode(m); onMatch([], 0); }} style={{ padding: "2px 8px", borderRadius: 4, border: "none", background: mode === m ? C.bg4 : "transparent", color: mode === m ? C.t0 : C.t3, fontSize: 10, fontFamily: MONO, cursor: "pointer", transition: "all .1s" }}>
            {m === "line" ? "Line" : "Find"}
          </button>
        ))}
      </div>

      {mode === "find" ? (
        <>
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 8px" }}>
            <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.shiftKey ? onPrev() : onNext(); } if (e.key === "Escape") onClose(); }}
              placeholder="Search… (Enter ↵  Shift+Enter ↑)"
              style={{ flex: 1, background: "none", border: "none", outline: "none", color: C.t0, fontSize: 12, fontFamily: MONO, caretColor: "#00e5ff" }} />
            {query && <span style={{ fontSize: 10, fontFamily: MONO, color: C.t3, flexShrink: 0, whiteSpace: "nowrap" }}>{matchCount === 0 ? "no matches" : `${activeMatch + 1}/${matchCount}`}</span>}
            {query && <button onClick={() => { setQuery(""); onMatch([], 0); }} style={{ background: "none", border: "none", cursor: "pointer", color: C.t3, padding: 2, display: "flex", alignItems: "center" }}><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>}
          </div>
          <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
            <TogBtn label="Aa" title="Case sensitive" active={caseSensitive} onClick={() => setCaseSensitive(v => !v)} />
            <TogBtn label="\b" title="Whole word"     active={wholeWord}     onClick={() => setWholeWord(v => !v)}     />
            <TogBtn label=".*" title="Regex"          active={useRegex}      onClick={() => setUseRegex(v => !v)}      />
          </div>
          <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
            {[{ title: "Prev (Shift+Enter)", onClick: onPrev, d: "M18 15l-6-6-6 6" }, { title: "Next (Enter)", onClick: onNext, d: "M6 9l6 6 6-6" }].map(({ title, onClick, d }) => (
              <button key={title} title={title} onClick={onClick} style={{ width: 24, height: 24, border: `1px solid ${C.border}`, background: "transparent", borderRadius: 5, color: C.t2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all .1s" }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = C.bg3; el.style.color = C.t0; }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.color = C.t2; }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points={d}/></svg>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 10px" }}>
          <input ref={inputRef} value={lineJump} onChange={e => handleLineJump(e.target.value)} onKeyDown={e => { if (e.key === "Escape") onClose(); }}
            placeholder="Go to line…" type="number" min="1"
            style={{ flex: 1, background: "none", border: "none", outline: "none", color: C.t0, fontSize: 12, fontFamily: MONO, caretColor: "#00e5ff" }} />
          <span style={{ fontSize: 10, fontFamily: MONO, color: C.t3 }}>{lineJump ? `line ${lineJump}` : "type a number"}</span>
        </div>
      )}

      <button onClick={onClose} title="Close (Esc)" style={{ width: 22, height: 22, border: "none", background: "transparent", borderRadius: 4, cursor: "pointer", color: C.t3, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "color .1s" }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.t0}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.t3}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  );
}