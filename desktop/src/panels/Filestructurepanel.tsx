// src/panels/FileStructurePanel.tsx
import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
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

const COLOR_ROOT_FOLDER = "#7dd3fc";
const COLOR_SUB_FOLDER  = "#93c5fd";
const COLOR_FILE        = "#e2e8f0";

export function fileColor(name: string, isDir: boolean, depth?: number): string {
  if (isDir) return depth === 0 ? COLOR_ROOT_FOLDER : COLOR_SUB_FOLDER;
  return COLOR_FILE;
}

export function FileIcon({ name, isDir, open, depth }: {
  name: string; isDir: boolean; open?: boolean; depth?: number;
}) {
  const color = fileColor(name, isDir, depth);
  if (isDir) return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      {open
        ? <path d="M5 19a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1M5 19h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2z"/>
        : <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      }
    </svg>
  );
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={COLOR_FILE} strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
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

// ── Context menu ──────────────────────────────────────────────────────────────
type CtxMenuItem =
  | { label: string; shortcut?: string; danger?: boolean; onClick: () => void }
  | "separator";

interface CtxMenuState { x: number; y: number; entry: FsEntry; }

function CtxMenu({ menu, onClose, items }: {
  menu: CtxMenuState; onClose: () => void; items: CtxMenuItem[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => { const t = setTimeout(() => setVisible(true), 10); return () => clearTimeout(t); }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey  = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const t = setTimeout(() => {
      document.addEventListener("mousedown", onDown);
      document.addEventListener("keydown", onKey);
    }, 50);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const APPROX_W  = 175;
  const ITEM_H    = 28;
  const SEP_H     = 7;
  const PAD_V     = 4;
  const itemCount = items.filter(i => i !== "separator").length;
  const sepCount  = items.filter(i => i === "separator").length;
  const estH      = PAD_V * 2 + itemCount * ITEM_H + sepCount * SEP_H;
  const x = Math.min(menu.x, window.innerWidth  - APPROX_W - 8);
  const y = Math.min(menu.y, window.innerHeight - estH - 8);

  return createPortal(
    <div ref={ref} onClick={e => e.stopPropagation()} style={{
      position: "fixed", top: y, left: x, zIndex: 99999,
      minWidth: APPROX_W,
      background: "rgba(18,20,24,0.96)",
      backdropFilter: "blur(28px) saturate(180%)",
      WebkitBackdropFilter: "blur(28px) saturate(180%)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 9, padding: "4px",
      boxShadow: "0 24px 64px rgba(0,0,0,.75), 0 4px 16px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.06)",
      fontFamily: SANS, userSelect: "none",
      opacity: visible ? 1 : 0,
      transform: visible ? "scale(1) translateY(0)" : "scale(0.95) translateY(-6px)",
      transformOrigin: "top left",
      transition: "opacity .14s ease, transform .14s cubic-bezier(.16,1,.3,1)",
    }}>
      <div style={{ padding: "3px 10px 5px", fontSize: 9, fontFamily: MONO, fontWeight: 700, letterSpacing: ".1em", color: "rgba(255,255,255,.22)", userSelect: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {menu.entry.name.toUpperCase()}
      </div>
      <div style={{ height: 1, background: "rgba(255,255,255,.07)", marginBottom: 3 }} />
      {items.map((item, i) =>
        item === "separator"
          ? <div key={i} style={{ height: 1, background: "rgba(255,255,255,.07)", margin: "3px 0" }} />
          : <CtxItem key={item.label} {...item} onClose={onClose} />
      )}
    </div>,
    document.body,
  );
}

function CtxItem({ label, shortcut, danger, onClick, onClose }: {
  label: string; shortcut?: string; danger?: boolean; onClick: () => void; onClose: () => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <div onClick={() => { onClick(); onClose(); }}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", alignItems: "center", padding: "0 10px",
        height: 28, borderRadius: 6, cursor: "pointer",
        background: hov ? (danger ? "rgba(239,68,68,.18)" : "rgba(255,255,255,.08)") : "transparent",
        color: danger ? (hov ? "#fca5a5" : "#f87171") : (hov ? "#ffffff" : "rgba(255,255,255,.78)"),
        transition: "background .08s, color .08s", userSelect: "none", whiteSpace: "nowrap", gap: 8,
      }}>
      <span style={{ fontSize: 12, fontFamily: SANS, fontWeight: 450, flex: 1 }}>{label}</span>
      {shortcut && <span style={{ fontSize: 10, fontFamily: MONO, color: hov ? "rgba(255,255,255,.35)" : "rgba(255,255,255,.2)" }}>{shortcut}</span>}
    </div>
  );
}

// ── Delete confirm modal ──────────────────────────────────────────────────────
function DeleteConfirmModal({ entry, onConfirm, onCancel }: {
  entry: FsEntry; onConfirm: () => void; onCancel: () => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { btnRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.55)" }}
      onClick={onCancel}>
      <div style={{ background: "#252526", border: "1px solid #454545", borderRadius: 8, padding: "20px 24px", minWidth: 340, maxWidth: 440, display: "flex", flexDirection: "column", gap: 14, boxShadow: "0 12px 40px rgba(0,0,0,.7)" }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(239,68,68,.15)", border: "1px solid rgba(239,68,68,.3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
            </svg>
          </div>
          <span style={{ fontSize: 14, color: "#cccccc", fontWeight: 600 }}>Delete {entry.is_dir ? "Folder" : "File"}</span>
        </div>
        <div style={{ fontSize: 13, color: "#999", lineHeight: 1.6 }}>
          Are you sure you want to delete <span style={{ color: "#e6edf3", fontFamily: MONO, fontWeight: 500 }}>"{entry.name}"</span>?
          {entry.is_dir && <div style={{ marginTop: 6, color: "#f48771", fontSize: 12 }}>⚠ This will permanently delete the folder and all its contents.</div>}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 2 }}>
          <button onClick={onCancel}
            style={{ background: "transparent", border: "1px solid #454545", borderRadius: 5, color: "#cccccc", fontSize: 12, padding: "6px 18px", cursor: "pointer" }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,.07)"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}>Cancel</button>
          <button ref={btnRef} onClick={onConfirm}
            style={{ background: "rgba(239,68,68,.18)", border: "1px solid rgba(239,68,68,.4)", borderRadius: 5, color: "#f87171", fontSize: 12, fontWeight: 600, padding: "6px 18px", cursor: "pointer" }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,.32)"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,.18)"}>Delete</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Search pane ───────────────────────────────────────────────────────────────
function SearchPane({ root, onClose, onOpenFile }: {
  root: string; onClose: () => void; onOpenFile: (path: string) => void;
}) {
  const [query, setQuery]                 = useState("");
  const [replace, setReplace]             = useState("");
  const [showReplace, setShowReplace]     = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex]           = useState(false);
  const [filterExt, setFilterExt]         = useState("");
  const [results, setResults]             = useState<SearchMatch[]>([]);
  const [searching, setSearching]         = useState(false);
  const [searchErr, setSearchErr]         = useState<string | null>(null);
  const [collapsed, setCollapsed]         = useState<Set<string>>(new Set());
  const [replacing, setReplacing]         = useState<string | null>(null);
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

  const doReplaceAll = async () => { for (const [fp, ms] of Object.entries(grouped)) await doReplaceInFile(fp, ms); };
  const toggleCollapse = (p: string) => setCollapsed(prev => { const s = new Set(prev); s.has(p) ? s.delete(p) : s.add(p); return s; });
  const shortPath = (p: string) => { const rel = p.startsWith(root) ? p.slice(root.length).replace(/^[/\\]/, "") : p; return rel || p; };

  const highlight = (text: string, cs: number, ce: number) => {
    const pre = text.slice(0, cs), mid = text.slice(cs, ce), post = text.slice(ce);
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
      padding: "1px 6px", cursor: "pointer", transition: "all .12s", lineHeight: "18px",
    }}>{label}</button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg1 }}>
      <div style={{ height: 40, flexShrink: 0, display: "flex", alignItems: "center", paddingInline: 12, borderBottom: `1px solid ${C.border}`, gap: 6 }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8b9ab5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <span style={{ flex: 1, fontSize: 11, fontWeight: 700, letterSpacing: ".12em", fontFamily: MONO, color: "#e6edf3", userSelect: "none" }}>SEARCH</span>
        <TBtn title="Toggle Replace" onClick={() => setShowReplace(v => !v)} active={showReplace}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </TBtn>
        <TBtn title="Back to files" onClick={onClose}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </TBtn>
      </div>
      <div style={{ padding: "10px 10px 6px", flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 }}>

        {/* ── Search input + Aa/.* buttons stacked ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, background: C.bg0, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 8px" }}>
            {searching
              ? <div style={{ width: 11, height: 11, border: "1.5px solid rgba(255,255,255,.15)", borderTopColor: "#3fb68b", borderRadius: "50%", animation: "fsp-spin .7s linear infinite", flexShrink: 0 }} />
              : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#4a5568" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0 }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            }
            <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === "Escape" && onClose()} placeholder="Search in files…"
              style={{ flex: 1, background: "none", border: "none", outline: "none", color: "#e6edf3", fontSize: 12, fontFamily: MONO, caretColor: "#3b82f6" }} />
            {query && (
              <button onClick={() => { setQuery(""); setResults([]); }} style={{ ...iconBtn, color: "#4a5568", padding: 2 }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#8b9ab5"}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "#4a5568"}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: 3 }}>
            <OptBtn label="Aa" title="Case sensitive" active={caseSensitive} onClick={() => setCaseSensitive(v => !v)} />
            <OptBtn label=".*" title="Use regex" active={useRegex} onClick={() => setUseRegex(v => !v)} />
          </div>
        </div>

        {showReplace && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, background: C.bg0, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 8px" }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#4a5568" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              <input value={replace} onChange={e => setReplace(e.target.value)} placeholder="Replace with…"
                style={{ flex: 1, background: "none", border: "none", outline: "none", color: "#e6edf3", fontSize: 12, fontFamily: MONO, caretColor: "#3b82f6" }} />
            </div>
            <button onClick={doReplaceAll} disabled={!results.length || replacing !== null}
              style={{ width: "100%", border: "1px solid rgba(59,130,246,.35)", background: "rgba(59,130,246,.12)", color: results.length ? "#60a5fa" : "#4a5568", borderRadius: 6, fontSize: 11, fontFamily: MONO, fontWeight: 600, padding: "0 10px", cursor: results.length ? "pointer" : "default", opacity: results.length ? 1 : 0.5, transition: "all .12s", whiteSpace: "nowrap", height: 28 }}>
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
          const isCollapsed  = collapsed.has(filePath);
          const short = shortPath(filePath);
          const fName = short.replace(/\\/g, "/").split("/").pop() ?? short;
          const fDir  = short.includes("/") ? short.replace(/\\/g, "/").split("/").slice(0, -1).join("/") : "";
          const isReplacing = replacing === filePath;
          return (
            <div key={filePath} style={{ marginBottom: 2 }}>
              <div onClick={() => toggleCollapse(filePath)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px 5px 8px", cursor: "pointer", background: "rgba(255,255,255,.025)", borderTop: `1px solid ${C.border}`, userSelect: "none" }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#8b9ab5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  style={{ transform: isCollapsed ? "rotate(0deg)" : "rotate(90deg)", transition: "transform .15s", flexShrink: 0 }}>
                  <polyline points="9 6 15 12 9 18"/>
                </svg>
                <FileIcon name={fName} isDir={false} />
                <span style={{ fontSize: 12, fontFamily: SANS, color: "#c8d3e0", fontWeight: 500 }}>{fName}</span>
                {fDir && <span style={{ fontSize: 10, fontFamily: MONO, color: "#4a5568", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{fDir}</span>}
                <span style={{ fontSize: 10, fontFamily: MONO, color: "#3b82f6", background: "rgba(59,130,246,.12)", borderRadius: 10, padding: "0 6px", lineHeight: "16px", flexShrink: 0 }}>{matches.length}</span>
                {showReplace && (
                  <button onClick={e => { e.stopPropagation(); doReplaceInFile(filePath, matches); }} disabled={isReplacing}
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

// ── Create input ──────────────────────────────────────────────────────────────
function CreateInput({ parentPath, type, depth = 0, onDone, onCancel }: {
  parentPath: string; type: "file" | "folder"; depth?: number;
  onDone: () => void; onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const inputRef    = useRef<HTMLInputElement>(null);
  const wrapperRef  = useRef<HTMLDivElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) onCancel(); };
    const t = setTimeout(() => document.addEventListener("mousedown", handler), 100);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", handler); };
  }, [onCancel]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) { onCancel(); return; }
    const sep = parentPath.includes("\\") ? "\\" : "/";
    try {
      if (type === "folder") await invoke("fs_create_dir",  { path: `${parentPath}${sep}${trimmed}` });
      else                   await invoke("fs_create_file", { path: `${parentPath}${sep}${trimmed}` });
    } catch (e) { alert(`Create failed: ${e}`); }
    onDone();
  };

  return (
    <div ref={wrapperRef} style={{ display: "flex", alignItems: "center", gap: 5, paddingLeft: 8 + depth * 14 + 18, paddingRight: 8, paddingTop: 2, paddingBottom: 2, background: "rgba(9,71,113,.25)" }}>
      <FileIcon name={type === "folder" ? "folder" : (name || "file")} isDir={type === "folder"} depth={depth} />
      <input ref={inputRef} value={name} onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") submit(); if (e.key === "Escape") onCancel(); }}
        placeholder={type === "folder" ? "folder name" : "file name"}
        style={{ flex: 1, background: "#3c3c3c", border: "1px solid #007fd4", borderRadius: 3, color: "#cccccc", fontSize: 12, fontFamily: MONO, padding: "1px 6px", outline: "none", height: 20 }} />
    </div>
  );
}

// ── Tree row ──────────────────────────────────────────────────────────────────
function TreeRow({ entry, depth, expanded, selected, onToggle, onSelect, onOpen, onContextMenu }: {
  entry: FsEntry; depth: number; expanded: boolean; selected: boolean;
  onToggle: () => void; onSelect: () => void; onOpen: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const [hov, setHov] = useState(false);
  const color = fileColor(entry.name, entry.is_dir, depth);
  return (
    <div
      onClick={e => { e.stopPropagation(); onSelect(); if (entry.is_dir) onToggle(); else onOpen(); }}
      onDoubleClick={e => { e.stopPropagation(); if (!entry.is_dir) onOpen(); }}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", alignItems: "center",
        paddingLeft: 8 + depth * 14, paddingRight: 8,
        height: 22, cursor: "pointer",
        background: selected ? "rgba(9,71,113,.7)" : hov ? "rgba(54,69,79,.45)" : "transparent",
        userSelect: "none", gap: 5,
      }}>
      <span style={{ width: 12, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {entry.is_dir && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#c8d3e0" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform .12s" }}>
            <polyline points="9 6 15 12 9 18"/>
          </svg>
        )}
      </span>
      <FileIcon name={entry.name} isDir={entry.is_dir} open={expanded} depth={depth} />
      <span style={{
        fontSize: 12.5, fontFamily: SANS,
        letterSpacing: entry.is_dir ? "0.01em" : "normal",
        color: selected ? "#ffffff" : hov ? "#e6edf3" : color,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
        fontWeight: entry.is_dir ? 600 : 400,
        transition: "color .08s",
      }}>
        {entry.name}
      </span>
    </div>
  );
}

// ── Tree node ─────────────────────────────────────────────────────────────────
function TreeNode({
  path, name, depth, selectedPath, onSelect, onOpen,
  creatingIn, onCreatingDone, onCreatingCancel, onContextMenu,
  refreshKey,  // ← NEW: passed down to trigger reload without remounting
}: {
  path: string; name: string; depth: number; selectedPath: string | null;
  onSelect: (path: string, isDir: boolean) => void; onOpen: (path: string) => void;
  creatingIn?: { type: "file" | "folder"; parentPath: string } | null;
  onCreatingDone?: () => void; onCreatingCancel?: () => void;
  onContextMenu: (e: React.MouseEvent, entry: FsEntry) => void;
  refreshKey?: number;
}) {
  const [open, setOpen]         = useState(depth === 0);
  const [children, setChildren] = useState<FsEntry[] | null>(null);
  const [loading, setLoading]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const entries = await invoke<FsEntry[]>("fs_list_dir", { path });
      const sorted = [...entries].sort((a, b) => {
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });
      // FIX: update children in-place instead of setting null first.
      // Setting null causes child TreeNodes to unmount, losing their open state.
      setChildren(sorted);
    } catch { setChildren([]); }
    finally { setLoading(false); }
  }, [path]);

  // ── FIX: reload in-place when refreshKey changes, without remounting ───────
  // Only reload if this folder is currently open — no point reloading hidden ones.
  useEffect(() => {
    if (refreshKey === undefined || refreshKey === 0) return;
    if (open) load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  useEffect(() => {
    if (creatingIn?.parentPath === path && !open) { setOpen(true); if (children === null) load(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creatingIn?.parentPath]);

  useEffect(() => { if (open && children === null) load(); }, [open]);

  const toggle = () => { if (!open && children === null) load(); setOpen(v => !v); };
  const showCreate = creatingIn?.parentPath === path;

  return (
    <>
      <TreeRow entry={{ name, path, is_dir: true }} depth={depth} expanded={open} selected={selectedPath === path}
        onToggle={toggle} onSelect={() => onSelect(path, true)} onOpen={() => {}}
        onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onContextMenu(e, { name, path, is_dir: true }); }} />
      {open && (
        <>
          {loading && children === null && (
            // Only show spinner on first load, not on refresh
            // (so existing tree stays visible while reloading)
            <div style={{ paddingLeft: 8 + (depth + 1) * 14 + 30, height: 22, display: "flex", alignItems: "center" }}>
              <div style={{ width: 10, height: 10, border: "1.5px solid rgba(255,255,255,.15)", borderTopColor: "#3fb68b", borderRadius: "50%", animation: "fsp-spin .7s linear infinite" }} />
            </div>
          )}
          {showCreate && (
            <CreateInput parentPath={path} type={creatingIn!.type} depth={depth + 1}
              onDone={() => { onCreatingDone?.(); load(); }} onCancel={() => onCreatingCancel?.()} />
          )}
          {children?.map(child =>
            child.is_dir
              ? <TreeNode key={child.path} path={child.path} name={child.name} depth={depth + 1}
                  selectedPath={selectedPath} onSelect={onSelect} onOpen={onOpen}
                  creatingIn={creatingIn} onCreatingDone={onCreatingDone} onCreatingCancel={onCreatingCancel}
                  onContextMenu={onContextMenu}
                  refreshKey={refreshKey} // ← pass down to all child nodes
                />
              : <TreeRow key={child.path} entry={child} depth={depth + 1} expanded={false}
                  selected={selectedPath === child.path} onToggle={() => {}}
                  onSelect={() => onSelect(child.path, false)} onOpen={() => onOpen(child.path)}
                  onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onContextMenu(e, child); }} />
          )}
          {!loading && (children?.length === 0) && !showCreate && (
            <div style={{ paddingLeft: 8 + (depth + 1) * 14 + 28, height: 22, display: "flex", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "#4a5568", fontFamily: SANS, fontStyle: "italic" }}>empty</span>
            </div>
          )}
        </>
      )}
    </>
  );
}

// ── FileStructurePanel ────────────────────────────────────────────────────────
export default function FileStructurePanel({ cwd, onClose, onOpenFile }: {
  cwd: string; onClose: () => void; onOpenFile: (path: string) => void;
}) {
  const [selected, setSelected]           = useState<string | null>(null);
  const [selectedIsDir, setSelectedIsDir] = useState(false);
  const [rootName, setRootName]           = useState("");
  const [refreshKey, setRefreshKey]       = useState(0);
  const [creating, setCreating]           = useState<{ type: "file" | "folder"; parentPath: string } | null>(null);
  const [searching, setSearching]         = useState(false);
  const [ctxMenu, setCtxMenu]             = useState<CtxMenuState | null>(null);
  const [renaming, setRenaming]           = useState<{ entry: FsEntry; value: string } | null>(null);
  const [deleting, setDeleting]           = useState<FsEntry | null>(null);

  const closeCtx = useCallback(() => setCtxMenu(null), []);
  const openCtx  = useCallback((e: React.MouseEvent, entry: FsEntry) => {
    e.preventDefault(); e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, entry });
  }, []);

  const getActiveDir = (): string => {
    if (!selected) return cwd;
    if (selectedIsDir) return selected;
    const parts = selected.replace(/\\/g, "/").split("/"); parts.pop(); return parts.join("/") || cwd;
  };
  const ctxTargetDir = (): string => {
    if (!ctxMenu) return cwd;
    if (ctxMenu.entry.is_dir) return ctxMenu.entry.path;
    const parts = ctxMenu.entry.path.replace(/\\/g, "/").split("/"); parts.pop(); return parts.join("/") || cwd;
  };

  const ctxCopyName     = () => navigator.clipboard.writeText(ctxMenu!.entry.name);
  const ctxCopyPath     = () => navigator.clipboard.writeText(ctxMenu!.entry.path);
  const ctxCopyContents = async () => {
    try { navigator.clipboard.writeText(await invoke<string>("read_text_file", { path: ctxMenu!.entry.path })); }
    catch (e) { alert(`Could not read file: ${e}`); }
  };
  const ctxNewFile   = () => setCreating({ type: "file",   parentPath: ctxTargetDir() });
  const ctxNewFolder = () => setCreating({ type: "folder", parentPath: ctxTargetDir() });
  const ctxRename    = () => setRenaming({ entry: ctxMenu!.entry, value: ctxMenu!.entry.name });
  const ctxDelete    = () => setDeleting(ctxMenu!.entry);

  const submitDelete = async () => {
    if (!deleting) return;
    const entry = deleting; setDeleting(null);
    try {
      await invoke("fs_delete", { path: entry.path, isDir: entry.is_dir });
      if (selected === entry.path) setSelected(null);
      setRefreshKey(k => k + 1);
    } catch (e) { alert(`Delete failed: ${e}`); }
  };

  const submitRename = async () => {
    if (!renaming) return;
    const trimmed = renaming.value.trim();
    if (!trimmed || trimmed === renaming.entry.name) { setRenaming(null); return; }
    const sep = renaming.entry.path.includes("\\") ? "\\" : "/";
    const parts = renaming.entry.path.replace(/\\/g, "/").split("/");
    parts[parts.length - 1] = trimmed;
    try { await invoke("fs_rename", { from: renaming.entry.path, to: parts.join(sep) }); setRefreshKey(k => k + 1); }
    catch (e) { alert(`Rename failed: ${e}`); }
    setRenaming(null);
  };

  const buildCtxItems = (entry: FsEntry): CtxMenuItem[] => [
    ...(entry.is_dir ? [
      { label: "New File",   onClick: ctxNewFile   } as const,
      { label: "New Folder", onClick: ctxNewFolder } as const,
      "separator" as const,
    ] : []),
    { label: "Copy",      onClick: ctxCopyName  },
    { label: "Copy Path", onClick: ctxCopyPath  },
    ...(!entry.is_dir ? [{ label: "Copy Contents", onClick: ctxCopyContents }] : []),
    "separator",
    { label: "Rename", onClick: ctxRename },
    { label: "Delete", danger: true, onClick: ctxDelete },
  ];

  useEffect(() => {
    const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
    setRootName(parts[parts.length - 1] ?? cwd);
  }, [cwd]);

  const handleOpen   = (path: string) => { setSelected(path); setSelectedIsDir(false); setSearching(false); onOpenFile(path); };
  const handleSelect = (path: string, isDir: boolean) => { setSelected(path); setSelectedIsDir(isDir); };

  if (searching) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg1 }}>
        <SearchPane root={cwd} onClose={() => setSearching(false)} onOpenFile={handleOpen} />
        <style>{`@keyframes fsp-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg1 }}
      onContextMenu={e => e.preventDefault()}>

      {/* Header */}
      <div style={{ height: 40, flexShrink: 0, display: "flex", alignItems: "center", padding: "0 8px 0 12px", borderBottom: `1px solid ${C.border}`, gap: 4 }}>
        <span style={{ flex: 1, fontSize: 11, fontWeight: 700, letterSpacing: ".12em", fontFamily: MONO, color: "#e6edf3", userSelect: "none" }}>FILES</span>
        <TBtn title="New File" onClick={() => { const dir = getActiveDir(); setCreating({ type: "file", parentPath: dir }); setSelected(dir); setSelectedIsDir(true); }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h7"/><polyline points="12 2 12 8 18 8"/>
            <line x1="18" y1="14" x2="18" y2="20" strokeWidth="2"/><line x1="15" y1="17" x2="21" y2="17" strokeWidth="2"/>
          </svg>
        </TBtn>
        <TBtn title="New Folder" onClick={() => { const dir = getActiveDir(); setCreating({ type: "folder", parentPath: dir }); setSelected(dir); setSelectedIsDir(true); }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v2"/><path d="M3 7v11a2 2 0 0 0 2 2h7"/>
            <line x1="18" y1="14" x2="18" y2="20" strokeWidth="2"/><line x1="15" y1="17" x2="21" y2="17" strokeWidth="2"/>
          </svg>
        </TBtn>
        <TBtn title="Search in files" onClick={() => setSearching(true)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </TBtn>
        <TBtn title="Refresh" onClick={() => setRefreshKey(k => k + 1)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
        </TBtn>
        <TBtn title="Close" onClick={onClose}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </TBtn>
      </div>

      {/* Tree — key is now just cwd, never changes on refresh */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0 12px" }}
        onClick={() => { setSelected(null); setSelectedIsDir(false); }}>
        <TreeNode
          key={cwd}
          path={cwd} name={rootName} depth={0}
          selectedPath={selected}
          onSelect={handleSelect} onOpen={handleOpen}
          creatingIn={creating}
          onCreatingDone={() => { setCreating(null); setRefreshKey(k => k + 1); }}
          onCreatingCancel={() => setCreating(null)}
          onContextMenu={openCtx}
          refreshKey={refreshKey}
        />
      </div>

      {/* Rename modal */}
      {renaming && createPortal(
        <div style={{ position: "fixed", inset: 0, zIndex: 9998, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.5)" }}
          onClick={() => setRenaming(null)}>
          <div style={{ background: "#252526", border: "1px solid #454545", borderRadius: 6, padding: "16px 20px", minWidth: 320, display: "flex", flexDirection: "column", gap: 12, boxShadow: "0 8px 32px rgba(0,0,0,.6)" }}
            onClick={e => e.stopPropagation()}>
            <span style={{ fontSize: 13, color: "#cccccc", fontWeight: 500 }}>Rename</span>
            <input autoFocus value={renaming.value}
              onChange={e => setRenaming(r => r ? { ...r, value: e.target.value } : r)}
              onKeyDown={e => { if (e.key === "Enter") submitRename(); if (e.key === "Escape") setRenaming(null); }}
              style={{ background: "#3c3c3c", border: "1px solid #007fd4", borderRadius: 3, color: "#cccccc", fontSize: 13, fontFamily: MONO, padding: "6px 10px", outline: "none" }} />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setRenaming(null)} style={{ background: "transparent", border: "1px solid #454545", borderRadius: 3, color: "#cccccc", fontSize: 12, padding: "5px 16px", cursor: "pointer" }}>Cancel</button>
              <button onClick={submitRename} style={{ background: "#0e639c", border: "none", borderRadius: 3, color: "#fff", fontSize: 12, padding: "5px 16px", cursor: "pointer" }}>Rename</button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {deleting && <DeleteConfirmModal entry={deleting} onConfirm={submitDelete} onCancel={() => setDeleting(null)} />}
      {ctxMenu  && <CtxMenu menu={ctxMenu} onClose={closeCtx} items={buildCtxItems(ctxMenu.entry)} />}
      <style>{`@keyframes fsp-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}