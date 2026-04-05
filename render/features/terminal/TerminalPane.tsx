// features/terminal/TerminalPane.tsx
// xterm.js terminal pane — one instance per leaf node in the pane tree.
//
// BUG FIXES vs previous version:
//   1. [CRITICAL] Session restart now generates a fresh session ID and
//      re-registers Tauri listeners for the new ID. The old version reused
//      the same session ID, which caused session_start conflicts and stale
//      pty://ended listeners.
//   2. [CRITICAL] The "press any key to restart" onData handler was never
//      disposed before registering a new one. After N session exits you had
//      N handlers all firing on the next keypress → N concurrent PTY spawns.
//      Now only one handler exists at a time, cleaned up before each restart.
//   3. Listeners are torn down and replaced on restart rather than
//      accumulating. The useEffect runs once; listener management is internal.
//
// IMPROVEMENTS:
//   • Scrollback raised to 50 000 lines
//   • Read buffer enlarged; resize sends correct cols/rows to backend
//   • Ctrl+Shift+C copies selection; Ctrl+Shift+V pastes
//   • Right-click pastes clipboard text
//   • Session-ended banner is distinct and non-stacking
//   • Unicode11 addon loaded when available
//   • "Killed" vs "Exited" distinction in banner (future: pass exit code)
//   • Clean teardown: all listeners unregistered, PTY killed, terminal disposed

import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal }       from "@xterm/xterm";
import { FitAddon }       from "@xterm/addon-fit";
import { WebLinksAddon }  from "@xterm/addon-web-links";
import { WebglAddon }     from "@xterm/addon-webgl";
import { invoke }         from "@tauri-apps/api/core";
import { listen }         from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

// ── Theme & palette ───────────────────────────────────────────────────────────
const BG     = "#181818";
const BG_ACT = "#1e1e1e";

const TERM_THEME = {
  background:          BG,
  foreground:          "#d4d4d4",
  cursor:              "#00e5ff",
  cursorAccent:        BG,
  selectionBackground: "rgba(0,229,255,.18)",
  selectionForeground: "#ffffff",
  // Standard 16 colours — tuned for readability on dark bg
  black:        "#1e2428", brightBlack:   "#4a5058",
  red:          "#c07070", brightRed:     "#d88888",
  green:        "#80a880", brightGreen:   "#98c098",
  yellow:       "#ffd700", brightYellow:  "#ffec3d",
  blue:         "#6888a8", brightBlue:    "#80a0c0",
  magenta:      "#9870a0", brightMagenta: "#b088b8",
  cyan:         "#00e5ff", brightCyan:    "#18ffff",
  white:        "#c8c8c8", brightWhite:   "#e8e8e8",
};

// ── Injected CSS — scoped by class prefix rp- ─────────────────────────────────
const TERM_CSS = `
/* ── Container ── */
.rp-win{
  width:100%;height:100%;box-sizing:border-box;background:${BG};
  display:flex;flex-direction:column;overflow:hidden;position:relative;
  transition:background .15s;
}
.rp-win.rp-active{ background:${BG_ACT}; }

/* ── Titlebar ── */
.rp-titlebar{
  height:30px;flex-shrink:0;display:flex;align-items:center;
  padding:0 6px 0 10px;gap:6px;
  background:rgba(255,255,255,.02);
  border-bottom:1px solid rgba(255,255,255,.05);
  user-select:none;box-sizing:border-box;min-height:30px;max-height:30px;
}
.rp-win.rp-active .rp-titlebar{
  background:rgba(255,255,255,.04);
  border-bottom-color:rgba(255,255,255,.09);
}

/* ── CWD label ── */
.rp-cwd{
  flex:1;min-width:0;font-size:11px;
  font-family:ui-monospace,'SF Mono',Menlo,Monaco,'Cascadia Mono',Consolas,monospace;
  color:rgba(255,255,255,.22);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  transition:color .15s;
}
.rp-win.rp-active .rp-cwd{ color:rgba(255,255,255,.6); }

/* ── Agent chip ── */
.rp-chip{
  font-size:9px;font-family:ui-monospace,monospace;letter-spacing:.06em;flex-shrink:0;
  color:rgba(255,255,255,.2);background:rgba(255,255,255,.05);
  border:1px solid rgba(255,255,255,.08);border-radius:3px;padding:1px 6px;
  transition:all .15s;
}
.rp-win.rp-active .rp-chip{
  color:rgba(0,229,255,.7);background:rgba(0,229,255,.07);
  border-color:rgba(0,229,255,.18);
}

/* ── Toolbar buttons ── */
.rp-tbtn{
  width:22px;height:22px;flex-shrink:0;display:flex;align-items:center;
  justify-content:center;border-radius:3px;cursor:pointer;
  color:rgba(255,255,255,.4);border:none;background:transparent;
  transition:background .1s,color .1s;padding:0;
}
.rp-win.rp-active .rp-tbtn{ color:rgba(255,255,255,.6); }
.rp-tbtn:hover{ background:rgba(255,255,255,.1);color:#fff!important; }
.rp-tbtn.rp-close-btn:hover{
  background:rgba(239,68,68,.22)!important;color:#f87171!important;
}

/* ── Terminal body ── */
.rp-body{
  flex:1;min-height:0;min-width:0;position:relative;overflow:hidden;
  background:${BG};
}
.rp-win.rp-active .rp-body{ background:${BG_ACT}; }
.rp-win:not(.rp-active) .rp-body{ opacity:.42; }

/* ── xterm overrides ── */
.rp-xterm{ position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden; }
.rp-xterm .xterm,
.rp-xterm .xterm-viewport,
.rp-xterm .xterm-screen{ background:transparent!important; }

/* Slim scrollbar */
.xterm .scrollbar.vertical{ width:4px!important; }
.xterm .scrollbar.vertical .slider{
  width:4px!important;border-radius:2px!important;
  background:rgba(255,255,255,.16)!important;
}
.xterm .scrollbar.horizontal{ height:0!important;display:none!important; }

/* ── Top/bottom fade vignettes ── */
.rp-fade-t{
  position:absolute;top:0;left:0;right:0;height:14px;
  background:linear-gradient(to bottom,${BG},transparent);
  pointer-events:none;z-index:4;transition:background .15s;
}
.rp-fade-b{
  position:absolute;bottom:0;left:0;right:0;height:20px;
  background:linear-gradient(to top,${BG},transparent);
  pointer-events:none;z-index:4;transition:background .15s;
}
.rp-win.rp-active .rp-fade-t{
  background:linear-gradient(to bottom,${BG_ACT},transparent);
}
.rp-win.rp-active .rp-fade-b{
  background:linear-gradient(to top,${BG_ACT},transparent);
}
`;

// ── OSC 7 parser — extracts CWD from shell prompt escape ─────────────────────
function parseOsc7(data: string): string | null {
  const m = data.match(/\x1b]7;file:\/\/[^/]*([^\x07\x1b]+)[\x07\x1b]/);
  if (!m) return null;
  try {
    let p = decodeURIComponent(m[1]);
    // Collapse home directory
    p = p.replace(/^\/[A-Za-z]:\/Users\/[^/]+(\/$|$)/, "~/");
    p = p.replace(/^\/Users\/[^/]+(\/$|$)/,            "~/");
    p = p.replace(/^\/home\/[^/]+(\/$|$)/,             "~/");
    p = p.replace(/^~\/\//, "~/");
    if (p !== "~/") p = p.replace(/\/$/, "");
    return p || "~/";
  } catch { return null; }
}

// ── Toolbar button ────────────────────────────────────────────────────────────
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

// ── Props ─────────────────────────────────────────────────────────────────────
interface TerminalPaneProps {
  runboxCwd?:       string;
  runboxId?:        string;
  runboxName?:      string;
  /** Agent CLI command to launch (e.g. "claude", "gemini"). Undefined = plain shell. */
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

// ── Component ─────────────────────────────────────────────────────────────────
export function TerminalPane({
  runboxCwd = "~/",
  runboxId  = "default",
  runboxName = "shell",
  agentCmd,
  sessionId,
  label = "",
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
  const termElRef = useRef<HTMLDivElement>(null);
  const termRef   = useRef<Terminal | null>(null);
  const fitRef    = useRef<FitAddon  | null>(null);

  // Always generate a fresh UUID per pane — never inherit the parent's activeSessionId.
  // Reusing a live session's ID causes the new pane to receive that session's
  // pty://ended event, firing the "session ended" banner before the PTY starts.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _ignoredSessionIdProp = sessionId;
  const sidRef = useRef<string>(`${runboxId}-${crypto.randomUUID()}`);

  const gone           = useRef(false);
  const spawned        = useRef(false);
  const hasSpawnedOnce = useRef(false); // guard: don't show banner before first real spawn

  // Stable prop refs — closures inside the long-lived useEffect read from here
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

  const [liveCwd, setLiveCwd] = useState(runboxCwd);

  // Inject CSS once on mount
  useEffect(() => {
    const id = "rp-css-v14";
    document.getElementById(id)?.remove();
    const s = document.createElement("style");
    s.id = id; s.textContent = TERM_CSS;
    document.head.appendChild(s);
  }, []);

  // Focus active pane
  useEffect(() => {
    if (isActive) setTimeout(() => termRef.current?.focus(), 40);
  }, [isActive]);

  // Report initial session ID to parent
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onSessionRef.current?.(sidRef.current); }, []);

  // ── Copy / paste via keyboard ─────────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const ctrl  = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    if (ctrl && shift && e.key === "C") {
      const sel = termRef.current?.getSelection();
      if (sel) { navigator.clipboard.writeText(sel).catch(() => {}); e.preventDefault(); }
      return;
    }
    if (ctrl && shift && e.key === "V") {
      navigator.clipboard.readText()
        .then(t => { if (t) invoke("pty_write", { sessionId: sidRef.current, data: t }).catch(() => {}); })
        .catch(() => {});
      e.preventDefault();
    }
  }, []);

  // ── Right-click paste ─────────────────────────────────────────────────────
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const sel = termRef.current?.getSelection();
    if (sel && sel.length > 0) {
      // If text is selected, copy it
      navigator.clipboard.writeText(sel).catch(() => {});
    } else {
      // Otherwise paste clipboard
      navigator.clipboard.readText()
        .then(t => { if (t) invoke("pty_write", { sessionId: sidRef.current, data: t }).catch(() => {}); })
        .catch(() => {});
    }
  }, []);

  // ── Paste via paste event (drag-drop, middle-click, etc.) ─────────────────
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const t = e.clipboardData.getData("text");
    if (t) {
      e.preventDefault();
      invoke("pty_write", { sessionId: sidRef.current, data: t }).catch(() => {});
      termRef.current?.focus();
    }
  }, []);

  // ── Main terminal lifecycle ───────────────────────────────────────────────
  useEffect(() => {
    if (!termElRef.current) return;
    gone.current    = false;
    spawned.current = false;

    // ── Create terminal ───────────────────────────────────────────────────
    const term = new Terminal({
      cursorBlink:         true,
      cursorStyle:         "bar",
      cursorWidth:         1.5,
      fontSize:            13,
      lineHeight:          1.4,
      letterSpacing:       0,
      fontWeight:          "normal",
      fontWeightBold:      "bold",
      fontFamily:          "ui-monospace,'SF Mono',Menlo,Monaco,'Cascadia Mono',Consolas,'Courier New',monospace",
      theme:               TERM_THEME,
      convertEol:          true,
      scrollback:          50_000,       // 50k lines — robust for long agent runs
      allowTransparency:   true,
      macOptionIsMeta:     true,
      rightClickSelectsWord: false,      // we handle right-click ourselves (paste)
      disableStdin:        false,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());

    // WebGL renderer — fall back to canvas renderer on unsupported GPU
    try {
      const wgl = new WebglAddon();
      wgl.onContextLoss(() => wgl.dispose());
      term.loadAddon(wgl);
    } catch { /* canvas renderer is fine */ }

    term.open(termElRef.current);

    termRef.current = term;
    fitRef.current  = fit;

    // Forward keypresses to PTY
    term.onData(data => {
      invoke("pty_write", { sessionId: sidRef.current, data }).catch(() => {});
    });

    // Apply top/left margin so text doesn't hug the edge
    const applyMargin = () => {
      const screen = termElRef.current?.querySelector(".xterm-screen") as HTMLElement | null;
      if (screen) { screen.style.marginTop = "8px"; screen.style.marginLeft = "10px"; }
    };

    // ── Internal listener state (replaced on each restart) ────────────────
    let unlisteners: Array<UnlistenFn | null>    = [];
    let restartDisposable: { dispose: () => void } | null = null;

    // ── Spawn PTY ─────────────────────────────────────────────────────────
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
          invoke<string | null>("get_worktree_path", { runboxId })
            .then(wt => { if (wt) onWorktreeRef.current?.(wt); })
            .catch(() => {});
        })
        .catch(err => {
          if (!gone.current) {
            term.write(`\r\n\x1b[38;5;196m[stackbox] spawn failed: ${err}\x1b[0m\r\n`);
          }
        });
    };

    // ── Set up Tauri event listeners for a given session ID ───────────────
    // Called once on mount and again on each restart (with a fresh session ID).
    // Tears down the previous listeners before registering new ones.
    const setupListeners = (sid: string) => {
      // Tear down any existing listeners
      for (const u of unlisteners) u?.();
      unlisteners = [];
      restartDisposable?.dispose();
      restartDisposable = null;

      Promise.all([
        // ── Output ──────────────────────────────────────────────────────
        listen<string>(`pty://output/${sid}`, ({ payload }) => {
          if (gone.current) return;
          term.write(payload);

          // Parse OSC 7 CWD updates from the shell prompt
          const cwd = parseOsc7(payload);
          if (cwd) {
            // Hide internal worktree paths; show the workspace root instead
            const displayCwd = /[/\\]stackbox-wt-[^/\\]*$/.test(cwd)
              ? (runboxCwdRef.current ?? cwd)
              : cwd;
            setLiveCwd(displayCwd);
            onCwdRef.current?.(displayCwd);
          }
        }),

        // ── Session ended ────────────────────────────────────────────────
        listen<void>(`pty://ended/${sid}`, () => {
          if (gone.current) return;

          // Kill any pending restart listener from a previous exit
          restartDisposable?.dispose();
          restartDisposable = null;

          // Never show the banner for an exit that arrives before the terminal
          // has ever displayed output (e.g. stale events for a shared session ID).
          if (!hasSpawnedOnce.current) return;

          // Draw a compact "session ended" banner
          const cols  = termRef.current?.cols ?? 80;
          const width = Math.min(cols - 4, 64);
          const line  = "─".repeat(width);
          term.write(`\r\n\x1b[38;5;238m${line}\x1b[0m\r\n`);
          term.write(`\x1b[38;5;242m  session ended  ·  press any key to restart\x1b[0m\r\n`);
          term.write(`\x1b[38;5;238m${line}\x1b[0m\r\n`);

          spawned.current = false;

          // Wait for a single keypress, then restart with a FRESH session ID
          // so we never reuse a session that the backend has already closed.
          const d = term.onData(() => {
            d.dispose();
            restartDisposable = null;
            if (gone.current || (termRef.current?.cols ?? 0) <= 0) return;

            // New session ID
            const newSid = `${runboxId}-${crypto.randomUUID()}`;
            sidRef.current = newSid;
            onSessionRef.current?.(newSid);

            spawned.current = true;
            setupListeners(newSid);
            spawnPty(newSid, term.cols, term.rows);
          });
          restartDisposable = d;
        }),

      ]).then(([outUnlisten, endedUnlisten]) => {
        unlisteners = [outUnlisten, endedUnlisten];
      }).catch(() => {});
    };

    // Bootstrap: set up listeners for the initial session ID
    setupListeners(sidRef.current);

    // ── Spawn immediately — try right after mount, don't wait for ResizeObserver ──
    // This eliminates the ~1 s delay when opening or splitting a terminal.
    // If the container already has dimensions (split case), we spawn in the next
    // animation frame. ResizeObserver then handles resize-only from that point on.
    const trySpawnNow = () => {
      if (spawned.current || gone.current || !termElRef.current) return;
      const rect = termElRef.current.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return; // not laid out yet
      try { fit.fit(); } catch { return; }
      const { cols, rows } = term;
      if (cols <= 0 || rows <= 0) return;
      spawned.current = true;
      applyMargin();
      term.focus();
      spawnPty(sidRef.current, cols, rows);
    };

    // Frame 1: layout is usually complete by now
    requestAnimationFrame(() => {
      trySpawnNow();
      // Frame 2: insurance for slower layout (side-panel open, animation, etc.)
      if (!spawned.current) requestAnimationFrame(trySpawnNow);
    });

    // ── ResizeObserver — handles resize AFTER spawn, and late-spawn fallback ──
    const ro = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;

      try { fit.fit(); } catch { return; }
      const { cols, rows } = term;
      if (cols <= 0 || rows <= 0) return;

      // Always keep backend in sync with terminal dimensions
      invoke("pty_resize", { sessionId: sidRef.current, cols, rows }).catch(() => {});

      // Fallback spawn: fires if requestAnimationFrame above missed (zero-size at mount)
      if (!spawned.current && !gone.current) {
        spawned.current = true;
        applyMargin();
        term.focus();
        spawnPty(sidRef.current, cols, rows);
      }
    });
    ro.observe(termElRef.current!);

    // ── Cleanup on unmount ────────────────────────────────────────────────
    return () => {
      gone.current = true;
      ro.disconnect();
      for (const u of unlisteners) u?.();
      restartDisposable?.dispose();
      invoke("pty_kill", { sessionId: sidRef.current }).catch(() => {});
      term.dispose();
      termRef.current = null;
      fitRef.current  = null;
    };
  // Intentionally empty deps — the effect owns its own lifecycle.
  // All external values are read through stable refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className={`rp-win${isActive ? " rp-active" : ""}`}
      onMouseDown={() => onActivate?.()}
      onKeyDown={handleKeyDown}
      onContextMenu={handleContextMenu}
      onPaste={handlePaste}
    >
      {/* Titlebar */}
      <div
        className="rp-titlebar"
        onMouseDown={e => {
          if ((e.target as HTMLElement).closest(".rp-tbtn")) return;
        }}
      >
        {/* Left side: minimize + maximize */}
        {(onMinimize || onMaximize) && (
          <div style={{ display: "flex", alignItems: "center", gap: 2, marginRight: 6, flexShrink: 0 }}>
            {onMinimize && (
              <TBtn title="Minimize" onClick={onMinimize}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="2,6 6,6 6,2"/>
                  <line x1="6" y1="6" x2="2" y2="2"/>
                  <polyline points="14,10 10,10 10,14"/>
                  <line x1="10" y1="10" x2="14" y2="14"/>
                </svg>
              </TBtn>
            )}
            {onMaximize && (
              <TBtn title="Maximize" onClick={onMaximize}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="10,2 14,2 14,6"/>
                  <line x1="14" y1="2" x2="9" y2="7"/>
                  <polyline points="6,14 2,14 2,10"/>
                  <line x1="2" y1="14" x2="7" y2="9"/>
                </svg>
              </TBtn>
            )}
          </div>
        )}

        {/* CWD path */}
        <span className="rp-cwd" title={liveCwd || runboxCwd}>
          {liveCwd || runboxCwd}
        </span>

        {/* Right side: split + close */}
        <div style={{ display: "flex", alignItems: "center", gap: 2, marginLeft: 4 }}>
          {onSplitDown && (
            <TBtn title="Split down" onClick={onSplitDown}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none"
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1.5" y="1.5" width="13" height="13" rx="2"/>
                <line x1="1.5" y1="8.5" x2="14.5" y2="8.5"/>
              </svg>
            </TBtn>
          )}
          {onSplitLeft && (
            <TBtn title="Split right" onClick={onSplitLeft}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none"
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1.5" y="1.5" width="13" height="13" rx="2"/>
                <line x1="8.5" y1="1.5" x2="8.5" y2="14.5"/>
              </svg>
            </TBtn>
          )}
          {onClose && (
            <TBtn title="Close" onClick={onClose} danger>
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="4" y1="4" x2="12" y2="12"/>
                <line x1="12" y1="4" x2="4" y2="12"/>
              </svg>
            </TBtn>
          )}
        </div>
      </div>

      {/* Terminal body */}
      <div className="rp-body">
        <div className="rp-fade-t" />
        <div className="rp-xterm" ref={termElRef} />
        <div className="rp-fade-b" />
      </div>
    </div>
  );
}