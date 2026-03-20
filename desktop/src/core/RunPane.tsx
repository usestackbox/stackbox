// src/core/RunPane.tsx
import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

const THEME = {
  background:          "#0c0c0c",
  foreground:          "#e8e8e8",
  cursor:              "#ffffff",
  cursorAccent:        "#0c0c0c",
  selectionBackground: "rgba(255,255,255,.15)",
  selectionForeground: "#ffffff",
  black:          "#1a1a1a", brightBlack:   "#555555",
  red:            "#e06060", brightRed:     "#ff8080",
  green:          "#70a070", brightGreen:   "#90c890",
  yellow:         "#b09050", brightYellow:  "#d0b870",
  blue:           "#6888c0", brightBlue:    "#88aadd",
  magenta:        "#a070a0", brightMagenta: "#c090c0",
  cyan:           "#50a0a0", brightCyan:    "#70c0c0",
  white:          "#cccccc", brightWhite:   "#f0f0f0",
};

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap');

.sbx-wrap {
  width: 100%; height: 100%;
  background: #0c0c0c;
  display: flex; flex-direction: column;
  overflow: hidden; position: relative;
}

/* Warp-style top bar per pane */
.sbx-topbar {
  display: flex; align-items: center; gap: 8px;
  padding: 0 14px; height: 34px;
  background: #111111;
  border-bottom: 1px solid rgba(255,255,255,.05);
  flex-shrink: 0;
}
.sbx-topbar-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: rgba(255,255,255,.12); flex-shrink: 0;
}
.sbx-topbar-dot.on {
  background: rgba(255,255,255,.55);
}
.sbx-topbar-label {
  font-size: 11px;
  font-family: 'JetBrains Mono', monospace;
  color: rgba(255,255,255,.28);
  letter-spacing: .04em; flex: 1;
}

/* Terminal area */
.sbx-term-wrap {
  flex: 1; min-height: 0; min-width: 0;
  position: relative; overflow: hidden;
}

/* Active pane: subtle left accent */
.sbx-wrap.active .sbx-term-wrap::before {
  content: '';
  position: absolute; left: 0; top: 8px; bottom: 8px;
  width: 2px; background: rgba(255,255,255,.10);
  border-radius: 2px; z-index: 2;
}

.sbx-term {
  position: absolute; inset: 0;
  padding: 8px 0 8px 8px;
  box-sizing: border-box; cursor: text;
}

.sbx-term .xterm,
.sbx-term .xterm-viewport,
.sbx-term .xterm-screen {
  background: transparent !important;
}

/* Thin scrollbar like Warp */
.sbx-term .xterm-viewport::-webkit-scrollbar { width: 3px; }
.sbx-term .xterm-viewport::-webkit-scrollbar-track { background: transparent; }
.sbx-term .xterm-viewport::-webkit-scrollbar-thumb { background: rgba(255,255,255,.08); border-radius: 2px; }
.sbx-term .xterm-viewport::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.16); }

/* Inactive overlay — dims unfocused panes */
.sbx-inactive-overlay {
  position: absolute; inset: 0;
  background: rgba(0,0,0,.38);
  pointer-events: none; z-index: 5;
}
`;

function parseOsc7(data: string): string | null {
  const m = data.match(/\x1b]7;file:\/\/[^/]*([^\x07\x1b]+)[\x07\x1b]/);
  if (!m) return null;
  try {
    let p = decodeURIComponent(m[1]);
    p = p.replace(/^\/[A-Za-z]:\/Users\/[^/]+(\/|$)/, "~/");
    p = p.replace(/^\/Users\/[^/]+(\/|$)/, "~/");
    p = p.replace(/^\/home\/[^/]+(\/|$)/, "~/");
    p = p.replace(/^~\/\//, "~/");
    if (p !== "~/") p = p.replace(/\/$/, "");
    return p || "~/";
  } catch { return null; }
}

export default function RunPane({
  runboxCwd    = "~/",
  runboxId     = "default",
  sessionId,
  onCwdChange,
  onSessionChange,
  isActive,
  onActivate,
}: {
  runboxCwd?:       string;
  runboxId?:        string;
  sessionId?:       string;
  onCwdChange?:     (cwd: string) => void;
  onSessionChange?: (sid: string) => void;
  isActive?:        boolean;
  onActivate?:      () => void;
}) {
  const termElRef = useRef<HTMLDivElement>(null);
  const termRef   = useRef<Terminal | null>(null);
  const fitRef    = useRef<FitAddon | null>(null);
  const sidRef    = useRef<string>(sessionId ?? `${runboxId}-${crypto.randomUUID()}`);
  const gone      = useRef(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onSessionChange?.(sidRef.current); }, []);

  useEffect(() => {
    if (!document.getElementById("sbx-css")) {
      const s = document.createElement("style");
      s.id = "sbx-css"; s.textContent = CSS;
      document.head.appendChild(s);
    }
  }, []);

  useEffect(() => {
    if (isActive) setTimeout(() => termRef.current?.focus(), 30);
  }, [isActive]);

  const sendInput = useCallback((text: string) => {
    invoke("pty_write", { sessionId: sidRef.current, data: text }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!termElRef.current) return;
    gone.current = false;

    const term = new Terminal({
      cursorBlink:           true,
      cursorStyle:           "bar",
      cursorWidth:           2,
      fontSize:              14,
      fontFamily:            "'JetBrains Mono','Cascadia Code','Fira Code','Consolas',monospace",
      lineHeight:            1.6,
      letterSpacing:         0.3,
      theme:                 THEME,
      convertEol:            true,
      scrollback:            10000,
      allowTransparency:     true,
      macOptionIsMeta:       true,
      rightClickSelectsWord: true,
      disableStdin:          false,
    });

    const fit   = new FitAddon();
    // FIX: WebLinksAddon — no second arg, hover is not a valid option
    const links = new WebLinksAddon();
    term.loadAddon(fit);
    term.loadAddon(links);
    term.open(termElRef.current);

    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch { /* fallback to canvas */ }

    termRef.current = term;
    fitRef.current  = fit;

    term.onData(text => sendInput(text));

    requestAnimationFrame(() => {
      try { fit.fit(); } catch { /* */ }
      term.focus();
    });

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        invoke("pty_resize", {
          sessionId: sidRef.current, cols: term.cols, rows: term.rows,
        }).catch(() => {});
      } catch { /* */ }
    });
    ro.observe(termElRef.current!);

    let unlistenOutput: UnlistenFn | null = null;
    let unlistenEnded:  UnlistenFn | null = null;
    const sid = sidRef.current;
    let spawnedAt = 0;
    const GRACE_MS = 2000;

    Promise.all([
      listen<string>(`pty://output/${sid}`, ({ payload }) => {
        if (gone.current) return;
        term.write(payload);
        const cwd = parseOsc7(payload);
        if (cwd && onCwdChange) onCwdChange(cwd);
      }),
      listen<void>(`pty://ended/${sid}`, () => {
        if (gone.current) return;
        if (Date.now() - spawnedAt < GRACE_MS) return;
        // Warp-style clean "session ended" divider
        const w = Math.min(term.cols - 2, 56);
        term.write(`\r\n\x1b[38;5;238m${"─".repeat(w)}\x1b[0m\r\n`);
        term.write(`\x1b[2m  session ended  ·  press any key to restart\x1b[0m\r\n`);
        term.write(`\x1b[38;5;238m${"─".repeat(w)}\x1b[0m\r\n`);
        const d = term.onData(() => {
          d.dispose();
          spawnedAt = Date.now();
          invoke("pty_spawn", { sessionId: sid, runboxId, cwd: runboxCwd }).catch(() => {});
        });
      }),
    ]).then(([a, b]) => {
      unlistenOutput = a; unlistenEnded = b;
      spawnedAt = Date.now();
      return invoke("pty_spawn", { sessionId: sid, runboxId, cwd: runboxCwd });
    }).catch(err => {
      if (!gone.current) term.write(`\r\n\x1b[31m[error: ${err}]\x1b[0m\r\n`);
    });

    return () => {
      gone.current = true;
      ro.disconnect();
      unlistenOutput?.();
      unlistenEnded?.();
      invoke("pty_kill", { sessionId: sid }).catch(() => {});
      term.dispose();
      termRef.current = null;
      fitRef.current  = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMouseDown = useCallback(() => {
    onActivate?.();
    setTimeout(() => { termRef.current?.focus(); termRef.current?.scrollToBottom(); }, 0);
  }, [onActivate]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text");
    if (text) { e.preventDefault(); sendInput(text); }
  }, [sendInput]);

  const shortCwd = runboxCwd.split(/[/\\]/).filter(Boolean).pop() ?? runboxCwd;

  return (
    <div
      className={`sbx-wrap${isActive ? " active" : ""}`}
      onMouseDown={handleMouseDown}
      onPaste={handlePaste}
    >
      <div className="sbx-topbar">
        <div className={`sbx-topbar-dot${isActive ? " on" : ""}`} />
        <span className="sbx-topbar-label">{shortCwd}</span>
      </div>

      {/* Terminal */}
      <div className="sbx-term-wrap">
        <div className="sbx-term" ref={termElRef} />
        {!isActive && <div className="sbx-inactive-overlay" />}
      </div>
    </div>
  );
}