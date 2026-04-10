// features/terminal/TerminalPane.tsx
//
// FULL PRODUCTION BUILD — all features wired:
//   • WebGL2 renderer   (falls back to canvas)
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
//   • NOTE: localStorage snapshot storage removed — no double-prompt, clean restarts

import React, { useEffect, useRef, useCallback, useState } from "react";
import { Terminal }        from "@xterm/xterm";
import { FitAddon }        from "@xterm/addon-fit";
import { WebLinksAddon }   from "@xterm/addon-web-links";
import { WebglAddon }      from "@xterm/addon-webgl";
import { ClipboardAddon }  from "@xterm/addon-clipboard";
import { SearchAddon }     from "@xterm/addon-search";
import { invoke }          from "@tauri-apps/api/core";
import { listen }          from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
// xterm.css — statically imported so Vite bundles it correctly in production.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import "@xterm/xterm/css/xterm.css";

// ─────────────────────────────────────────────────────────────────────────────
// Clipboard helpers
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
// Theme
// ─────────────────────────────────────────────────────────────────────────────
const BG     = "#121212";
const BG_ACT = "#425860";

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

.rp-win:not(.rp-active) .rp-body { opacity:.45; }

/* ── xterm container ───────────────────────────── */
.rp-xterm { position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden;padding-left:6px; }
.rp-xterm .xterm,
.rp-xterm .xterm-viewport,
.rp-xterm .xterm-screen { background:transparent!important; }
/* ── Kill focus outline / border on xterm's hidden textarea ── */
.rp-xterm .xterm-helper-textarea,
.rp-xterm textarea {
  outline:none!important;
  border:none!important;
  box-shadow:none!important;
  caret-color:transparent!important;
}
/* Kill any viewport border or outline */
.rp-xterm .xterm-viewport { border:none!important; outline:none!important; box-shadow:none!important; }
/* Remove outer xterm container padding — DO NOT touch .xterm-rows or .xterm-screen:
   xterm uses those elements for cursor row tracking; forcing margin/padding on them
   desyncs the internal cursor position and makes typed input appear at the wrong position. */
.rp-xterm .xterm           { padding:0!important; margin:0!important; }
.rp-xterm .xterm-viewport  { padding:0!important; margin:0!important; }
.rp-xterm canvas           { display:block; }

/* slim scrollbar */
.xterm .scrollbar.vertical { width:3px!important; }
.xterm .scrollbar.vertical .slider {
  width:3px!important;border-radius:2px!important;
  background:rgba(255,255,255,.13)!important;
}
.xterm .scrollbar.horizontal { height:0!important;display:none!important; }

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
// ─────────────────────────────────────────────────────────────────────────────

// Normalise a raw OSC-7 path string (already URL-decoded) into the ~/… form
// we store internally.
function normaliseOsc7Path(raw: string): string | null {
  try {
    let p = decodeURIComponent(raw);
    // Windows: strip spurious leading "/" before drive letter
    p = p.replace(/^\/([A-Za-z]:[/\\])/, "$1");
    // Collapse home dir to "~/"
    const homePatterns = [
      /^[A-Za-z]:\/Users\/[^/]+(\/|$)/,   // Windows C:/Users/<n>
      /^\/Users\/[^/]+(\/|$)/,              // macOS
      /^\/home\/[^/]+(\/|$)/,               // Linux
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

// Extract ALL OSC-7 paths from a (possibly partial) data string.
// Returns { paths, remainder } where remainder is any trailing incomplete
// OSC sequence that should be prepended to the next chunk.
function extractOsc7(data: string): { paths: string[]; remainder: string } {
  const paths: string[] = [];

  // Fully terminated sequences — BEL (\x07) or ST (\x1b\)
  const fullRe = /\x1b]7;file:\/\/[^\x07\x1b/]*([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((m = fullRe.exec(data)) !== null) {
    const p = normaliseOsc7Path(m[1]);
    if (p) paths.push(p);
  }

  // Check for a dangling (unterminated) OSC-7 start — save for next chunk
  // Only keep the LAST potential start to avoid growing the buffer unboundedly.
  const partialRe = /\x1b]7;file:\/\/[^\x07\x1b]*$/;
  const partial = data.match(partialRe);
  const remainder = partial ? partial[0] : "";

  return { paths, remainder };
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
const IcoSplitH   = () => <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="1.5" y="1.5" width="13" height="13" rx="2"/><line x1="1.5" y1="8.5" x2="14.5" y2="8.5"/></svg>;
const IcoSplitV   = () => <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="1.5" y="1.5" width="13" height="13" rx="2"/><line x1="8.5" y1="1.5" x2="8.5" y2="14.5"/></svg>;
const IcoClose    = () => <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>;
const IcoMinimize = () => <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="2,6 6,6 6,2"/><line x1="6" y1="6" x2="2" y2="2"/><polyline points="14,10 10,10 10,14"/><line x1="10" y1="10" x2="14" y2="14"/></svg>;
const IcoMaximize = () => <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="10,2 14,2 14,6"/><line x1="14" y1="2" x2="9" y2="7"/><polyline points="6,14 2,14 2,10"/><line x1="2" y1="14" x2="7" y2="9"/></svg>;

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────
interface TerminalPaneProps {
  runboxCwd?:        string;
  runboxId?:         string;
  runboxName?:       string;
  agentCmd?:         string;
  sessionId?:        string;
  label?:            string;
  isActive?:         boolean;
  onActivate?:       () => void;
  onClose?:          () => void;
  onSplitDown?:      () => void;
  onSplitLeft?:      () => void;
  onCwdChange?:      (cwd: string) => void;
  onSessionChange?:  (sid: string) => void;
  onWorktreeReady?:  (path: string) => void;
  onMaximize?:       () => void;
  onMinimize?:       () => void;
  onAgentDetected?:  (agent: string | null) => void;
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
  onAgentDetected,
}: TerminalPaneProps) {
  // ── Refs ────────────────────────────────────────────────────────────────
  const termElRef = useRef<HTMLDivElement>(null);
  const termRef   = useRef<Terminal | null>(null);
  const fitRef    = useRef<FitAddon | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const searchRef = useRef<any>(null);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _ignoreSessionProp = sessionId;
  const sidRef = useRef(`${runboxId}-${crypto.randomUUID()}`);

  const gone           = useRef(false);
  const spawned        = useRef(false);
  const hasSpawnedOnce = useRef(false);

  const agentCmdRef   = useRef(agentCmd);
  const runboxNameRef = useRef(runboxName);
  const runboxCwdRef  = useRef(runboxCwd);
  const onWorktreeRef = useRef(onWorktreeReady);
  const onSessionRef  = useRef(onSessionChange);
  const onCwdRef      = useRef(onCwdChange);
  const onAgentDetectedRef = useRef(onAgentDetected);
  useEffect(() => { agentCmdRef.current        = agentCmd;        }, [agentCmd]);
  useEffect(() => { runboxNameRef.current      = runboxName;      }, [runboxName]);
  useEffect(() => { runboxCwdRef.current       = runboxCwd;       }, [runboxCwd]);
  useEffect(() => { onWorktreeRef.current      = onWorktreeReady; }, [onWorktreeReady]);
  useEffect(() => { onSessionRef.current       = onSessionChange; }, [onSessionChange]);
  useEffect(() => { onCwdRef.current           = onCwdChange;     }, [onCwdChange]);
  useEffect(() => { onAgentDetectedRef.current = onAgentDetected; }, [onAgentDetected]);

  // ── Agent detection ──────────────────────────────────────────────────────
  const AGENT_CMDS: Record<string, string> = {
    claude:        "claude",
    "claude-code":  "claude",
    gemini:        "gemini",
    codex:         "codex",
    cursor:        "cursor",
    copilot:       "copilot",
    "gh-copilot":  "copilot",
    aider:         "aider",
  };
  const inputLineRef      = useRef("");
  const activeAgentRef    = useRef<string | null>(null);
  // Buffer for incomplete OSC sequences split across PTY data chunks
  const oscBufRef         = useRef("");

  // ── State ────────────────────────────────────────────────────────────────
  const [liveCwd,   setLiveCwd]   = useState(runboxCwd);
  const liveCwdRef = useRef(liveCwd);
  useEffect(() => { liveCwdRef.current = liveCwd; }, [liveCwd]);

  // When the workspace root directory changes (user picks a new folder),
  // move every existing terminal shell into the new directory and update
  // the header + tab label so everything stays in sync.
  useEffect(() => {
    if (!runboxCwd || runboxCwd === liveCwdRef.current) return;
    // Only act after the PTY has actually spawned — skip the initial mount.
    if (!hasSpawnedOnce.current) return;
    invoke("pty_write", { sessionId: sidRef.current, data: `cd ${JSON.stringify(runboxCwd)}\r` }).catch(() => {});
    setLiveCwd(runboxCwd);
    onCwdRef.current?.(runboxCwd);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runboxCwd]);

  // When a directory is renamed from the file panel, update any terminal whose
  // CWD is inside that directory and send a `cd` to keep the shell in sync.
  useEffect(() => {
    const handler = (e: Event) => {
      const { from, to } = (e as CustomEvent<{ from: string; to: string }>).detail;
      const cur = liveCwdRef.current;
      if (!cur || !from || !to) return;

      const norm   = (p: string) => p.replace(/\\/g, "/").replace(/\/$/, "");
      const nCur   = norm(cur);
      const nFrom  = norm(from);
      const nTo    = norm(to);

      if (nCur !== nFrom && !nCur.startsWith(nFrom + "/")) return;

      // Build the new path (handles both exact match and sub-directory)
      const newCwd = nTo + nCur.slice(nFrom.length);

      // Move the shell into the renamed directory
      invoke("pty_write", { sessionId: sidRef.current, data: `cd ${JSON.stringify(newCwd)}\r` }).catch(() => {});

      setLiveCwd(newCwd);
      onCwdRef.current?.(newCwd);
    };

    window.addEventListener("sb:dir-renamed", handler);
    return () => window.removeEventListener("sb:dir-renamed", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; hasSel: boolean } | null>(null);

  // Inject CSS once
  useEffect(() => {
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
    setCtxMenu(null); termRef.current?.focus();
  }, []);

  const ctxCopyCwd = useCallback(() => {
    clipWrite(liveCwdRef.current);
    setCtxMenu(null); termRef.current?.focus();
  }, []);

  const ctxSplitDown  = useCallback(() => { setCtxMenu(null); onSplitDown?.(); },  [onSplitDown]);
  const ctxSplitRight = useCallback(() => { setCtxMenu(null); onSplitLeft?.(); },  [onSplitLeft]);
  const ctxClose      = useCallback(() => { setCtxMenu(null); onClose?.(); },       [onClose]);

  // ── Main terminal lifecycle ───────────────────────────────────────────────
  useEffect(() => {
    if (!termElRef.current) return;
    gone.current    = false;
    spawned.current = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let searchAddon: any = null;

    const term = new Terminal({
      cursorBlink:           true,
      cursorStyle:           "bar",
      cursorWidth:           1.5,
      fontSize:              15,
      lineHeight:            1.2,
      letterSpacing:         0.3,
      fontWeight:            "normal",
      fontWeightBold:        "bold",
      fontFamily:            "ui-monospace,'SF Mono',Menlo,Monaco,'Cascadia Mono',Consolas,'Courier New',monospace",
      theme:                 TERM_THEME,
      scrollback:            50_000,
      allowTransparency:     true,
      macOptionIsMeta:       true,
      rightClickSelectsWord: false,
      disableStdin:          false,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.loadAddon(new ClipboardAddon());

    try {
      searchAddon = new SearchAddon();
      term.loadAddon(searchAddon);
      searchRef.current = searchAddon;
    } catch { /* SearchAddon unavailable */ }

    // Open the terminal into the DOM *first* — renderer addons (WebGL, Canvas)
    // require the terminal to be mounted before they can initialize their canvas.
    // Loading WebGL before open() causes it to attach incorrectly and produces
    // the garbled / repeated-character rendering artifact seen on Windows.
    term.open(termElRef.current);
    termRef.current = term;
    fitRef.current  = fit;

    // WebGL2 — must be loaded AFTER term.open(). Falls back to DOM renderer on
    // context loss (GPU reset, driver crash, tab backgrounded on low-memory devices).
    try {
      const wgl = new WebglAddon();
      wgl.onContextLoss(() => {
        wgl.dispose();
        // After WebGL is gone xterm reverts to the DOM renderer automatically.
        // We need to re-fit (recalculates cell size for the DOM renderer) and
        // then do a full refresh so every row is repainted cleanly.
        requestAnimationFrame(() => {
          try {
            if (!gone.current && fitRef.current && termRef.current && termRef.current.rows > 0) {
              fitRef.current.fit();
              termRef.current.refresh(0, termRef.current.rows - 1);
            }
          } catch { /* ignore */ }
        });
      });
      term.loadAddon(wgl);
    } catch { /* DOM renderer fallback — fine, xterm renders via DOM */ }

    invoke<boolean>("pty_session_alive", { runboxId })
      .then(alive => { if (alive) hasSpawnedOnce.current = true; })
      .catch(() => {});

    // ── Native right-click handler ────────────────────────────────────────
    const ctxEl = termElRef.current!;
    const handleNativeCtx = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const hasSel = (termRef.current?.getSelection()?.length ?? 0) > 0;
      setCtxMenu({ x: e.clientX, y: e.clientY, hasSel });
    };
    ctxEl.addEventListener("contextmenu", handleNativeCtx, true);

    // ── Keyboard shortcuts ───────────────────────────────────────────────
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type !== "keydown") return true;
      const ctrl  = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;

      if (ctrl && shift && e.key === "C") {
        const sel = term.getSelection();
        if (sel) clipWrite(sel);
        return false;
      }
      if (ctrl && shift && e.key === "V") {
        clipRead().then(t => {
          if (t) invoke("pty_write", { sessionId: sidRef.current, data: t }).catch(() => {});
        });
        return false;
      }
      if (ctrl && shift && e.key === "A") {
        term.selectAll();
        return false;
      }
      if (ctrl && shift && e.key === "K") {
        term.clear();
        return false;
      }
      if (e.metaKey && !shift && e.key === "l") {
        invoke("pty_write", { sessionId: sidRef.current, data: "\x0c" }).catch(() => {});
        return false;
      }
      return true;
    });

    // Forward keypresses to PTY + agent detection + CWD polling
    term.onData(data => {
      invoke("pty_write", { sessionId: sidRef.current, data }).catch(() => {});

      if (data === "\r" || data === "\n") {
        const cmd = inputLineRef.current.trim().toLowerCase().split(/\s+/)[0] ?? "";
        const agentKey = AGENT_CMDS[cmd];
        if (agentKey && activeAgentRef.current !== agentKey) {
          activeAgentRef.current = agentKey;
          onAgentDetectedRef.current?.(agentKey);
        }

        // Poll backend for real CWD after every Enter — catches Windows shells
        // (PowerShell, cmd.exe) that don't auto-emit OSC 7 on directory change.
        // Two passes: 350 ms (fast commands) + 1200 ms (slow commands / agents).
        const pollCwd = () => {
          invoke<string>("pty_get_cwd", { sessionId: sidRef.current })
            .then(cwd => {
              if (!cwd || gone.current) return;
              // Normalise and apply the same home-folder collapsing as OSC 7
              let p = cwd.replace(/\\/g, "/");
              p = p.replace(/^\/([A-Za-z]:[/])/, "$1");
              const homePatterns = [
                /^[A-Za-z]:\/Users\/[^/]+(\/|$)/,
                /^\/Users\/[^/]+(\/|$)/,
                /^\/home\/[^/]+(\/|$)/,
              ];
              for (const re of homePatterns) {
                const hm = p.match(re);
                if (hm) { p = "~/" + p.slice(hm[0].length); break; }
              }
              p = p.replace(/^~\/\//, "~/");
              if (p !== "~/") p = p.replace(/\/$/, "");
              const display = /[/\\]calus-wt-[^/\\]*$/.test(p)
                ? (runboxCwdRef.current ?? p)
                : p;
              if (display && display !== liveCwdRef.current) {
                setLiveCwd(display);
                onCwdRef.current?.(display);
              }
            })
            .catch(() => {}); // backend may not support yet — silent fallback to OSC 7
        };

        setTimeout(pollCwd, 350);
        setTimeout(pollCwd, 1200);

        inputLineRef.current = "";
      } else if (data === "\x7f" || data === "\b") {
        inputLineRef.current = inputLineRef.current.slice(0, -1);
      } else if (data === "\x03" || data === "\x04") {
        inputLineRef.current = "";
      } else if (data.length === 1 && data >= " ") {
        inputLineRef.current += data;
      }
    });

    // Full repaint after fit — clears ghost/stale pixels from old size (WebGL).
    const safeRefresh = () => {
      const t = termRef.current;
      if (!t || t.rows <= 0) return;
      try { t.refresh(0, t.rows - 1); } catch { /* ignore */ }
    };

    let unlisteners: Array<UnlistenFn | null> = [];
    let restartDisposable: { dispose: () => void } | null = null;

    // ── Spawn PTY ────────────────────────────────────────────────────────
    const spawnPty = (sid: string, cols: number, rows: number) => {
      // Guard: never spawn into "/" or an empty path — fall back to "~/" so the
      // shell starts in the user's home directory rather than the filesystem root.
      let effectiveCwd = runboxCwdRef.current && runboxCwdRef.current !== "/"
        ? runboxCwdRef.current
        : "~/";
      // OSC 7 on Windows encodes paths with a leading "/" before the drive letter
      // (e.g. "/C:/Users/foo"). Strip that leading "/" so the Rust backend receives
      // a valid Windows path ("C:/Users/foo") — otherwise the backend silently
      // fails to chdir and the shell starts in home, reporting "~/" via OSC 7.
      effectiveCwd = effectiveCwd.replace(/^\/([A-Za-z]:[/\\])/, "$1");
      invoke("pty_spawn", {
        sessionId:     sid,
        runboxId,
        cwd:           effectiveCwd,
        agentCmd:      agentCmdRef.current ?? null,
        workspaceName: runboxNameRef.current ?? null,
        cols,
        rows,
      })
        .then(() => {
          hasSpawnedOnce.current = true;
          invoke<string | null>("get_worktree_path", { sessionId: sidRef.current, runboxId })
            .then(wt => { if (wt) onWorktreeRef.current?.(wt); })
            .catch(() => {});
        })
        .catch(err => {
          if (!gone.current) {
            term.write(`\r\n\x1b[38;5;196m[calus] spawn failed: ${err}\x1b[0m\r\n`);
          }
        });
    };

    // ── Event listeners ──────────────────────────────────────────────────
    const setupListeners = (sid: string): Promise<void> => {
      for (const u of unlisteners) u?.();
      unlisteners = [];
      restartDisposable?.dispose();
      restartDisposable = null;

      return Promise.all([
        listen<string>(`pty://output/${sid}`, ({ payload }) => {
          if (gone.current) return;
          term.write(payload);

          // Prepend any leftover partial OSC sequence from the previous chunk
          // so split sequences spanning two chunks are assembled before parsing.
          const combined = oscBufRef.current + payload;
          const { paths, remainder } = extractOsc7(combined);
          oscBufRef.current = remainder.length < 4096 ? remainder : "";

          if (paths.length > 0) {
            const cwd = paths[paths.length - 1];
            const display = /[/\\]calus-wt-[^/\\]*$/.test(cwd)
              ? (runboxCwdRef.current ?? cwd)
              : cwd;
            setLiveCwd(display);
            onCwdRef.current?.(display);

            if (activeAgentRef.current) {
              activeAgentRef.current = null;
              onAgentDetectedRef.current?.(null);
            }
          }

          if (activeAgentRef.current) {
            const stripped = payload.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
            const lines = stripped.split(/\r?\n/);
            for (const line of lines) {
              const t = line.trimEnd();
              if (/[$%>#]\s*$/.test(t) && t.length < 120) {
                activeAgentRef.current = null;
                onAgentDetectedRef.current?.(null);
                break;
              }
            }
          }
        }),

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
            setupListeners(newSid).then(() => {
              if (!gone.current) spawnPty(newSid, term.cols, term.rows);
            });
          });
          restartDisposable = d;
        }),
      ]).then(([outUL, endedUL]) => {
        unlisteners = [outUL, endedUL];
      }).catch((err) => {
        console.error("[TerminalPane] Failed to register PTY listeners:", err);
      });
    };

    const listenersReady = setupListeners(sidRef.current);

    const doSpawn = () => {
      spawned.current = true;
      term.focus();
      listenersReady.then(() => {
        if (!gone.current) {
          spawnPty(sidRef.current, term.cols, term.rows);
          // Flush any stale WebGL pixels from before the PTY connected
          requestAnimationFrame(safeRefresh);
        }
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
        doSpawn();
      } else if (spawned.current) {
        invoke("pty_resize", { sessionId: sidRef.current, cols: term.cols, rows: term.rows }).catch(() => {});
        // Repaint after resize to flush ghost pixels and re-anchor prompt
        requestAnimationFrame(safeRefresh);
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
      invoke("pty_kill", { sessionId: sidRef.current }).catch(() => {});
      term.dispose();
      termRef.current = null;
      fitRef.current  = null;
      searchRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Mousedown: activate + immediate focus ─────────────────────────────────
  const handleMouseDown = useCallback(() => {
    onActivate?.();
    termRef.current?.focus();
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
        <div className="rp-xterm" ref={termElRef} />
      </div>

      {/* ── Right-click context menu ──────────────────────────────────── */}
      {ctxMenu && (
        <div
          className="rp-ctx"
          style={{ top: ctxY, left: ctxX }}
          onMouseDown={e => {
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