// src/panels/FileStructurePanel.tsx
// File tree + in-project search panel (no editor logic here)
import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { C, MONO, SANS } from "../shared/constants";

interface FsEntry {
  name:   string;
  path:   string;
  is_dir: boolean;
  ext?:   string;
}

interface SearchMatch {
  path:      string;
  line:      number;
  col_start: number;
  col_end:   number;
  text:      string;
}

const iconBtn: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  padding: "1px 3px", borderRadius: 3,
  display: "flex", alignItems: "center", justifyContent: "center",
  transition: "color .1s",
};

export function fileColor(name: string, isDir: boolean): string {
  if (isDir) return "#c8d3e0";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "#3b82f6", tsx: "#3b82f6",
    js: "#f7c948", jsx: "#f7c948", mjs: "#f7c948",
    css: "#a78bfa", scss: "#a78bfa",
    html: "#f97316", htm: "#f97316",
    json: "#94a3b8", yaml: "#94a3b8", yml: "#94a3b8", toml: "#94a3b8",
    md: "#94a3b8", mdx: "#94a3b8",
    rs: "#f97316", py: "#3b82f6", go: "#22d3ee",
    sh: "#4ade80", bash: "#4ade80",
    png: "#ec4899", jpg: "#ec4899", jpeg: "#ec4899",
    svg: "#ec4899", gif: "#ec4899", webp: "#ec4899",
    lock: "#64748b", gitignore: "#64748b",
  };
  return map[ext] ?? "#8b9ab5";
}

export function FileIcon({ name, isDir, open }: { name: string; isDir: boolean; open?: boolean }) {
  const color = fileColor(name, isDir);
  if (isDir) return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      {open
        ? <path d="M5 19a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1M5 19h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2z"/>
        : <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      }
    </svg>
  );
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  );
}

function TBtn({ title, onClick, active, children }: {
  title: string; onClick: () => void; active?: boolean; children: React.ReactNode;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button title={title} onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        width: 26, height: 26, border: "none", cursor: "pointer",
        background: active ? "rgba(59,130,246,.18)" : hov ? "rgba(255,255,255,.08)" : "transparent",
        borderRadius: 6,
        color: active ? "#3b82f6" : hov ? "#e6edf3" : "rgba(255,255,255,.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "background .1s, color .1s", flexShrink: 0,
      }}>
      {children}
    </button>
  );
}

// ── Search pane ───────────────────────────────────────────────────────────────
function SearchPane({ root, onClose, onOpenFile }: {
  root: string; onClose: () => void; onOpenFile: (path: string) => void;
}) {
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

  const grouped = results.reduce<Record<string, SearchMatch[]>>((acc, m) => {
    (acc[m.path] ??= []).push(m);
    return acc;
  }, {});
  const fileCount  = Object.keys(grouped).length;
  const matchCount = results.length;

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setSearchErr(null); return; }
    setSearching(true); setSearchErr(null);
    try {
      const exts = filterExt.trim()
        ? filterExt.split(",").map(s => s.trim().replace(/^\./, "")).filter(Boolean)
        : [];
      const res = await invoke<SearchMatch[]>("fs_search_in_files", {
        root, query: q, caseSensitive, useRegex,
        includeExts: exts, excludeDirs: [],
      });
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
      const lines   = content.split("\n");
      const sorted  = [...matches].sort((a, b) => b.line - a.line || b.col_start - a.col_start);
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

  const doReplaceAll = async () => {
    for (const [fp, ms] of Object.entries(grouped)) await doReplaceInFile(fp, ms);
  };

  const toggleCollapse = (p: string) =>
    setCollapsed(prev => { const s = new Set(prev); s.has(p) ? s.delete(p) : s.add(p); return s; });

  const shortPath = (p: string) => {
    const rel = p.startsWith(root) ? p.slice(root.length).replace(/^[/\\]/, "") : p;
    return rel || p;
  };

  const highlight = (text: string, cs: number, ce: number) => {
    const pre  = text.slice(0, cs);
    const mid  = text.slice(cs, ce);
    const post = text.slice(ce);
    return (
      <span style={{ fontFamily: MONO, fontSize: 11, color: "#8b9ab5" }}>
        {pre.length > 40 ? "…" + pre.slice(-40) : pre}
        <mark style={{ background: "rgba(245,158,11,.28)", color: "#fbbf24", borderRadius: 2, padding: "0 1px" }}>{mid}</mark>
        {post.slice(0, 60)}{post.length > 60 ? "…" : ""}
      </span>
    );
  };

  const OptBtn = ({ label, active, title, onClick }: { label: string; active: boolean; title: string; onClick: () => void }) => (
    <button title={title} onClick={onClick} style={{
      border: `1px solid ${active ? "rgba(59,130,246,.5)" : "rgba(255,255,255,.08)"}`,
      background: active ? "rgba(59,130,246,.15)" : "transparent",
      color: active ? "#60a5fa" : "#8b9ab5", borderRadius: 4,
      fontSize: 10, fontFamily: MONO, fontWeight: 700,
      padding: "1px 6px", cursor: "pointer", transition: "all .12s",
      lineHeight: "18px",
    }}>
      {label}
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg1 }}>
      <div style={{ height: 40, flexShrink: 0, display: "flex", alignItems: "center", paddingInline: 12, borderBottom: `1px solid ${C.border}`, gap: 6 }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8b9ab5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <span style={{ flex: 1, fontSize: 11, fontWeight: 700, letterSpacing: ".12em", fontFamily: MONO, color: "#e6edf3", userSelect: "none" }}>SEARCH</span>
        <TBtn title="Toggle Replace" onClick={() => setShowReplace(v => !v)} active={showReplace}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </TBtn>
        <TBtn title="Back to files" onClick={onClose}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </TBtn>
      </div>

      <div style={{ padding: "10px 10px 6px", flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4, background: C.bg0, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 8px" }}>
          {searching
            ? <div style={{ width: 11, height: 11, border: "1.5px solid rgba(255,255,255,.15)", borderTopColor: "#3fb68b", borderRadius: "50%", animation: "fsp-spin .7s linear infinite", flexShrink: 0 }} />
            : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#4a5568" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0 }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          }
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Escape" && onClose()}
            placeholder="Search in files…"
            style={{ flex: 1, background: "none", border: "none", outline: "none", color: "#e6edf3", fontSize: 12, fontFamily: MONO, caretColor: "#3b82f6" }} />
          {query && (
            <button onClick={() => { setQuery(""); setResults([]); }}
              style={{ ...iconBtn, color: "#4a5568", padding: 2 }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#8b9ab5"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "#4a5568"}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          )}
          <div style={{ display: "flex", gap: 3, marginLeft: 2 }}>
            <OptBtn label="Aa" title="Case sensitive" active={caseSensitive} onClick={() => setCaseSensitive(v => !v)} />
            <OptBtn label=".*" title="Use regex"      active={useRegex}      onClick={() => setUseRegex(v => !v)}      />
          </div>
        </div>

        {showReplace && (
          <div style={{ display: "flex", gap: 4 }}>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, background: C.bg0, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 8px" }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#4a5568" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              <input value={replace} onChange={e => setReplace(e.target.value)} placeholder="Replace with…"
                style={{ flex: 1, background: "none", border: "none", outline: "none", color: "#e6edf3", fontSize: 12, fontFamily: MONO, caretColor: "#3b82f6" }} />
            </div>
            <button onClick={doReplaceAll} disabled={!results.length || replacing !== null} title="Replace all"
              style={{ border: "1px solid rgba(59,130,246,.35)", background: "rgba(59,130,246,.12)", color: results.length ? "#60a5fa" : "#4a5568", borderRadius: 6, fontSize: 11, fontFamily: MONO, fontWeight: 600, padding: "0 10px", cursor: results.length ? "pointer" : "default", opacity: results.length ? 1 : 0.5, transition: "all .12s", whiteSpace: "nowrap" }}>
              Replace All
            </button>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 6, background: C.bg0, border: `1px solid ${C.border}`, borderRadius: 6, padding: "3px 8px" }}>
          <span style={{ fontSize: 10, fontFamily: MONO, color: "#4a5568", userSelect: "none", whiteSpace: "nowrap" }}>ext</span>
          <input value={filterExt} onChange={e => setFilterExt(e.target.value)} placeholder="ts, rs, py …"
            style={{ flex: 1, background: "none", border: "none", outline: "none", color: "#8b9ab5", fontSize: 11, fontFamily: MONO, caretColor: "#3b82f6" }} />
        </div>

        {query.trim() && !searching && !searchErr && (
          <span style={{ fontSize: 10, fontFamily: MONO, color: "#4a5568", paddingInline: 2 }}>
            {matchCount === 0 ? "No results" : `${matchCount.toLocaleString()} match${matchCount !== 1 ? "es" : ""} in ${fileCount} file${fileCount !== 1 ? "s" : ""}`}
            {matchCount >= 2000 && <span style={{ color: "#f59e0b" }}> — limit reached</span>}
          </span>
        )}
        {searchErr && <span style={{ fontSize: 10, fontFamily: MONO, color: "#ef4444", paddingInline: 2 }}>{searchErr}</span>}
      </div>

      <div style={{ flex: 1, overflowY: "auto", paddingBottom: 12 }}>
        {Object.entries(grouped).map(([filePath, matches]) => {
          const isCollapsed = collapsed.has(filePath);
          const short       = shortPath(filePath);
          const fName       = short.replace(/\\/g, "/").split("/").pop() ?? short;
          const fDir        = short.includes("/") ? short.replace(/\\/g, "/").split("/").slice(0, -1).join("/") : "";
          const isReplacing = replacing === filePath;
          return (
            <div key={filePath} style={{ marginBottom: 2 }}>
              <div onClick={() => toggleCollapse(filePath)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px 5px 8px", cursor: "pointer", background: "rgba(255,255,255,.025)", borderTop: `1px solid ${C.border}`, userSelect: "none" }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#8b9ab5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  style={{ transform: isCollapsed ? "rotate(0deg)" : "rotate(90deg)", transition: "transform .15s", flexShrink: 0 }}>
                  <polyline points="9 6 15 12 9 18"/>
                </svg>
                <FileIcon name={fName} isDir={false} />
                <span style={{ fontSize: 12, fontFamily: MONO, color: "#c8d3e0", fontWeight: 500 }}>{fName}</span>
                {fDir && <span style={{ fontSize: 10, fontFamily: MONO, color: "#4a5568", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{fDir}</span>}
                <span style={{ fontSize: 10, fontFamily: MONO, color: "#3b82f6", background: "rgba(59,130,246,.12)", borderRadius: 10, padding: "0 6px", lineHeight: "16px", flexShrink: 0 }}>{matches.length}</span>
                {showReplace && (
                  <button onClick={e => { e.stopPropagation(); doReplaceInFile(filePath, matches); }} disabled={isReplacing} title="Replace in this file"
                    style={{ border: "none", background: "rgba(255,255,255,.06)", color: "#8b9ab5", borderRadius: 4, fontSize: 10, fontFamily: MONO, padding: "1px 6px", cursor: "pointer", flexShrink: 0 }}>
                    {isReplacing ? "…" : "replace"}
                  </button>
                )}
              </div>
              {!isCollapsed && matches.map((m, i) => (
                <div key={i} onClick={() => onOpenFile(m.path)}
                  style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "3px 10px 3px 28px", cursor: "pointer", transition: "background .08s" }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(54,69,79,.4)"}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}>
                  <span style={{ fontSize: 10, fontFamily: MONO, color: "#3a4a58", flexShrink: 0, width: 28, textAlign: "right" }}>{m.line}</span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{highlight(m.text, m.col_start, m.col_end)}</span>
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

// ── Create input inline ───────────────────────────────────────────────────────
function CreateInput({ parentPath, type, depth = 0, onDone }: {
  parentPath: string; type: "file" | "folder"; depth?: number; onDone: () => void;
}) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) { onDone(); return; }
    const sep = parentPath.includes("\\") ? "\\" : "/";
    try {
      if (type === "folder") await invoke("fs_create_dir",  { path: `${parentPath}${sep}${trimmed}` });
      else                   await invoke("fs_create_file", { path: `${parentPath}${sep}${trimmed}` });
    } catch (e) { alert(`Create failed: ${e}`); }
    onDone();
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 8 + depth * 14 + 28, paddingRight: 8, paddingTop: 3, paddingBottom: 3 }}>
      <FileIcon name={type === "folder" ? "folder" : (name || "file")} isDir={type === "folder"} />
      <input ref={inputRef} value={name} onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") submit(); if (e.key === "Escape") onDone(); }}
        onBlur={submit}
        placeholder={type === "folder" ? "folder name" : "file name"}
        style={{ flex: 1, background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.3)", borderRadius: 4, color: "#e6edf3", fontSize: 12, fontFamily: MONO, padding: "2px 7px", outline: "none" }}
      />
    </div>
  );
}

// ── Tree row ──────────────────────────────────────────────────────────────────
function TreeRow({ entry, depth, expanded, selected, onToggle, onSelect, onOpen }: {
  entry: FsEntry; depth: number; expanded: boolean; selected: boolean;
  onToggle: () => void; onSelect: () => void; onOpen: () => void;
}) {
  const [hov, setHov] = useState(false);
  const color = fileColor(entry.name, entry.is_dir);
  return (
    <div
      onClick={() => { onSelect(); if (entry.is_dir) onToggle(); else onOpen(); }}
      onDoubleClick={() => { if (!entry.is_dir) onOpen(); }}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ display: "flex", alignItems: "center", paddingLeft: 8 + depth * 14, paddingRight: 8, height: 26, cursor: "pointer", borderRadius: 6, background: selected ? "#2630377e" : hov ? "rgba(54,69,79,.45)" : "transparent", border: `1px solid ${selected ? "rgba(54,69,79,.8)" : "transparent"}`, transition: "background .08s", userSelect: "none", gap: 6 }}>
      <span style={{ width: 12, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {entry.is_dir && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#8b9ab5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform .15s" }}>
            <polyline points="9 6 15 12 9 18"/>
          </svg>
        )}
      </span>
      <FileIcon name={entry.name} isDir={entry.is_dir} open={expanded} />
      <span style={{ fontSize: 12, fontFamily: MONO, color: selected ? "#c8d3e0" : hov ? "#c8d3e0" : color, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, fontWeight: entry.is_dir ? 500 : 400, transition: "color .08s" }}>
        {entry.name}
      </span>
    </div>
  );
}

// ── Tree node (recursive) ─────────────────────────────────────────────────────
function TreeNode({ path, name, depth, selectedPath, onSelect, onOpen, creating, onCreatingDone }: {
  path: string; name: string; depth: number; selectedPath: string | null;
  onSelect: (path: string, isDir: boolean) => void; onOpen: (path: string) => void;
  creating?: "file" | "folder" | null; onCreatingDone?: () => void;
}) {
  const [open,     setOpen]     = useState(depth === 0);
  const [children, setChildren] = useState<FsEntry[] | null>(null);
  const [loading,  setLoading]  = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const entries = await invoke<FsEntry[]>("fs_list_dir", { path });
      setChildren([...entries].sort((a, b) => {
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      }));
    } catch { setChildren([]); }
    finally { setLoading(false); }
  }, [path]);

  useEffect(() => { if (open) load(); }, []);

  const toggle = () => { if (!open && children === null) load(); setOpen(v => !v); };
  const showRootCreate = depth === 0 && creating && onCreatingDone;

  return (
    <>
      <TreeRow entry={{ name, path, is_dir: true }} depth={depth} expanded={open} selected={selectedPath === path}
        onToggle={toggle} onSelect={() => onSelect(path, true)} onOpen={() => {}} />
      {open && (
        <>
          {loading && (
            <div style={{ paddingLeft: 8 + (depth + 1) * 14 + 30, height: 24, display: "flex", alignItems: "center" }}>
              <div style={{ width: 10, height: 10, border: "1.5px solid rgba(255,255,255,.15)", borderTopColor: "#3fb68b", borderRadius: "50%", animation: "fsp-spin .7s linear infinite" }} />
            </div>
          )}
          {showRootCreate && (
            <CreateInput parentPath={path} type={creating!} depth={depth + 1}
              onDone={() => { onCreatingDone!(); load(); }} />
          )}
          {!loading && children?.map(child =>
            child.is_dir
              ? <TreeNode key={child.path} path={child.path} name={child.name} depth={depth + 1}
                  selectedPath={selectedPath} onSelect={onSelect} onOpen={onOpen} />
              : <TreeRow key={child.path} entry={child} depth={depth + 1} expanded={false}
                  selected={selectedPath === child.path} onToggle={() => {}}
                  onSelect={() => onSelect(child.path, false)} onOpen={() => onOpen(child.path)} />
          )}
          {!loading && children?.length === 0 && !showRootCreate && (
            <div style={{ paddingLeft: 8 + (depth + 1) * 14 + 30, height: 22, display: "flex", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "#4a5568", fontFamily: SANS, fontStyle: "italic" }}>empty</span>
            </div>
          )}
        </>
      )}
    </>
  );
}

// ── FileStructurePanel (default export) ───────────────────────────────────────
export default function FileStructurePanel({ cwd, onClose, onOpenFile }: {
  cwd: string; onClose: () => void; onOpenFile: (path: string) => void;
}) {
  const [selected,   setSelected]   = useState<string | null>(null);
  const [rootName,   setRootName]   = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [creating,   setCreating]   = useState<"file" | "folder" | null>(null);
  const [searching,  setSearching]  = useState(false);

  useEffect(() => {
    const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
    setRootName(parts[parts.length - 1] ?? cwd);
  }, [cwd]);

  const handleOpen = (path: string) => {
    setSelected(path);
    setSearching(false);
    onOpenFile(path);
  };

  if (searching) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg1 }}>
        <SearchPane root={cwd} onClose={() => setSearching(false)} onOpenFile={handleOpen} />
        <style>{`@keyframes fsp-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg1 }}>
      {/* Header */}
      <div style={{ height: 40, flexShrink: 0, display: "flex", alignItems: "center", padding: "0 8px 0 12px", borderBottom: `1px solid ${C.border}`, gap: 4 }}>
        <span style={{ flex: 1, fontSize: 11, fontWeight: 700, letterSpacing: ".12em", fontFamily: MONO, color: "#e6edf3", userSelect: "none" }}>
          FILES
        </span>

        {/* New File */}
        <TBtn title="New File" onClick={() => setCreating("file")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h7"/>
            <polyline points="12 2 12 8 18 8"/>
            <line x1="18" y1="14" x2="18" y2="20" strokeWidth="2"/>
            <line x1="15" y1="17" x2="21" y2="17" strokeWidth="2"/>
          </svg>
        </TBtn>

        {/* New Folder */}
        <TBtn title="New Folder" onClick={() => setCreating("folder")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v2"/>
            <path d="M3 7v11a2 2 0 0 0 2 2h7"/>
            <line x1="18" y1="14" x2="18" y2="20" strokeWidth="2"/>
            <line x1="15" y1="17" x2="21" y2="17" strokeWidth="2"/>
          </svg>
        </TBtn>

        {/* Search */}
        <TBtn title="Search in files" onClick={() => setSearching(true)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </TBtn>

        {/* Refresh */}
        <TBtn title="Refresh" onClick={() => setRefreshKey(k => k + 1)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
        </TBtn>

        {/* Close */}
        <TBtn title="Close" onClick={onClose}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </TBtn>
      </div>

      {/* Tree */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 4px 12px" }}>
        <TreeNode
          key={`${cwd}-${refreshKey}`}
          path={cwd} name={rootName} depth={0}
          selectedPath={selected}
          onSelect={(p, _) => setSelected(p)}
          onOpen={handleOpen}
          creating={creating}
          onCreatingDone={() => { setCreating(null); setRefreshKey(k => k + 1); }}
        />
      </div>

      <style>{`@keyframes fsp-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}