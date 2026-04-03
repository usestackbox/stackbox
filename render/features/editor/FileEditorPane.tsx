// features/editor/FileEditorPane.tsx
import { useState, useEffect, useCallback, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { C, MONO } from "../../design";
import { getHljs, extToLang, type HljsCore } from "./hljs";
import { injectTheme } from "./theme";
import { LiveEditor } from "./LiveEditor";
import { FindBar, buildMatches, type FindMatch } from "./FindBar";
import { StatusBar } from "./StatusBar";

// ── Icon button ───────────────────────────────────────────────────────────────
function IBtn({ children, title, onClick, disabled, active }: {
  children: React.ReactNode; title?: string; onClick: () => void; disabled?: boolean; active?: boolean;
}) {
  return (
    <button title={title} onClick={onClick} disabled={disabled}
      style={{ width: 28, height: 28, border: "none", borderRadius: 6, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.35 : 1, background: active ? "rgba(0,229,255,.15)" : "transparent", color: active ? "#00e5ff" : C.t1, transition: "all .1s" }}
      onMouseEnter={e => { if (!disabled) { const el = e.currentTarget as HTMLElement; el.style.background = active ? "rgba(0,229,255,.15)" : C.bg3; el.style.color = active ? "#00e5ff" : C.t0; }}}
      onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = active ? "rgba(0,229,255,.15)" : "transparent"; el.style.color = active ? "#00e5ff" : C.t1; }}>
      {children}
    </button>
  );
}

// ── FileIcon placeholder ──────────────────────────────────────────────────────
function FileIcon({ name }: { name: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  path:    string;
  onClose: () => void;
  style?:  CSSProperties;
}

export function FileEditorPane({ path, onClose, style }: Props) {
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

  // Auto-save 1 s after last keystroke
  useEffect(() => {
    if (!isDirty) return;
    const t = setTimeout(async () => {
      try { await invoke("fs_write_file", { path, content: draft }); setContent(draft); } catch { /* silent */ }
    }, 1000);
    return () => clearTimeout(t);
  }, [draft, isDirty, path]);

  async function handleSave() {
    if (!isDirty) return;
    try { await invoke("fs_write_file", { path, content: draft }); setContent(draft); }
    catch (e) { alert(`Save failed: ${e}`); }
  }

  const handleMatch = useCallback((matches: FindMatch[], active: number) => {
    setFindMatches(matches); setActiveMatch(active);
  }, []);

  const nextMatch = useCallback(() => setActiveMatch(v => findMatches.length ? (v + 1) % findMatches.length : 0), [findMatches.length]);
  const prevMatch = useCallback(() => setActiveMatch(v => findMatches.length ? (v - 1 + findMatches.length) % findMatches.length : 0), [findMatches.length]);

  const placeStyle: CSSProperties = { display: "flex", flexDirection: "column", flex: 1, alignItems: "center", justifyContent: "center", background: "#0b0e10", color: C.t3, fontFamily: MONO, fontSize: 13, gap: 8, ...style };

  if (error) return (
    <div style={placeStyle}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <span style={{ color: C.t2 }}>Failed to open file</span>
      <span style={{ fontSize: 11, color: C.t3, maxWidth: 320, textAlign: "center" }}>{error}</span>
    </div>
  );

  if (content === null) return (
    <div style={placeStyle}>
      <div style={{ width: 16, height: 16, border: `2px solid ${C.border}`, borderTopColor: C.t1, borderRadius: "50%", animation: "sb-spin .7s linear infinite" }} />
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, background: "#0b0e10", borderRadius: 10, overflow: "hidden", ...style }}>
      {/* Header */}
      <div style={{ height: 38, flexShrink: 0, display: "flex", alignItems: "center", gap: 6, padding: "0 6px 0 12px", background: C.bg1, borderBottom: `1px solid ${C.border}` }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: isDirty ? "#fbbf24" : "transparent", transition: "background .2s" }} />
        <FileIcon name={fileName} />
        <span style={{ flex: 1, fontSize: 12, fontFamily: MONO, color: C.t1, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fileName}</span>
        <span style={{ fontSize: 9, fontFamily: MONO, letterSpacing: ".06em", color: C.t1, background: C.bg3, border: `1px solid ${C.borderMd}`, borderRadius: 4, padding: "1px 7px", flexShrink: 0, textTransform: "uppercase" }}>{lang}</span>
        <IBtn title="Find (Ctrl+F)" onClick={() => setShowFind(v => !v)} active={showFind}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </IBtn>
        <IBtn title="Save (Ctrl+S)" onClick={handleSave} disabled={!isDirty}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
        </IBtn>
        <IBtn title="Close" onClick={onClose}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="4" y1="4" x2="20" y2="20"/><line x1="20" y1="4" x2="4" y2="20"/></svg>
        </IBtn>
      </div>

      {showFind && (
        <FindBar code={draft} onClose={() => { setShowFind(false); setFindMatches([]); setActiveMatch(0); }}
          onMatch={handleMatch} onNext={nextMatch} onPrev={prevMatch}
          matchCount={findMatches.length} activeMatch={activeMatch} />
      )}

      <LiveEditor key={path} code={draft} lang={lang} hljs={hljs} onChange={setDraft}
        findMatches={findMatches} activeMatch={activeMatch} style={{ flex: 1, minHeight: 0 }} />

      <StatusBar lang={lang} lines={draft.split("\n").length} chars={draft.length} isDirty={isDirty} />
    </div>
  );
}