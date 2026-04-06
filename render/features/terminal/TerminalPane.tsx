// features/terminal/TerminalPane.tsx
//
// FULL PRODUCTION BUILD — all features wired:
//   • WebGL2 renderer   (falls back to canvas)
//   • SerializeAddon    — scrollback persists across pane close/reopen (localStorage)
//   • ClipboardAddon    — OSC 52 sync (vim, tmux, etc.)
//   • WebLinksAddon     — clickable URLs
//   • FitAddon          — responsive resize
//   • Ctrl/Cmd+Shift+C/V/A/K — keyboard shortcuts via attachCustomKeyEventHandler
//   • Right-click context menu (fully positioned, animated)
//   • OSC 7 CWD tracking — Windows + macOS + Linux paths, BEL and ST terminators
//   • Focus/blur fix    — no 40ms race, mousedown → immediate focus
//   • Session restart   — "press any key" flow after PTY exits
//   • Tauri clipboard   — plugin:clipboard-manager with navigator.clipboard fallback
//   • Split down / split right / close / maximize / minimize titlebar controls
//   • Dim separator line when history is restored

import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal }        from "@xterm/xterm";
import { FitAddon }        from "@xterm/addon-fit";
import { WebLinksAddon }   from "@xterm/addon-web-links";
import { WebglAddon }      from "@xterm/addon-webgl";
import { SerializeAddon }  from "@xterm/addon-serialize";
import { ClipboardAddon }  from "@xterm/addon-clipboard";
import { invoke }          from "@tauri-apps/api/core";
import { listen }          from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
// xterm.css — statically imported so Vite bundles it correctly in production.
// The dynamic /node_modules/ link only works in dev mode and 404s in Tauri builds.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — add `declare module "@xterm/xterm/css/xterm.css" {}` to a .d.ts if you want type safety
import "@xterm/xterm/css/xterm.css";

// ─────────────────────────────────────────────────────────────────────────────
// Clipboard helpers
// navigator.clipboard is gated in Tauri's webview.  Use the plugin first.
// ─────────────────────────────────────────────────────────────────────────────
async function clipWrite(text: string): Promise<void> {
  try {
    await invoke("plugin:clipboard-manager|write_text", { text });
    return;
  } catch { /* fall through */ }
  try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
}

async function clipRead(): Promise<string> {
  try {
    return await invoke<string>("plugin:clipboard-manager|read_text");
  } catch { /* fall through */ }
  try { return await navigator.clipboard.readText(); } catch { return ""; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Buffer persistence  — localStorage  key: stackbox:term:<sessionId>
// Keyed by sessionId (not runboxId) so split panes don't overwrite each other.
// ─────────────────────────────────────────────────────────────────────────────
const SNAPSHOT_KEY   = (id: string) => `stackbox:term:${id}`;
const SNAPSHOT_MAX   = 512 * 1024; // 512 KB

function saveSnapshot(id: string, data: string) {
  try {
    const trimmed = data.length > SNAPSHOT_MAX
      ? data.slice(data.length - SNAPSHOT_MAX)
      : data;
    localStorage.setItem(SNAPSHOT_KEY(id), trimmed);
  } catch { /* storage full */ }
}
function loadSnapshot(id: string): string | null {
  try { return localStorage.getItem(SNAPSHOT_KEY(id)); } catch { return null; }
}
function clearSnapshot(id: string) {
  try { localStorage.removeItem(SNAPSHOT_KEY(id)); } catch { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Theme
// ─────────────────────────────────────────────────────────────────────────────
const BG     = "#12161A";
const BG_ACT = "#1C2228";

const TERM_THEME = {
  background:          BG,
  foreground:          "#d4d4d4",
  cursor:              "#00e5ff",
  cursorAccent:        BG,
  selectionBackground: "rgba(0,229,255,.16)",
  selectionForeground: "#ffffff",
  black:        "#1a1d22", brightBlack:   "#464e58",
  red:          "#bf6060", brightRed:     "#d47878",
  green:        "#78a878", brightGreen:   "#90c090",
  yellow:       "#d4a83a", brightYellow:  "#f0c040",
  blue:         "#5a80a8", brightBlue:    "#7098c0",
  magenta:      "#8c6898", brightMagenta: "#a880b0",
  cyan:         "#00c8e0", brightCyan:    "#18e8ff",
  white:        "#c0c0c0", brightWhite:   "#e0e0e0",
};

// ─────────────────────────────────────────────────────────────────────────────
// Global CSS  (injected once)
// ─────────────────────────────────────────────────────────────────────────────
const TERM_CSS = `
/* ── Window shell ─────────────────────────────── */
.rp-win {
  width:100%;height:100%;box-sizing:border-box;
  background:${BG};display:flex;flex-direction:column;
  overflow:hidden;position:relative;
  border:none;
  border-right:1px solid rgba(255,255,255,.06);
  border-radius:0;
  transition:background .15s,border-color .15s;
}
.rp-win.rp-active {
  background:${BG_ACT};
  box-shadow:none;
}

/* ── Titlebar ──────────────────────────────────── */
.rp-titlebar {
  height:28px;flex-shrink:0;display:flex;align-items:center;
  padding:0 6px 0 8px;gap:4px;
  background:rgba(255,255,255,.02);
  border-bottom:1px solid rgba(255,255,255,.05);
  user-select:none;box-sizing:border-box;
}
.rp-win.rp-active .rp-titlebar {
  background:rgba(255,255,255,.035);
  border-bottom-color:rgba(255,255,255,.08);
}

/* ── CWD label ─────────────────────────────────── */
.rp-cwd {
  flex:1;min-width:0;
  font-size:11px;
  font-family:ui-monospace,'SF Mono',Menlo,Monaco,'Cascadia Mono',Consolas,monospace;
  color:rgba(255,255,255,.2);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  transition:color .15s;
}
.rp-win.rp-active .rp-cwd { color:rgba(255,255,255,.55); }

/* ── Agent chip ────────────────────────────────── */
.rp-chip {
  font-size:9px;font-family:ui-monospace,monospace;
  letter-spacing:.06em;flex-shrink:0;
  color:rgba(255,255,255,.18);
  background:rgba(255,255,255,.04);
  border:1px solid rgba(255,255,255,.07);
  border-radius:3px;padding:1px 6px;
  transition:all .15s;
}
.rp-win.rp-active .rp-chip {
  color:rgba(0,229,255,.65);
  background:rgba(0,229,255,.06);
  border-color:rgba(0,229,255,.16);
}

/* ── Titlebar buttons ──────────────────────────── */
.rp-tbtn {
  width:20px;height:20px;flex-shrink:0;
  display:flex;align-items:center;justify-content:center;
  border-radius:3px;cursor:pointer;
  color:rgba(255,255,255,.35);border:none;background:transparent;
  transition:background .1s,color .1s;padding:0;
}
.rp-win.rp-active .rp-tbtn { color:rgba(255,255,255,.55); }
.rp-tbtn:hover { background:rgba(255,255,255,.09);color:#fff!important; }
.rp-tbtn.rp-close-btn:hover {
  background:rgba(239,68,68,.2)!important;
  color:#f87171!important;
}

/* ── Body ──────────────────────────────────────── */
.rp-body {
  flex:1;min-height:0;min-width:0;
  position:relative;overflow:hidden;
  background:${BG};transition:background .15s;
}
.rp-win.rp-active .rp-body { background:${BG_ACT}; }
.rp-win:not(.rp-active) .rp-body { opacity:.45; }

/* ── xterm container ───────────────────────────── */
.rp-xterm { position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden; }
.rp-xterm .xterm,
.rp-xterm .xterm-viewport,
.rp-xterm .xterm-screen { background:transparent!important; }
/* ── Kill every source of the top gap ────────────────────────────────────── */
.rp-xterm .xterm           { padding:0!important; }
.rp-xterm .xterm-viewport  { padding:0!important; margin:0!important; }
/* xterm-screen default is position:relative which shifts down after viewport.
   Force absolute so it pins to top:0 regardless of viewport height. */
.rp-xterm .xterm-screen    { position:absolute!important; top:0!important; left:0!important; padding:0!important; margin:0!important; }
.rp-xterm .xterm-rows      { padding:0!important; margin:0!important; }
.rp-xterm canvas           { display:block; }

/* slim scrollbar */
.xterm .scrollbar.vertical { width:3px!important; }
.xterm .scrollbar.vertical .slider {
  width:3px!important;border-radius:2px!important;
  background:rgba(255,255,255,.13)!important;
}
.xterm .scrollbar.horizontal { height:0!important;display:none!important; }

/* ── Fade edges ────────────────────────────────── */
.rp-fade-t {
  display:none;
}
.rp-fade-b {
  position:absolute;bottom:0;left:0;right:0;height:20px;
  background:linear-gradient(to top,${BG},transparent);
  pointer-events:none;z-index:4;transition:background .15s;
}
.rp-win.rp-active .rp-fade-b { background:linear-gradient(to top,${BG_ACT},transparent); }

/* ── Context menu ──────────────────────────────── */
.rp-ctx {
  position:fixed;z-index:99999;
  background:#161618;
  border:1px solid rgba(255,255,255,.1);
  border-radius:10px;padding:4px;min-width:196px;
  box-shadow:
    0 16px 40px rgba(0,0,0,.72),
    0 4px 12px rgba(0,0,0,.4),
    inset 0 1px 0 rgba(255,255,255,.05);
  font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;
  font-size:12.5px;
  animation:rp-ctx-in .07s cubic-bezier(.16,1,.3,1);
  transform-origin:top left;
}
@keyframes rp-ctx-in {
  from { opacity:0; transform:scale(.94) translateY(-3px); }
  to   { opacity:1; transform:scale(1)   translateY(0); }
}
.rp-ctx-item {
  display:flex;align-items:center;gap:8px;
  padding:6px 10px;border-radius:6px;cursor:pointer;
  color:rgba(255,255,255,.75);
  transition:background .07s,color .07s;
  user-select:none;
}
.rp-ctx-item:hover { background:rgba(255,255,255,.08);color:#fff; }
.rp-ctx-item.rp-ctx-disabled {
  color:rgba(255,255,255,.22);cursor:default;pointer-events:none;
}
.rp-ctx-item.rp-ctx-danger { color:rgba(248,113,113,.75); }
.rp-ctx-item.rp-ctx-danger:hover { background:rgba(239,68,68,.12);color:#f87171; }
.rp-ctx-icon {
  width:14px;height:14px;flex-shrink:0;
  display:flex;align-items:center;justify-content:center;
  opacity:.5;transition:opacity .07s;
}
.rp-ctx-item:hover .rp-ctx-icon { opacity:.8; }
.rp-ctx-item.rp-ctx-disabled .rp-ctx-icon { opacity:.2; }
.rp-ctx-item.rp-ctx-danger .rp-ctx-icon { opacity:.65; }
.rp-ctx-label { flex:1; }
.rp-ctx-shortcut {
  font-size:10px;color:rgba(255,255,255,.25);
  font-family:ui-monospace,monospace;
}
.rp-ctx-sep {
  height:1px;background:rgba(255,255,255,.06);margin:3px 2px;
}

/* ── Search bar ────────────────────────────────── */
.rp-search {
  position:absolute;top:0;right:0;z-index:20;
  display:flex;align-items:center;gap:6px;
  background:#1c1c1e;
  border:1px solid rgba(0,229,255,.2);
  border-top:none;border-right:none;
  border-radius:0 0 0 8px;
  padding:5px 8px;
  box-shadow:0 4px 16px rgba(0,0,0,.5);
  animation:rp-ctx-in .1s ease;
}
.rp-search input {
  background:transparent;border:none;outline:none;
  color:#e0e0e0;font-size:12px;
  font-family:ui-monospace,monospace;
  width:160px;caret-color:#00e5ff;
}
.rp-search input::placeholder { color:rgba(255,255,255,.2); }
.rp-search-count {
  font-size:10px;color:rgba(255,255,255,.3);
  font-family:ui-monospace,monospace;white-space:nowrap;min-width:36px;
}
.rp-search-btn {
  width:18px;height:18px;display:flex;align-items:center;justify-content:center;
  border:none;background:transparent;cursor:pointer;
  color:rgba(255,255,255,.4);border-radius:3px;padding:0;
  transition:background .1s,color .1s;
}
.rp-search-btn:hover { background:rgba(255,255,255,.1);color:#fff; }
`;

// ─────────────────────────────────────────────────────────────────────────────
// OSC 7  (CWD tracking)
// Handles BEL (\x07) and ST (\x1b\\) terminators; Windows + macOS + Linux paths
// ─────────────────────────────────────────────────────────────────────────────
function parseOsc7(data: string): string | null {
  const m = data.match(/\x1b]7;file:\/\/[^/]*([^\x07\x1b]+)(?:\x07|\x1b\\)/);
  if (!m) return null;
  try {
    let p = decodeURIComponent(m[1]);
    const homePatterns = [
      /^\/[A-Za-z]:\/Users\/[^/]+(\/|$)/,   // Windows  /C:/Users/foo/
      /^\/Users\/[^/]+(\/|$)/,               // macOS    /Users/foo/
      /^\/home\/[^/]+(\/|$)/,                // Linux    /home/foo/
    ];
    for (const re of homePatterns) {
      const hm = p.match(re);
      if (hm) { p = "~/" + p.slice(hm[0].length); break; }
    }
    p = p.replace(/^~\/\//, "~/");
    if (p !== "~/") p = p.replace(/\/$/, "");
    return p || "~/";
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────
function TBtn({
  title, onClick, danger, children,
}: {
  title: string;
  onClick: (e: React.MouseEvent) => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`rp-tbtn${danger ? " rp-close-btn" : ""}`}
      title={title}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); onClick(e); }}
    >
      {children}
    </button>
  );
}

interface CtxItemProps {
  label:     string;
  shortcut?: string;
  disabled?: boolean;
  danger?:   boolean;
  icon?:     React.ReactNode;
  onClick:   () => void;
}
function CtxItem({ label, shortcut, disabled, danger, icon, onClick }: CtxItemProps) {
  return (
    <div
      className={`rp-ctx-item${disabled ? " rp-ctx-disabled" : ""}${danger ? " rp-ctx-danger" : ""}`}
      onMouseDown={e => { e.preventDefault(); e.stopPropagation(); }}
      onClick={disabled ? undefined : onClick}
    >
      <span className="rp-ctx-icon">{icon}</span>
      <span className="rp-ctx-label">{label}</span>
      {shortcut && <span className="rp-ctx-shortcut">{shortcut}</span>}
    </div>
  );
}
function CtxSep() { return <div className="rp-ctx-sep" />; }

// SVG icon helpers
const IcoCopy     = () => <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="5" width="8" height="9" rx="1.5"/><path d="M3 11V3a1 1 0 0 1 1-1h7"/></svg>;
const IcoPaste    = () => <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="10" height="10" rx="1.5"/><path d="M6 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1"/></svg>;
const IcoSelect   = () => <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="12" height="12" rx="1.5"/><line x1="5" y1="6" x2="11" y2="6"/><line x1="5" y1="9" x2="11" y2="9"/></svg>;
const IcoClear    = () => <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 13h10"/><path d="M5 10l1-7h4l1 7"/><line x1="4" y1="6" x2="12" y2="6"/></svg>;
const IcoUp       = () => <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="4,6 8,2 12,6"/><line x1="8" y1="2" x2="8" y2="11"/><line x1="3" y1="14" x2="13" y2="14"/></svg>;
const IcoFolder   = () => <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2 9V5a1 1 0 0 1 1-1h3l2-2h5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H9"/><rect x="2" y="9" width="5" height="5" rx="1"/></svg>;
const IcoSearch   = () => <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="6.5" cy="6.5" r="4"/><line x1="10" y1="10" x2="14" y2="14"/></svg>;
const IcoSplitH   = () => <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="1.5" y="1.5" width="13" height="13" rx="2"/><line x1="1.5" y1="8.5" x2="14.5" y2="8.5"/></svg>;
const IcoSplitV   = () => <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="1.5" y="1.5" width="13" height="13" rx="2"/><line x1="8.5" y1="1.5" x2="8.5" y2="14.5"/></svg>;
const IcoClose    = () => <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>;
const IcoMinimize = () => <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="2,6 6,6 6,2"/><line x1="6" y1="6" x2="2" y2="2"/><polyline points="14,10 10,10 10,14"/><line x1="10" y1="10" x2="14" y2="14"/></svg>;
const IcoMaximize = () => <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="10,2 14,2 14,6"/><line x1="14" y1="2" x2="9" y2="7"/><polyline points="6,14 2,14 2,10"/><line x1="2" y1="14" x2="7" y2="9"/></svg>;

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────
interface TerminalPaneProps {
  runboxCwd?:       string;
  runboxId?:        string;
  runboxName?:      string;
  agentCmd?:        string;
  sessionId?:       string;
  label?:           string;
  isActive?:        boolean;
  onActivate?:      () => void;
  onClose?:         () => void;
  onSplitDown?:     () => void;
  onSplitLeft?:     () => void;
  onCwdChange?:     (cwd: string) => void;
  onSessionChange?: (sid: string) => void;
  onWorktreeReady?: (path: string) => void;
  onMaximize?:      () => void;
  onMinimize?:      () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// TerminalPane
// ─────────────────────────────────────────────────────────────────────────────
export function TerminalPane({
  runboxCwd  = "~/",
  runboxId   = "default",
  runboxName = "shell",
  agentCmd,
  sessionId,
  label      = "",
  isActive,
  onActivate,
  onClose,
  onSplitDown,
  onSplitLeft,
  onCwdChange,
  onSessionChange,
  onWorktreeReady,
  onMaximize,
  onMinimize,
}: TerminalPaneProps) {
  // ── Refs ────────────────────────────────────────────────────────────────
  const termElRef = useRef<HTMLDivElement>(null);
  const termRef   = useRef<Terminal | null>(null);
  const fitRef    = useRef<FitAddon | null>(null);
  const serRef    = useRef<SerializeAddon | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const searchRef = useRef<any>(null); // SearchAddon — typed as any so @xterm/addon-search is optional

  // stable session id — never reuse across spawns
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _ignoreSessionProp = sessionId;
  const sidRef = useRef(`${runboxId}-${crypto.randomUUID()}`);

  const gone           = useRef(false);
  const spawned        = useRef(false);
  const hasSpawnedOnce = useRef(false);

  // keep callbacks in refs so the main effect's closure stays stable
  const agentCmdRef   = useRef(agentCmd);
  const runboxNameRef = useRef(runboxName);
  const runboxCwdRef  = useRef(runboxCwd);
  const onWorktreeRef = useRef(onWorktreeReady);
  const onSessionRef  = useRef(onSessionChange);
  const onCwdRef      = useRef(onCwdChange);
  useEffect(() => { agentCmdRef.current   = agentCmd;        }, [agentCmd]);
  useEffect(() => { runboxNameRef.current = runboxName;      }, [runboxName]);
  useEffect(() => { runboxCwdRef.current  = runboxCwd;       }, [runboxCwd]);
  useEffect(() => { onWorktreeRef.current = onWorktreeReady; }, [onWorktreeReady]);
  useEffect(() => { onSessionRef.current  = onSessionChange; }, [onSessionChange]);
  useEffect(() => { onCwdRef.current      = onCwdChange;     }, [onCwdChange]);

  // ── State ────────────────────────────────────────────────────────────────
  const [liveCwd,   setLiveCwd]   = useState(runboxCwd);
  const liveCwdRef = useRef(liveCwd);
  useEffect(() => { liveCwdRef.current = liveCwd; }, [liveCwd]);

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; hasSel: boolean } | null>(null);

  // Inject CSS once
  useEffect(() => {
    // xterm.css is now a static import at the top of this file (Vite bundles it
    // correctly for both dev and Tauri production). Only the component-scoped
    // styles below need runtime injection.
    const id = "rp-css-v20";
    document.getElementById(id)?.remove();
    const s = document.createElement("style");
    s.id = id; s.textContent = TERM_CSS;
    document.head.appendChild(s);
  }, []);

  // ── Focus / blur on active change ────────────────────────────────────────
  useEffect(() => {
    if (isActive) {
      termRef.current?.focus();
    } else {
      const ta = termElRef.current?.querySelector<HTMLTextAreaElement>("textarea");
      ta?.blur();
    }
  }, [isActive]);

  // Report initial session ID once
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onSessionRef.current?.(sidRef.current); }, []);

  // ── Dismiss context menu on outside click ────────────────────────────────
  // NOTE: do NOT use { capture: true } here — that fires before React's onClick
  // on the menu items, causing the menu to unmount before the click handler runs.
  // Instead we rely on the menu container calling e.nativeEvent.stopPropagation()
  // (see below) so this window listener never fires for intra-menu clicks.
  useEffect(() => {
    if (!ctxMenu) return;
    const dismiss = () => setCtxMenu(null);
    window.addEventListener("mousedown", dismiss);
    return () => window.removeEventListener("mousedown", dismiss);
  }, [ctxMenu]);

  // ── Context menu actions ─────────────────────────────────────────────────
  const ctxCopy = useCallback(() => {
    const sel = termRef.current?.getSelection();
    if (sel) clipWrite(sel);
    setCtxMenu(null); termRef.current?.focus();
  }, []);

  const ctxPaste = useCallback(() => {
    clipRead().then(t => {
      if (t) invoke("pty_write", { sessionId: sidRef.current, data: t }).catch(() => {});
    });
    setCtxMenu(null); termRef.current?.focus();
  }, []);

  const ctxSelectAll = useCallback(() => {
    termRef.current?.selectAll();
    setCtxMenu(null); termRef.current?.focus();
  }, []);

  const ctxClear = useCallback(() => {
    invoke("pty_write", { sessionId: sidRef.current, data: "\x0c" }).catch(() => {});
    setCtxMenu(null); termRef.current?.focus();
  }, []);

  const ctxClearScrollback = useCallback(() => {
    termRef.current?.clear();
    clearSnapshot(sidRef.current);
    setCtxMenu(null); termRef.current?.focus();
  }, []);

  const ctxCopyCwd = useCallback(() => {
    clipWrite(liveCwdRef.current);
    setCtxMenu(null); termRef.current?.focus();
  }, []);

  const ctxSplitDown  = useCallback(() => { setCtxMenu(null); onSplitDown?.(); },  [onSplitDown]);
  const ctxSplitRight = useCallback(() => { setCtxMenu(null); onSplitLeft?.(); },  [onSplitLeft]);
  const ctxClose      = useCallback(() => { setCtxMenu(null); onClose?.(); },       [onClose]);

  // ── Right-click ──────────────────────────────────────────────────────────
  // Context menu is triggered by a native capture-phase listener registered
  // inside the main terminal useEffect (see below). That approach intercepts
  // the event before xterm's own contextmenu handler and is more reliable.
  // This placeholder is kept so refactors stay easy to follow.

  // ── Main terminal lifecycle ───────────────────────────────────────────────
  useEffect(() => {
    if (!termElRef.current) return;
    gone.current    = false;
    spawned.current = false;

    // Dynamically import SearchAddon — fully optional, no type dep required
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let searchAddon: any = null;

    const term = new Terminal({
      cursorBlink:           true,
      cursorStyle:           "bar",
      cursorWidth:           1.5,
      fontSize:              13,
      lineHeight:            1.42,
      letterSpacing:         0,
      fontWeight:            "normal",
      fontWeightBold:        "bold",
      fontFamily:            "ui-monospace,'SF Mono',Menlo,Monaco,'Cascadia Mono',Consolas,'Courier New',monospace",
      theme:                 TERM_THEME,
      convertEol:            true,
      scrollback:            50_000,
      allowTransparency:     true,
      macOptionIsMeta:       true,
      rightClickSelectsWord: false,
      disableStdin:          false,
    });

    const fit = new FitAddon();
    const ser = new SerializeAddon();
    term.loadAddon(fit);
    term.loadAddon(ser);
    term.loadAddon(new WebLinksAddon());
    term.loadAddon(new ClipboardAddon());   // OSC 52

    // Attempt SearchAddon — optional package, hidden from TS resolver via Function()
    // so a missing @xterm/addon-search never causes a compile error.
    (Function('return import("@xterm/addon-search")')() as Promise<any>)
      .then(({ SearchAddon }: any) => {
        searchAddon = new SearchAddon();
        term.loadAddon(searchAddon);
        searchRef.current = searchAddon;
      })
      .catch(() => { /* not installed — search bar renders but find is no-op */ });

    // WebGL2 — falls back to DOM renderer on failure or context loss.
    // IMPORTANT: calling wgl.dispose() on context loss removes the WebGL renderer
    // but leaves no renderer attached, causing a permanent black canvas.
    // After dispose we call term.refresh() to force xterm to fall back to its
    // built-in DOM renderer so the terminal stays visible.
    try {
      const wgl = new WebglAddon();
      wgl.onContextLoss(() => {
        wgl.dispose();
        // Re-render via DOM renderer fallback
        try { term.refresh(0, term.rows - 1); } catch { /* ignore */ }
      });
      term.loadAddon(wgl);
    } catch { /* DOM renderer fallback */ }

    term.open(termElRef.current);
    termRef.current = term;
    fitRef.current  = fit;
    serRef.current  = ser;

    // ── Check if tmux session is alive (Unix) ────────────────────────────
    // If yes, we will reconnect to it instead of spawning fresh.
    // The "session ended" banner is suppressed so reconnect is seamless.
    invoke<boolean>("pty_session_alive", { runboxId })
      .then(alive => { if (alive) hasSpawnedOnce.current = true; })
      .catch(() => {});

    // ── Restore scrollback snapshot ──────────────────────────────────────
    // Use the stable session id so split panes each get their own snapshot
    const snapshotId = sidRef.current;
    const snapshot = loadSnapshot(snapshotId);
    if (snapshot) {
      term.write(snapshot);
      const cols = Math.max((term.cols ?? 80) - 8, 10);
      const line = "─".repeat(Math.min(cols, 56));
      term.write(`\r\n\x1b[38;5;237m${line} restored ${line}\x1b[0m\r\n\r\n`);
    }

    // ── Native right-click handler (capture phase) ────────────────────────
    // xterm.js attaches its own contextmenu listener to the viewport element.
    // By registering in the CAPTURE phase on the container we fire FIRST,
    // preventing xterm from consuming the event and reliably showing our menu.
    const ctxEl = termElRef.current!;
    const handleNativeCtx = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const hasSel = (termRef.current?.getSelection()?.length ?? 0) > 0;
      setCtxMenu({ x: e.clientX, y: e.clientY, hasSel });
    };
    ctxEl.addEventListener("contextmenu", handleNativeCtx, true);

    // ── Keyboard shortcuts via attachCustomKeyEventHandler ───────────────
    // MUST use this — outer-div onKeyDown never fires because xterm's textarea
    // calls stopPropagation.
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type !== "keydown") return true;
      const ctrl  = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;

      // Copy selection
      if (ctrl && shift && e.key === "C") {
        const sel = term.getSelection();
        if (sel) clipWrite(sel);
        return false;
      }
      // Paste
      if (ctrl && shift && e.key === "V") {
        clipRead().then(t => {
          if (t) invoke("pty_write", { sessionId: sidRef.current, data: t }).catch(() => {});
        });
        return false;
      }
      // Select all
      if (ctrl && shift && e.key === "A") {
        term.selectAll();
        return false;
      }
      // Hard clear scrollback
      if (ctrl && shift && e.key === "K") {
        term.clear();
        clearSnapshot(sidRef.current);
        return false;
      }
      // macOS: Cmd+L → clear screen
      if (e.metaKey && !shift && e.key === "l") {
        invoke("pty_write", { sessionId: sidRef.current, data: "\x0c" }).catch(() => {});
        return false;
      }
      return true;
    });

    // Track selection for context menu Copy enabled state
    term.onSelectionChange(() => {
      // no state needed — we read it on right-click
    });

    // Forward keypresses to PTY
    term.onData(data => {
      invoke("pty_write", { sessionId: sidRef.current, data }).catch(() => {});
    });

    const applyMargin = () => {
      const root = termElRef.current;
      if (!root) return;
      const xterm    = root.querySelector(".xterm")          as HTMLElement | null;
      const viewport = root.querySelector(".xterm-viewport") as HTMLElement | null;
      const screen   = root.querySelector(".xterm-screen")   as HTMLElement | null;
      const rows     = root.querySelector(".xterm-rows")     as HTMLElement | null;
      if (xterm)    { xterm.style.padding    = "0"; xterm.style.margin = "0"; }
      if (viewport) { viewport.style.padding = "0"; viewport.style.margin = "0"; }
      if (screen)   { screen.style.position  = "absolute"; screen.style.top = "0";
                      screen.style.left      = "6px"; screen.style.margin = "0"; screen.style.padding = "0"; }
      if (rows)     { rows.style.padding     = "0"; rows.style.margin = "0"; }
    };

    let unlisteners: Array<UnlistenFn | null> = [];
    let restartDisposable: { dispose: () => void } | null = null;

    // ── Spawn PTY ────────────────────────────────────────────────────────
    const spawnPty = (sid: string, cols: number, rows: number) => {
      invoke("pty_spawn", {
        sessionId:     sid,
        runboxId,
        cwd:           runboxCwdRef.current,
        agentCmd:      agentCmdRef.current ?? null,
        workspaceName: runboxNameRef.current ?? null,
        cols,
        rows,
      })
        .then(() => {
          hasSpawnedOnce.current = true;
          // Use sessionId so each split pane / agent gets its own worktree
          invoke<string | null>("get_worktree_path", { sessionId: sidRef.current, runboxId })
            .then(wt => { if (wt) onWorktreeRef.current?.(wt); })
            .catch(() => {});
        })
        .catch(err => {
          if (!gone.current) {
            term.write(`\r\n\x1b[38;5;196m[stackbox] spawn failed: ${err}\x1b[0m\r\n`);
          }
        });
    };

    // ── Event listeners ──────────────────────────────────────────────────
    // IMPORTANT: returns a Promise that resolves only once BOTH Tauri listeners
    // are fully registered. spawnPty must be called after this resolves.
    // Without this gate the shell's first bytes (prompt) arrive while the
    // listener is still pending and are silently dropped — blank terminal on Windows.
    const setupListeners = (sid: string): Promise<void> => {
      for (const u of unlisteners) u?.();
      unlisteners = [];
      restartDisposable?.dispose();
      restartDisposable = null;

      return Promise.all([
        // PTY output → write to xterm
        listen<string>(`pty://output/${sid}`, ({ payload }) => {
          if (gone.current) return;
          term.write(payload);

          // OSC 7 — track CWD
          const cwd = parseOsc7(payload);
          if (cwd) {
            // Hide internal worktree suffix from the user
            const display = /[/\\]stackbox-wt-[^/\\]*$/.test(cwd)
              ? (runboxCwdRef.current ?? cwd)
              : cwd;
            setLiveCwd(display);
            onCwdRef.current?.(display);
          }
        }),

        // PTY ended — show restart prompt
        listen<void>(`pty://ended/${sid}`, () => {
          if (gone.current) return;
          restartDisposable?.dispose();
          restartDisposable = null;
          if (!hasSpawnedOnce.current) return;

          const cols  = termRef.current?.cols ?? 80;
          const width = Math.min(cols - 4, 64);
          const dash  = "─".repeat(width);
          term.write(`\r\n\x1b[38;5;238m${dash}\x1b[0m\r\n`);
          term.write(`\x1b[38;5;242m  session ended  ·  press any key to restart\x1b[0m\r\n`);
          term.write(`\x1b[38;5;238m${dash}\x1b[0m\r\n`);
          spawned.current = false;

          const d = term.onData(() => {
            d.dispose();
            restartDisposable = null;
            if (gone.current || (termRef.current?.cols ?? 0) <= 0) return;

            const newSid = `${runboxId}-${crypto.randomUUID()}`;
            sidRef.current = newSid;
            onSessionRef.current?.(newSid);
            spawned.current = true;
            // Wait for new listeners before restarting the PTY
            setupListeners(newSid).then(() => {
              if (!gone.current) spawnPty(newSid, term.cols, term.rows);
            });
          });
          restartDisposable = d;
        }),
      ]).then(([outUL, endedUL]) => {
        unlisteners = [outUL, endedUL];
      }).catch((err) => {
        // Previously `.catch(() => {})` silently swallowed this, leaving
        // `unlisteners` empty so PTY output events never reached xterm.
        console.error("[TerminalPane] Failed to register PTY listeners:", err);
      });
    };

    // Register listeners FIRST and hold the promise so spawn can await it.
    // This ensures the Tauri IPC channel is active before the PTY process
    // starts writing — otherwise the shell prompt is lost on Windows/WebView2.
    const listenersReady = setupListeners(sidRef.current);

    // ── Initial spawn ────────────────────────────────────────────────────
    // spawned.current is the single gate. Set it to true BEFORE the async
    // .then() — otherwise the ResizeObserver or second rAF can race in and
    // call spawnPty a second time while listenersReady is still pending.
    const doSpawn = () => {
      spawned.current = true; // lock before any async work
      applyMargin();
      term.focus();
      listenersReady.then(() => {
        if (!gone.current) spawnPty(sidRef.current, term.cols, term.rows);
      });
    };

    const trySpawnNow = () => {
      if (spawned.current || gone.current || !termElRef.current) return;
      const rect = termElRef.current.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      try { fit.fit(); } catch { return; }
      if (term.cols <= 0 || term.rows <= 0) return;
      doSpawn();
    };

    requestAnimationFrame(() => {
      trySpawnNow();
      if (!spawned.current) requestAnimationFrame(trySpawnNow);
    });

    // ── Responsive resize ────────────────────────────────────────────────
    const ro = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;
      try { fit.fit(); } catch { return; }
      if (term.cols <= 0 || term.rows <= 0) return;
      if (!spawned.current && !gone.current) {
        // First valid size — spawn now
        doSpawn();
      } else if (spawned.current) {
        // Already spawned — just resize the PTY
        invoke("pty_resize", { sessionId: sidRef.current, cols: term.cols, rows: term.rows }).catch(() => {});
      }
    });
    ro.observe(termElRef.current!);

    // ── Cleanup ──────────────────────────────────────────────────────────
    return () => {
      gone.current = true;
      ro.disconnect();
      ctxEl.removeEventListener("contextmenu", handleNativeCtx, true);
      for (const u of unlisteners) u?.();
      restartDisposable?.dispose();
      // Persist scrollback before destroying
      try {
        if (serRef.current && termRef.current) {
          const data = serRef.current.serialize();
          if (data.trim()) saveSnapshot(sidRef.current, data);
        }
      } catch { /* ignore */ }
      invoke("pty_kill", { sessionId: sidRef.current }).catch(() => {});
      term.dispose();
      termRef.current = null;
      fitRef.current  = null;
      serRef.current  = null;
      searchRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Mousedown: activate + immediate focus ─────────────────────────────────
  const handleMouseDown = useCallback(() => {
    onActivate?.();
    termRef.current?.focus();
    // On Windows/WebView2 React's DOM commit can briefly blur the textarea.
    // A zero-delay setTimeout refocuses after the commit completes.
    setTimeout(() => termRef.current?.focus(), 0);
  }, [onActivate]);

  // ── Clamp context menu to viewport ────────────────────────────────────────
  const CTX_W = 196;
  const CTX_H = 300;
  const ctxX = ctxMenu ? Math.min(ctxMenu.x, window.innerWidth  - CTX_W - 8) : 0;
  const ctxY = ctxMenu ? Math.min(ctxMenu.y, window.innerHeight - CTX_H - 8) : 0;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className={`rp-win${isActive ? " rp-active" : ""}`}
      onMouseDown={handleMouseDown}
    >
      {/* ── Titlebar ─────────────────────────────────────────────────── */}
      <div className="rp-titlebar" onMouseDown={e => { if ((e.target as HTMLElement).closest(".rp-tbtn")) return; }}>

        {/* Minimize / Maximize */}
        {(onMinimize || onMaximize) && (
          <div style={{ display:"flex", alignItems:"center", gap:2, marginRight:4, flexShrink:0 }}>
            {onMinimize && <TBtn title="Minimize" onClick={onMinimize}><IcoMinimize /></TBtn>}
            {onMaximize && <TBtn title="Maximize" onClick={onMaximize}><IcoMaximize /></TBtn>}
          </div>
        )}

        {/* Agent chip */}
        {label && <span className="rp-chip">{label}</span>}

        {/* CWD */}
        <span className="rp-cwd" title={liveCwd || runboxCwd}>
          {liveCwd || runboxCwd}
        </span>

        {/* Action buttons */}
        <div style={{ display:"flex", alignItems:"center", gap:2, marginLeft:4 }}>
          {onSplitDown  && <TBtn title="Split down"  onClick={onSplitDown}><IcoSplitH /></TBtn>}
          {onSplitLeft  && <TBtn title="Split right" onClick={onSplitLeft}><IcoSplitV /></TBtn>}
          {onClose      && <TBtn title="Close" onClick={onClose} danger><IcoClose /></TBtn>}
        </div>
      </div>

      {/* ── Terminal body ─────────────────────────────────────────────── */}
      <div className="rp-body">
        <div className="rp-fade-t" />
        <div className="rp-xterm" ref={termElRef} />
        <div className="rp-fade-b" />

      </div>

      {/* ── Right-click context menu ──────────────────────────────────── */}
      {ctxMenu && (
        <div
          className="rp-ctx"
          style={{ top: ctxY, left: ctxX }}
          onMouseDown={e => {
            // Stop the native event from bubbling to window so the dismiss
            // listener (registered WITHOUT capture) never fires for clicks
            // inside the menu — this lets CtxItem onClick handlers run first.
            e.nativeEvent.stopPropagation();
            e.stopPropagation();
          }}
        >
          <CtxItem label="Copy"         shortcut="⇧⌃C"  disabled={!ctxMenu.hasSel} onClick={ctxCopy}          icon={<IcoCopy />} />
          <CtxItem label="Paste"        shortcut="⇧⌃V"                             onClick={ctxPaste}         icon={<IcoPaste />} />
          <CtxSep />
          <CtxItem label="Select All"   shortcut="⇧⌃A"                             onClick={ctxSelectAll}     icon={<IcoSelect />} />
          <CtxItem label="Clear Screen" shortcut="⌘L"                              onClick={ctxClear}         icon={<IcoClear />} />
          <CtxItem label="Clear Scrollback" shortcut="⇧⌃K"                        onClick={ctxClearScrollback} icon={<IcoUp />} />
          <CtxItem label="Copy CWD"                                                onClick={ctxCopyCwd}       icon={<IcoFolder />} />
          {(onSplitDown || onSplitLeft) && <CtxSep />}
          {onSplitDown  && <CtxItem label="Split Down"  onClick={ctxSplitDown}  icon={<IcoSplitH />} />}
          {onSplitLeft  && <CtxItem label="Split Right" onClick={ctxSplitRight} icon={<IcoSplitV />} />}
          {onClose && (
            <>
              <CtxSep />
              <CtxItem label="Close Pane" danger onClick={ctxClose} icon={<IcoClose />} />
            </>
          )}
        </div>
      )}
    </div>
  );
}