/**
 * WorkspacePanel.tsx
 *
 * Always-editable editor with live syntax highlighting.
 * No mode toggle — view IS edit. Highlighted div sits behind transparent textarea.
 *
 * Toolbar:
 *   🔍 Find  — magnifying glass  (18 × 18, blue)
 *   💾 Save  — floppy disk       (18 × 18, green when dirty)
 *
 * Save button glows + turns green when there are unsaved changes.
 * A small amber dot next to the filename also signals dirty state.
 */

import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  CSSProperties,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileIcon } from "./Filestructurepanel";

// ─── highlight.js lazy singleton ─────────────────────────────────────────────

type HljsCore = typeof import("highlight.js").default;
let hljsPromise: Promise<HljsCore> | null = null;

function getHljs(): Promise<HljsCore> {
  if (hljsPromise) return hljsPromise;
  hljsPromise = (async () => {
    const { default: hljs } = await import("highlight.js/lib/core");
    const [
      { default: javascript },
      { default: typescript },
      { default: python },
      { default: css },
      { default: xml },
      { default: json },
      { default: bash },
      { default: markdown },
      { default: rust },
      { default: go },
      { default: java },
      { default: cpp },
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
    ]);
    hljs.registerLanguage("javascript", javascript);
    hljs.registerLanguage("js",  javascript);
    hljs.registerLanguage("jsx", javascript);
    hljs.registerLanguage("typescript", typescript);
    hljs.registerLanguage("ts",  typescript);
    hljs.registerLanguage("tsx", typescript);
    hljs.registerLanguage("python", python);
    hljs.registerLanguage("py",  python);
    hljs.registerLanguage("css", css);
    hljs.registerLanguage("html", xml);
    hljs.registerLanguage("xml",  xml);
    hljs.registerLanguage("json", json);
    hljs.registerLanguage("bash", bash);
    hljs.registerLanguage("sh",   bash);
    hljs.registerLanguage("markdown", markdown);
    hljs.registerLanguage("md",       markdown);
    hljs.registerLanguage("rust", rust);
    hljs.registerLanguage("rs",   rust);
    hljs.registerLanguage("go",   go);
    hljs.registerLanguage("java", java);
    hljs.registerLanguage("cpp",  cpp);
    hljs.registerLanguage("c",    cpp);
    return hljs;
  })();
  return hljsPromise;
}

// ─── theme CSS injected once into <head> ─────────────────────────────────────

const THEME_CSS = `
.hljs-editor-theme .hljs            { background: transparent; color: #abb2bf; }
.hljs-editor-theme .hljs-keyword    { color: #c678dd; }
.hljs-editor-theme .hljs-built_in   { color: #e06c75; }
.hljs-editor-theme .hljs-type       { color: #e5c07b; }
.hljs-editor-theme .hljs-literal    { color: #56b6c2; }
.hljs-editor-theme .hljs-number     { color: #d19a66; }
.hljs-editor-theme .hljs-operator   { color: #56b6c2; }
.hljs-editor-theme .hljs-string     { color: #98c379; }
.hljs-editor-theme .hljs-regexp     { color: #98c379; }
.hljs-editor-theme .hljs-comment    { color: #5c6370; font-style: italic; }
.hljs-editor-theme .hljs-variable   { color: #e06c75; }
.hljs-editor-theme .hljs-attr       { color: #e06c75; }
.hljs-editor-theme .hljs-attribute  { color: #98c379; }
.hljs-editor-theme .hljs-title      { color: #61afef; }
.hljs-editor-theme .hljs-function   { color: #61afef; }
.hljs-editor-theme .hljs-params     { color: #abb2bf; }
.hljs-editor-theme .hljs-class      { color: #e5c07b; }
.hljs-editor-theme .hljs-tag        { color: #e06c75; }
.hljs-editor-theme .hljs-name       { color: #e06c75; }
.hljs-editor-theme .hljs-section    { color: #61afef; font-weight: bold; }
.hljs-editor-theme .hljs-selector-class { color: #e5c07b; }
.hljs-editor-theme .hljs-selector-id   { color: #61afef; }
.hljs-editor-theme .hljs-property   { color: #e06c75; }
.hljs-editor-theme .hljs-meta       { color: #61afef; }
.hljs-editor-theme .hljs-symbol     { color: #56b6c2; }
.hljs-editor-theme .hljs-punctuation{ color: #abb2bf; }
.hljs-editor-theme .hljs-deletion   { color: #e06c75; }
.hljs-editor-theme .hljs-addition   { color: #98c379; }
.hljs-editor-theme .hljs-emphasis   { font-style: italic; }
.hljs-editor-theme .hljs-strong     { font-weight: bold; }
`;

let themeInjected = false;
function injectTheme() {
  if (themeInjected) return;
  themeInjected = true;
  const s = document.createElement("style");
  s.textContent = THEME_CSS;
  document.head.appendChild(s);
}

// ─── helpers ──────────────────────────────────────────────────────────────────

export function extToLang(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    py: "python", css: "css", html: "html", xml: "xml", json: "json",
    sh: "bash", bash: "bash", md: "markdown", rs: "rust", go: "go",
    java: "java", cpp: "cpp", c: "c",
  };
  return map[ext] ?? "plaintext";
}

function highlightCode(hljs: HljsCore | null, code: string, lang: string): string {
  if (!hljs || !code) return escapeHtml(code);
  try {
    if (lang !== "plaintext" && hljs.getLanguage(lang))
      return hljs.highlight(code, { language: lang }).value;
    return hljs.highlightAuto(code).value;
  } catch {
    return escapeHtml(code);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── shared text geometry ─────────────────────────────────────────────────────

const FONT        = `'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace`;
const FONT_SIZE   = "13px";
const LINE_HEIGHT = "1.6";
const PAD         = "16px";

const sharedTextStyles: CSSProperties = {
  fontFamily:   FONT,
  fontSize:     FONT_SIZE,
  lineHeight:   LINE_HEIGHT,
  padding:      PAD,
  margin:       0,
  border:       "none",
  outline:      "none",
  whiteSpace:   "pre",
  wordWrap:     "normal" as const,
  overflowWrap: "normal" as const,
  tabSize:      2,
  MozTabSize:   2,
};

// ─── LiveEditor ───────────────────────────────────────────────────────────────

interface LiveEditorProps {
  code:     string;
  lang:     string;
  hljs:     HljsCore | null;
  onChange: (v: string) => void;
  style?:   CSSProperties;
}

export function LiveEditor({ code, lang, hljs, onChange, style }: LiveEditorProps) {
  const textareaRef  = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  const syncScroll = useCallback(() => {
    const ta = textareaRef.current;
    const hl = highlightRef.current;
    if (!ta || !hl) return;
    hl.scrollTop  = ta.scrollTop;
    hl.scrollLeft = ta.scrollLeft;
  }, []);

  const html = highlightCode(hljs, code, lang) + "\n";

  const baseStyle: CSSProperties = {
    ...sharedTextStyles,
    position:  "absolute",
    top:       0,
    left:      0,
    width:     "100%",
    minHeight: "100%",
    boxSizing: "border-box",
  };

  return (
    <div
      className="hljs-editor-theme"
      style={{
        position:   "relative",
        overflow:   "auto",
        background: "#1e2128",
        flex:       1,
        minHeight:  0,
        ...style,
      }}
    >
      <div
        ref={highlightRef}
        aria-hidden="true"
        style={{
          ...baseStyle,
          color:         "#abb2bf",
          overflow:      "hidden",
          pointerEvents: "none",
          userSelect:    "none",
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <textarea
        ref={textareaRef}
        value={code}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        onChange={e => onChange(e.target.value)}
        onScroll={syncScroll}
        style={{
          ...baseStyle,
          background: "transparent",
          color:      "transparent",
          caretColor: "#528bff",
          resize:     "none",
          overflow:   "auto",
          cursor:     "text",
          zIndex:     1,
        }}
      />
    </div>
  );
}

// ─── WorkspacePanel ───────────────────────────────────────────────────────────

export interface FileItem {
  name:      string;
  content:   string;
  language?: string;
}

interface WorkspacePanelProps {
  file:    FileItem | null;
  onSave?: (filename: string, content: string) => void;
  onFind?: () => void;
  style?:  CSSProperties;
}

export default function WorkspacePanel({ file, onSave, onFind, style }: WorkspacePanelProps) {
  const [hljs,  setHljs]  = useState<HljsCore | null>(null);
  const [draft, setDraft] = useState(file?.content ?? "");

  useEffect(() => { injectTheme(); getHljs().then(setHljs); }, []);
  useEffect(() => { setDraft(file?.content ?? ""); }, [file]);

  const lang    = file ? (file.language ?? extToLang(file.name)) : "plaintext";
  const isDirty = Boolean(file && draft !== file.content);

  function handleSave() {
    if (file && isDirty) onSave?.(file.name, draft);
  }

  if (!file) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        flex: 1, background: "#1e2128", color: "#4b5263",
        fontFamily: FONT, fontSize: "13px", ...style,
      }}>
        Select a file to view
      </div>
    );
  }

  const toolbar = (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "5px 12px", background: "#21252b",
      borderBottom: "1px solid #2c313a", flexShrink: 0, gap: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{
          width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
          background:  isDirty ? "#e5c07b" : "transparent",
          boxShadow:   isDirty ? "0 0 6px rgba(229,192,123,.6)" : "none",
          transition: "background .2s, box-shadow .2s",
        }} />
        <span style={{ fontFamily: FONT, fontSize: "12px", color: "#abb2bf", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {file.name}
        </span>
        <span style={{ fontFamily: FONT, fontSize: "10px", color: "#4b5263", background: "#2c313a", borderRadius: 3, padding: "1px 7px", textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0 }}>
          {lang}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
        <IconBtn title="Find  (Ctrl+F)" onClick={() => onFind?.()} hoverColor="#61afef">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="8.5" cy="8.5" r="5.5"/><line x1="12.8" y1="12.8" x2="17" y2="17"/>
          </svg>
        </IconBtn>
        <IconBtn title="Save  (Ctrl+S)" onClick={handleSave} disabled={!isDirty}
          hoverColor={isDirty ? "#98c379" : "#4b5263"}
          activeColor={isDirty ? "#98c379" : undefined}
          glowColor={isDirty ? "rgba(152,195,121,.28)" : undefined}>
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="14" height="14" rx="2"/>
            <rect x="6.5" y="3" width="5.5" height="5.5" fill="currentColor" stroke="none" opacity="0.4"/>
            <line x1="10.5" y1="3" x2="10.5" y2="8.5" strokeWidth="1.2" opacity="0.6"/>
            <rect x="5.5" y="12.5" width="9" height="3" rx="1" fill="currentColor" stroke="none" opacity="0.3"/>
          </svg>
        </IconBtn>
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, background: "#1e2128", ...style }}>
      {toolbar}
      <LiveEditor code={draft} lang={lang} hljs={hljs} onChange={setDraft} style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
}

// ─── FileEditorPane ───────────────────────────────────────────────────────────
//
//  File-aware wrapper used by WorkspaceView.
//  Reads via invoke("read_text_file") and writes via invoke("fs_write_file") —
//  the same Tauri commands already used in FileStructurePanel / SearchPane.

interface FileEditorPaneProps {
  path:    string;
  onClose: () => void;
  style?:  CSSProperties;
}

export function FileEditorPane({ path, onClose, style }: FileEditorPaneProps) {
  const [hljs,    setHljs]    = useState<HljsCore | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [draft,   setDraft]   = useState("");
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => { injectTheme(); getHljs().then(setHljs); }, []);

  useEffect(() => {
    setContent(null); setError(null); setDraft("");
    invoke<string>("read_text_file", { path })
      .then((text: string) => { setContent(text); setDraft(text); })
      .catch((err: unknown) => setError(String(err)));
  }, [path]);

  const fileName = path.split(/[/\\]/).pop() ?? path;
  const lang     = extToLang(fileName);
  const isDirty  = content !== null && draft !== content;

  async function handleSave() {
    if (!isDirty) return;
    await invoke("fs_write_file", { path, content: draft });
    setContent(draft);
  }

  const placeholderStyle: CSSProperties = {
    display: "flex", flexDirection: "column", flex: 1,
    alignItems: "center", justifyContent: "center",
    background: "#1e2128", color: "#4b5263",
    fontFamily: FONT, fontSize: "13px", gap: 8, ...style,
  };

  if (error) return (
    <div style={placeholderStyle}>
      <span style={{ color: "#e06c75" }}>Failed to open file</span>
      <span style={{ fontSize: "11px", opacity: .6, maxWidth: 320, textAlign: "center" }}>{error}</span>
    </div>
  );

  if (content === null) return (
    <div style={placeholderStyle}><span>Loading…</span></div>
  );

  const toolbar = (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "5px 12px", background: "#21252b",
      borderBottom: "1px solid #2c313a", flexShrink: 0, gap: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        {/* amber dot = unsaved changes */}
        <span style={{
          width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
          background:  isDirty ? "#e5c07b" : "transparent",
          boxShadow:   isDirty ? "0 0 6px rgba(229,192,123,.6)" : "none",
          transition: "background .2s, box-shadow .2s",
        }} />

        {/* coloured file icon — same source of truth as the file tree */}
        <FileIcon name={fileName} isDir={false} />

        <span style={{
          fontFamily: FONT, fontSize: "12px", color: "#abb2bf",
          fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {fileName}
        </span>

        <span style={{
          fontFamily: FONT, fontSize: "10px", color: "#4b5263",
          background: "#2c313a", borderRadius: 3, padding: "1px 7px",
          textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0,
        }}>
          {lang}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
        <IconBtn title="Save (Ctrl+S)" onClick={handleSave} disabled={!isDirty}
          hoverColor={isDirty ? "#98c379" : "#4b5263"}
          activeColor={isDirty ? "#98c379" : undefined}
          glowColor={isDirty ? "rgba(152,195,121,.28)" : undefined}>
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="14" height="14" rx="2"/>
            <rect x="6.5" y="3" width="5.5" height="5.5" fill="currentColor" stroke="none" opacity="0.4"/>
            <line x1="10.5" y1="3" x2="10.5" y2="8.5" strokeWidth="1.2" opacity="0.6"/>
            <rect x="5.5" y="12.5" width="9" height="3" rx="1" fill="currentColor" stroke="none" opacity="0.3"/>
          </svg>
        </IconBtn>

        <IconBtn title="Close" onClick={onClose} hoverColor="#f87171">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="4" y1="4" x2="20" y2="20"/>
            <line x1="20" y1="4" x2="4" y2="20"/>
          </svg>
        </IconBtn>
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, background: "#1e2128", ...style }}>
      {toolbar}
      <LiveEditor code={draft} lang={lang} hljs={hljs} onChange={setDraft} style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
}

// ─── IconBtn ──────────────────────────────────────────────────────────────────

function IconBtn({
  children, title, onClick, disabled, hoverColor, activeColor, glowColor,
}: {
  children:     React.ReactNode;
  title?:       string;
  onClick:      () => void;
  disabled?:    boolean;
  hoverColor?:  string;
  activeColor?: string;
  glowColor?:   string;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button title={title} onClick={onClick} disabled={disabled}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 32, height: 32, border: "none", borderRadius: 6, padding: 0,
        cursor:     disabled ? "default" : "pointer",
        opacity:    disabled ? 0.25 : 1,
        color:      hov && !disabled ? (hoverColor ?? "rgba(255,255,255,.7)") : (activeColor ?? "rgba(255,255,255,.28)"),
        background: hov && !disabled ? "rgba(255,255,255,.07)" : "transparent",
        boxShadow:  hov && glowColor && !disabled ? `0 0 12px ${glowColor}` : "none",
        transition: "color .15s, background .15s, box-shadow .15s, opacity .15s",
      }}>
      {children}
    </button>
  );
}

// ─── named re-exports (FileTreePanel shim compatibility) ─────────────────────
export { extToLang as detectLang };
export { LiveEditor as EditorPane };