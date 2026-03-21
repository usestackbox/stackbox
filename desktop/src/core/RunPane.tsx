// src/core/RunPane.tsx
import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

// ── Theme — monochrome ────────────────────────────────────────────────────────
const THEME = {
  background:          "#0c0c0c",
  foreground:          "#d8d8d8",
  cursor:              "#c8c8c8",
  cursorAccent:        "#0c0c0c",
  selectionBackground: "rgba(255,255,255,.13)",
  selectionForeground: "#ffffff",
  black:   "#181818", brightBlack:   "#484848",
  red:     "#c07070", brightRed:     "#d88888",
  green:   "#80a880", brightGreen:   "#98c098",
  yellow:  "#a89060", brightYellow:  "#c0a870",
  blue:    "#6888a8", brightBlue:    "#80a0c0",
  magenta: "#9870a0", brightMagenta: "#b088b8",
  cyan:    "#489898", brightCyan:    "#60b0b0",
  white:   "#c8c8c8", brightWhite:   "#e8e8e8",
};

// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,400;0,500;0,600;1,400&display=swap');

/* ── Root ── */
.sbx-wrap {
  width: 100%; height: 100%;
  background: #0c0c0c;
  display: flex; flex-direction: column;
  overflow: hidden;
}

/* ── Output area ── */
.sbx-output {
  flex: 1; min-height: 0; position: relative; overflow: hidden;
  background: #0c0c0c;
  display: flex; flex-direction: column;
}

/* Active top accent strip */
.sbx-output-header {
  height: 2px; flex-shrink: 0;
  margin: 5px 9px 0;
  border-radius: 1px 1px 0 0;
  background: rgba(255,255,255,.06);
  transition: background .2s;
}
.sbx-wrap.active .sbx-output-header {
  background: rgba(255,255,255,.20);
}

/* Active left accent */
.sbx-wrap.active .sbx-output::before {
  content: '';
  position: absolute; left: 0; top: 0; bottom: 0; width: 2px;
  background: linear-gradient(to bottom,
    transparent 0%,
    rgba(255,255,255,.09) 20%,
    rgba(255,255,255,.09) 80%,
    transparent 100%);
  z-index: 6; pointer-events: none;
}

/* Output card */
.sbx-output-card {
  flex: 1; min-height: 0; position: relative;
  margin: 0 7px 3px 9px;
  border-radius: 0 0 9px 9px;
  border: 1px solid rgba(255,255,255,.07);
  border-top: none;
  background: #0d0d0d;
  overflow: hidden;
  box-shadow: 0 4px 24px rgba(0,0,0,.7);
}
.sbx-wrap.active .sbx-output-card {
  border-color: rgba(255,255,255,.11);
  border-top: none;
}

/* Top/bottom fades */
.sbx-fade-top {
  position: absolute; top: 0; left: 0; right: 0; height: 20px;
  background: linear-gradient(to bottom, #0d0d0d 0%, transparent 100%);
  z-index: 4; pointer-events: none;
}
.sbx-fade-bottom {
  position: absolute; bottom: 0; left: 0; right: 0; height: 28px;
  background: linear-gradient(to top, #0c0c0c 0%, transparent 100%);
  z-index: 4; pointer-events: none;
}

/* xterm canvas — this is where real input happens */
.sbx-term-inner {
  position: absolute; inset: 0;
  padding: 12px 8px 12px 14px;
  box-sizing: border-box; cursor: text;
}
.sbx-term-inner .xterm,
.sbx-term-inner .xterm-viewport,
.sbx-term-inner .xterm-screen { background: transparent !important; }
.sbx-term-inner .xterm-viewport::-webkit-scrollbar { width: 3px; }
.sbx-term-inner .xterm-viewport::-webkit-scrollbar-track { background: transparent; }
.sbx-term-inner .xterm-viewport::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,.08); border-radius: 3px;
}
.sbx-term-inner .xterm-viewport::-webkit-scrollbar-thumb:hover {
  background: rgba(255,255,255,.16);
}

/* Inactive dim */
.sbx-inactive-overlay {
  position: absolute; inset: 0;
  background: rgba(0,0,0,.40);
  pointer-events: none; z-index: 8;
  border-radius: 0 0 9px 9px;
}

/* ── Status strip ── */
.sbx-status {
  display: flex; align-items: center;
  height: 20px; flex-shrink: 0;
  padding: 0 16px; gap: 8px;
  user-select: none;
}
.sbx-st {
  font-size: 9.5px; font-family: 'JetBrains Mono', monospace;
  color: rgba(255,255,255,.14); white-space: nowrap;
  display: flex; align-items: center; gap: 4px;
}
.sbx-st-dot {
  width: 4px; height: 4px; border-radius: 50%;
  background: rgba(255,255,255,.15); flex-shrink: 0;
}
.sbx-st-dot.on { background: rgba(255,255,255,.45); }
.sbx-st-sep { width: 1px; height: 8px; background: rgba(255,255,255,.06); }
`;

// ── OSC 7 ─────────────────────────────────────────────────────────────────────
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

// ── RunPane ───────────────────────────────────────────────────────────────────
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
  const termElRef  = useRef<HTMLDivElement>(null);
  const termRef    = useRef<Terminal | null>(null);
  const fitRef     = useRef<FitAddon | null>(null);
  const sidRef     = useRef<string>(sessionId ?? `${runboxId}-${crypto.randomUUID()}`);
  const gone       = useRef(false);

  const [liveCwd,   setLiveCwd]   = useState(runboxCwd);
  const [exitCode,  setExitCode]  = useState<number | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onSessionChange?.(sidRef.current); }, []);

  useEffect(() => {
    ["sbx-css","sbx-css-v2","sbx-css-v3","sbx-css-v4","sbx-css-v5"]
      .forEach(id => document.getElementById(id)?.remove());
    const s = document.createElement("style");
    s.id = "sbx-css-v5"; s.textContent = CSS;
    document.head.appendChild(s);
  }, []);

  useEffect(() => {
    if (isActive) setTimeout(() => termRef.current?.focus(), 40);
  }, [isActive]);

  const sendRaw = useCallback((text: string) => {
    invoke("pty_write", { sessionId: sidRef.current, data: text }).catch(() => {});
  }, []);

  // ── Terminal init ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!termElRef.current) return;
    gone.current = false;

    const term = new Terminal({
      cursorBlink:           true,
      cursorStyle:           "bar",
      cursorWidth:           2,
      fontSize:              13.5,
      fontFamily:            "'JetBrains Mono','Cascadia Code','Fira Code','Consolas',monospace",
      lineHeight:            1.65,
      letterSpacing:         0.2,
      theme:                 THEME,
      convertEol:            true,
      scrollback:            12000,
      allowTransparency:     true,
      macOptionIsMeta:       true,
      rightClickSelectsWord: true,
      disableStdin:          false,   // ← xterm handles ALL raw input: TUI, tab, arrows
    });

    const fit   = new FitAddon();
    const links = new WebLinksAddon();
    term.loadAddon(fit);
    term.loadAddon(links);
    term.open(termElRef.current);
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch { /**/ }

    termRef.current = term;
    fitRef.current  = fit;

    // ALL keystrokes → PTY (tab completion, TUI arrows, everything works)
    term.onData(data => sendRaw(data));

    requestAnimationFrame(() => {
      try { fit.fit(); } catch { /**/ }
      term.focus();
    });

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        invoke("pty_resize", {
          sessionId: sidRef.current, cols: term.cols, rows: term.rows,
        }).catch(() => {});
      } catch { /**/ }
    });
    ro.observe(termElRef.current!);

    let unlistenOutput: UnlistenFn | null = null;
    let unlistenEnded:  UnlistenFn | null = null;
    const sid = sidRef.current;
    let spawnedAt = 0;
    const osc133Re = /\x1b\]133;([A-D])(?:;(\d+))?[\x07\x1b\\]/g;

    Promise.all([
      listen<string>(`pty://output/${sid}`, ({ payload }) => {
        if (gone.current) return;
        term.write(payload);
        const cwd = parseOsc7(payload);
        if (cwd) { setLiveCwd(cwd); onCwdChange?.(cwd); }
        osc133Re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = osc133Re.exec(payload)) !== null) {
          if (m[1] === "D" && m[2] !== undefined) {
            setExitCode(parseInt(m[2], 10));
          }
        }
      }),
      listen<void>(`pty://ended/${sid}`, () => {
        if (gone.current) return;
        if (Date.now() - spawnedAt < 2000) return;
        const w = Math.min((termRef.current?.cols ?? 80) - 2, 60);
        term.write(`\r\n\x1b[38;5;238m${"─".repeat(w)}\x1b[0m\r\n`);
        term.write(`\x1b[38;5;242m  session ended  ·  press any key to restart\x1b[0m\r\n`);
        term.write(`\x1b[38;5;238m${"─".repeat(w)}\x1b[0m\r\n`);
        setExitCode(null); spawnedAt = 0;
        const d = term.onData(() => {
          d.dispose(); spawnedAt = Date.now();
          invoke("pty_spawn", { sessionId: sid, runboxId, cwd: runboxCwd }).catch(() => {});
        });
      }),
    ]).then(([a, b]) => {
      unlistenOutput = a; unlistenEnded = b;
      spawnedAt = Date.now();
      return invoke("pty_spawn", { sessionId: sid, runboxId, cwd: runboxCwd });
    }).catch(err => {
      if (!gone.current) term.write(`\r\n\x1b[38;5;196m[error: ${err}]\x1b[0m\r\n`);
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

  const handlePaneClick = useCallback(() => {
    onActivate?.();
    setTimeout(() => termRef.current?.focus(), 0);
  }, [onActivate]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text");
    if (text) { e.preventDefault(); sendRaw(text); termRef.current?.focus(); }
  }, [sendRaw]);

  const displayCwd = liveCwd || runboxCwd;
  const shortCwd   = displayCwd.split("/").filter(Boolean).pop() ?? "~";

  return (
    <div
      className={`sbx-wrap${isActive ? " active" : ""}`}
      onMouseDown={handlePaneClick}
      onPaste={handlePaste}
    >
      {/* ── Output ── */}
      <div className="sbx-output">
        <div className="sbx-output-header" />
        <div className="sbx-output-card">
          <div className="sbx-fade-top" />
          <div className="sbx-term-inner" ref={termElRef} />
          <div className="sbx-fade-bottom" />
          {!isActive && <div className="sbx-inactive-overlay" />}
        </div>
      </div>

      {/* ── Status strip ── */}
      <div className="sbx-status">
        <span className="sbx-st">
          <div className={`sbx-st-dot${isActive ? " on" : ""}`} />
          {isActive ? "active" : "idle"}
        </span>
        <div className="sbx-st-sep" />
        <span className="sbx-st">{sidRef.current.slice(-6)}</span>
      </div>
    </div>
  );
}