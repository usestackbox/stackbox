// features/files/FileSearch.tsx
import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { C, MONO, SANS } from "../../design";

interface SearchMatch { path: string; line: number; col_start: number; col_end: number; text: string; }

interface Props {
  root:       string;
  onClose:    () => void;
  onOpenFile: (path: string) => void;
}

function Highlight({ text, cs, ce }: { text: string; cs: number; ce: number }) {
  const pre = text.slice(0, cs), mid = text.slice(cs, ce), post = text.slice(ce);
  return (
    <span style={{ fontFamily: MONO, fontSize: 11, color: "#8b9ab5" }}>
      {pre.length > 40 ? "…" + pre.slice(-40) : pre}
      <mark style={{ background: "rgba(245,158,11,.28)", color: "#fbbf24", borderRadius: 2, padding: "0 1px" }}>{mid}</mark>
      {post.slice(0, 60)}{post.length > 60 ? "…" : ""}
    </span>
  );
}

function OptBtn({ label, active, title, onClick }: { label: string; active: boolean; title: string; onClick: () => void }) {
  return (
    <button title={title} onClick={onClick} style={{
      border: `1px solid ${active ? "rgba(59,130,246,.5)" : "rgba(255,255,255,.08)"}`,
      background: active ? "rgba(59,130,246,.15)" : "transparent",
      color: active ? "#60a5fa" : "#8b9ab5", borderRadius: 4,
      fontSize: 10, fontFamily: MONO, fontWeight: 700,
      padding: "1px 6px", cursor: "pointer", transition: "all .12s", lineHeight: "18px",
    }}>{label}</button>
  );
}

export function FileSearch({ root, onClose, onOpenFile }: Props) {
  const [query,         setQuery]         = useState("");
  const [replace,       setReplace]       = useState("");
  const [showReplace,   setShowReplace]   = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex,      setUseRegex]      = useState(false);
  const [filterExt,     setFilterExt]     = useState("");
  const [results,       setResults]       = useState<SearchMatch[]>([]);
  const [searching,     setSearching]     = useState(false);
  const [searchErr,     setSearchErr]     = useState<string | null>(null);
  const [collapsed,     setCollapsed]     = useState<Set<string>>(new Set());
  const [replacing,     setReplacing]     = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef    = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const grouped    = results.reduce<Record<string, SearchMatch[]>>((acc, m) => { (acc[m.path] ??= []).push(m); return acc; }, {});
  const fileCount  = Object.keys(grouped).length;
  const matchCount = results.length;

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setSearchErr(null); return; }
    setSearching(true); setSearchErr(null);
    try {
      const exts = filterExt.trim() ? filterExt.split(",").map(s => s.trim().replace(/^\./, "")).filter(Boolean) : [];
      const res = await invoke<SearchMatch[]>("fs_search_in_files", { root, query: q, caseSensitive, useRegex, includeExts: exts, excludeDirs: [] });
      setResults(res);
    } catch (e) { setSearchErr(String(e)); setResults([]); }
    finally { setSearching(false); }
  }, [root, caseSensitive, useRegex, filterExt]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query), 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, runSearch]);

  const doReplaceInFile = async (filePath: string, matches: SearchMatch[]) => {
    setReplacing(filePath);
    try {
      const content = await invoke<string>("read_text_file", { path: filePath });
      const lines = content.split("\n");
      const sorted = [...matches].sort((a, b) => b.line - a.line || b.col_start - a.col_start);
      for (const m of sorted) {
        const idx = m.line - 1;
        if (idx < 0 || idx >= lines.length) continue;
        lines[idx] = lines[idx].slice(0, m.col_start) + replace + lines[idx].slice(m.col_end);
      }
      await invoke("fs_write_file", { path: filePath, content: lines.join("\n") });
      setResults(prev => prev.filter(r => r.path !== filePath));
    } catch (e) { alert(`Replace failed: ${e}`); }
    finally { setReplacing(null); }
  };

  const shortPath = (p: string) => {
    const rel = p.startsWith(root) ? p.slice(root.length).replace(/^[/\\]/, "") : p;
    return rel || p;
  };

  const toggleCollapse = (p: string) =>
    setCollapsed(prev => { const s = new Set(prev); s.has(p) ? s.delete(p) : s.add(p); return s; });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg1 }}>
      {/* Header */}
      <div style={{ height: 40, flexShrink: 0, display: "flex", alignItems: "center", paddingInline: 12, borderBottom: `1px solid ${C.border}`, gap: 6 }}>
        <span style={{ flex: 1, fontSize: 11, fontWeight: 700, letterSpacing: ".12em", fontFamily: MONO, color: "#e6edf3", userSelect: "none" }}>SEARCH</span>
        <button onClick={() => setShowReplace(v => !v)}
          style={{ border: "none", background: showReplace ? "rgba(59,130,246,.15)" : "transparent", color: showReplace ? "#3b82f6" : "rgba(255,255,255,.55)", borderRadius: 6, width: 26, height: 26, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </button>
        <button onClick={onClose}
          style={{ border: "none", background: "transparent", color: "rgba(255,255,255,.55)", borderRadius: 6, width: 26, height: 26, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
      </div>

      {/* Controls */}
      <div style={{ padding: "10px 10px 6px", flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4, background: C.bg0, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 8px" }}>
          {searching
            ? <div style={{ width: 11, height: 11, border: "1.5px solid rgba(255,255,255,.15)", borderTopColor: "#3fb68b", borderRadius: "50%", animation: "fsp-spin .7s linear infinite", flexShrink: 0 }} />
            : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#4a5568" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0 }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          }
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search in files…"
            style={{ flex: 1, background: "none", border: "none", outline: "none", color: "#e6edf3", fontSize: 12, fontFamily: MONO }} />
        </div>
        <div style={{ display: "flex", gap: 3 }}>
          <OptBtn label="Aa" title="Case sensitive" active={caseSensitive} onClick={() => setCaseSensitive(v => !v)} />
          <OptBtn label=".*" title="Regex" active={useRegex} onClick={() => setUseRegex(v => !v)} />
        </div>

        {showReplace && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: C.bg0, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 8px" }}>
              <input value={replace} onChange={e => setReplace(e.target.value)} placeholder="Replace with…"
                style={{ flex: 1, background: "none", border: "none", outline: "none", color: "#e6edf3", fontSize: 12, fontFamily: MONO }} />
            </div>
            <button
              onClick={() => Object.entries(grouped).forEach(([fp, ms]) => doReplaceInFile(fp, ms))}
              disabled={!results.length}
              style={{ width: "100%", border: "1px solid rgba(59,130,246,.35)", background: "rgba(59,130,246,.12)", color: results.length ? "#60a5fa" : "#4a5568", borderRadius: 6, fontSize: 11, fontFamily: MONO, fontWeight: 600, padding: "0 10px", cursor: results.length ? "pointer" : "default", height: 28 }}>
              Replace All
            </button>
          </div>
        )}

        {query.trim() && !searching && !searchErr && (
          <span style={{ fontSize: 10, fontFamily: MONO, color: "#4a5568", paddingInline: 2 }}>
            {matchCount === 0 ? "No results" : `${matchCount} match${matchCount !== 1 ? "es" : ""} in ${fileCount} file${fileCount !== 1 ? "s" : ""}`}
          </span>
        )}
        {searchErr && <span style={{ fontSize: 10, fontFamily: MONO, color: "#ef4444", paddingInline: 2 }}>{searchErr}</span>}
      </div>

      {/* Results */}
      <div style={{ flex: 1, overflowY: "auto", paddingBottom: 12 }}>
        {Object.entries(grouped).map(([filePath, matches]) => {
          const isCollapsed = collapsed.has(filePath);
          const short = shortPath(filePath);
          const fName = short.replace(/\\/g, "/").split("/").pop() ?? short;
          const fDir  = short.includes("/") ? short.replace(/\\/g, "/").split("/").slice(0, -1).join("/") : "";
          return (
            <div key={filePath} style={{ marginBottom: 2 }}>
              <div
                onClick={() => toggleCollapse(filePath)}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px 5px 8px", cursor: "pointer", background: "rgba(255,255,255,.025)", borderTop: `1px solid ${C.border}`, userSelect: "none" }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#8b9ab5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  style={{ transform: isCollapsed ? "rotate(0deg)" : "rotate(90deg)", transition: "transform .15s", flexShrink: 0 }}>
                  <polyline points="9 6 15 12 9 18"/>
                </svg>
                <span style={{ fontSize: 12, fontFamily: SANS, color: "#c8d3e0", fontWeight: 500 }}>{fName}</span>
                {fDir && <span style={{ fontSize: 10, fontFamily: MONO, color: "#4a5568", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{fDir}</span>}
                <span style={{ fontSize: 10, fontFamily: MONO, color: "#3b82f6", background: "rgba(59,130,246,.12)", borderRadius: 10, padding: "0 6px" }}>{matches.length}</span>
              </div>
              {!isCollapsed && matches.map((m, i) => (
                <div key={i} onClick={() => onOpenFile(m.path)}
                  style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "3px 10px 3px 28px", cursor: "pointer" }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(54,69,79,.4)"}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}>
                  <span style={{ fontSize: 10, fontFamily: MONO, color: "#3a4a58", flexShrink: 0, width: 28, textAlign: "right" }}>{m.line}</span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <Highlight text={m.text} cs={m.col_start} ce={m.col_end} />
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <style>{`@keyframes fsp-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}