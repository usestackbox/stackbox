// src/core/RunPane.tsx
import { useEffect, useRef, useCallback, useState } from "react";
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
  cursor:              "#c8c8c8",
  cursorAccent:        "#0c0c0c",
  selectionBackground: "rgba(255,255,255,.13)",
  selectionForeground: "#ffffff",
  black:   "#181818", brightBlack:   "#484848",
  red:     "#c07070", brightRed:     "#d88888",
  green:   "#80a880", brightGreen:   "#98c098",
  yellow: "#ffd700",  brightYellow: "#ffec3d",
  blue:    "#6888a8", brightBlue:    "#80a0c0",
  magenta: "#9870a0", brightMagenta: "#b088b8",
  cyan:    "#00e5ff", brightCyan:    "#18ffff",
  white:      "#c8c8c8",  brightWhite: "#e8e8e8",
};

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,400;0,500;0,600;1,400&display=swap');

.rp-win {
  width: 100%; height: 100%;
  background: #0c0c0c;
  display: flex; flex-direction: column;
  overflow: hidden;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,.06);
  transition: border-color .15s, background .15s;
  box-sizing: border-box;
}
.rp-win.rp-active {
  border: 1.5px solid rgba(255,255,255,.32);
  background: #0e0e0e;
}

/* ── Title bar ── */
.rp-titlebar {
  height: 36px; flex-shrink: 0;
  display: flex; align-items: center;
  padding: 0 12px; gap: 10px;
  background: rgba(255,255,255,.025);
  border-bottom: 1px solid rgba(255,255,255,.06);
  cursor: grab; user-select: none;
  border-radius: 10px 10px 0 0;
  transition: background .15s;
}
.rp-win.rp-active .rp-titlebar {
  background: rgba(255,255,255,.05);
  border-bottom-color: rgba(255,255,255,.1);
}
.rp-titlebar:active { cursor: grabbing; }

.rp-lights { display: flex; gap: 6px; align-items: center; flex-shrink: 0; }
.rp-light {
  width: 12px; height: 12px; border-radius: 50%;
  cursor: pointer; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  transition: filter .12s;
}
.rp-win:not(.rp-active) .rp-light { filter: grayscale(1) brightness(.35); }
.rp-win.rp-active .rp-light:hover { filter: brightness(1.25); }
.rp-light::after { font-size: 8px; font-weight: 700; color: rgba(0,0,0,.55); opacity: 0; transition: opacity .12s; line-height: 1; }
.rp-light-r::after { content: '×'; }
.rp-light-y::after { content: '−'; font-size: 9px; }
.rp-light-g::after { content: '+'; }
.rp-win.rp-active .rp-lights:hover .rp-light::after { opacity: 1; }
.rp-light-r { background: #ff5f57; }
.rp-light-y { background: #febc2e; }
.rp-light-g { background: #27c93f; }

.rp-vsep { width: 1px; height: 12px; background: rgba(255,255,255,.08); flex-shrink: 0; }
.rp-cwd {
  flex: 1; min-width: 0;
  font-size: 11px; font-family: 'JetBrains Mono', monospace;
  color: rgba(255,255,255,.22); letter-spacing: .015em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  transition: color .15s;
}
.rp-win.rp-active .rp-cwd { color: rgba(255,255,255,.6); }
.rp-chip {
  font-size: 9px; font-family: 'JetBrains Mono', monospace;
  letter-spacing: .05em; flex-shrink: 0;
  color: rgba(255,255,255,.18);
  background: rgba(255,255,255,.05);
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 4px; padding: 1px 7px;
  transition: all .15s;
}
.rp-win.rp-active .rp-chip {
  color: rgba(255,255,255,.45);
  background: rgba(255,255,255,.08);
  border-color: rgba(255,255,255,.15);
}

/* ── Body ── */
.rp-body {
  flex: 1;
  min-height: 0;
  min-width: 0;
  position: relative;
  overflow: hidden;
  border-radius: 0 0 9px 9px;
  background: #0c0c0c;
}
.rp-win.rp-active .rp-body { background: #0e0e0e; }
.rp-win:not(.rp-active) .rp-body { opacity: 0.42; }

/* xterm host — full fill, zero padding so row count is correct */
.rp-xterm {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  overflow: hidden;
}
.rp-xterm .xterm,
.rp-xterm .xterm-viewport,
.rp-xterm .xterm-screen { background: transparent !important; }

/* xterm v5 custom scrollbar */
.xterm .scrollbar.vertical { width: 6px !important; }
.xterm .scrollbar.vertical .slider { width: 6px !important; border-radius: 3px !important; background: rgba(255,255,255,.25) !important; }
.xterm .scrollbar.horizontal { height: 0 !important; display: none !important; }

/* Edge fades */
.rp-fade-t { position: absolute; top: 0; left: 0; right: 0; height: 14px; background: linear-gradient(to bottom, #0c0c0c, transparent); pointer-events: none; z-index: 4; }
.rp-fade-b { position: absolute; bottom: 0; left: 0; right: 0; height: 20px; background: linear-gradient(to top, #0c0c0c, transparent); pointer-events: none; z-index: 4; }
.rp-win.rp-active .rp-fade-t { background: linear-gradient(to bottom, #0e0e0e, transparent); }
.rp-win.rp-active .rp-fade-b { background: linear-gradient(to top, #0e0e0e, transparent); }

/* ── Resize handles ── */
.rp-resize { position: absolute; z-index: 100; }
.rp-resize-r  { top: 8px; right: -3px;  width: 6px; height: calc(100% - 16px); cursor: ew-resize; }
.rp-resize-l  { top: 8px; left: -3px;   width: 6px; height: calc(100% - 16px); cursor: ew-resize; }
.rp-resize-b  { bottom: -3px; left: 8px; width: calc(100% - 16px); height: 6px; cursor: ns-resize; }
.rp-resize-t  { top: -3px; left: 8px; width: calc(100% - 16px); height: 6px; cursor: ns-resize; }
.rp-resize-br { bottom: -3px; right: -3px; width: 14px; height: 14px; cursor: nwse-resize; }
.rp-resize-bl { bottom: -3px; left: -3px;  width: 14px; height: 14px; cursor: nesw-resize; }
.rp-resize-tr { top: -3px; right: -3px;    width: 14px; height: 14px; cursor: nesw-resize; }
.rp-resize-tl { top: -3px; left: -3px;     width: 14px; height: 14px; cursor: nwse-resize; }
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
  runboxName   = "runbox",
  sessionId,
  label        = "",
  onCwdChange,
  onSessionChange,
  isActive,
  onActivate,
  onClose,
  onMinimize,
  onMaximize,
  onDragStart,
  onResizeStart,
}: {
  runboxCwd?:       string;
  runboxId?:        string;
  runboxName?:      string;
  sessionId?:       string;
  label?:           string;
  onCwdChange?:     (cwd: string) => void;
  onSessionChange?: (sid: string) => void;
  isActive?:        boolean;
  onActivate?:      () => void;
  onClose?:         () => void;
  onMinimize?:      () => void;
  onMaximize?:      () => void;
  onDragStart?:     (e: React.MouseEvent) => void;
  onResizeStart?:   (e: React.MouseEvent, dir: string) => void;
}) {
  const termElRef = useRef<HTMLDivElement>(null);
  const termRef   = useRef<Terminal | null>(null);
  const fitRef    = useRef<FitAddon | null>(null);
  const sidRef    = useRef<string>(sessionId ?? `${runboxId}-${crypto.randomUUID()}`);
  const gone           = useRef(false);
  const spawned        = useRef(false);
  const [liveCwd, setLiveCwd] = useState(runboxCwd);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onSessionChange?.(sidRef.current); }, []);

  useEffect(() => {
    ["sbx-css","sbx-css-v2","sbx-css-v3","sbx-css-v4","sbx-css-v5",
     "rp-css-v1","rp-css-v2","rp-css-v3","rp-css-v4","rp-css-v5","rp-css-v6","rp-css-v7"]
      .forEach(id => document.getElementById(id)?.remove());
    const s = document.createElement("style");
    s.id = "rp-css-v7"; s.textContent = CSS;
    document.head.appendChild(s);
  }, []);

  useEffect(() => {
    if (isActive) setTimeout(() => termRef.current?.focus(), 40);
  }, [isActive]);

  const sendRaw = useCallback((text: string) => {
    invoke("pty_write", { sessionId: sidRef.current, data: text }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!termElRef.current) return;
    gone.current    = false;
    spawned.current = false;

    const term = new Terminal({
      cursorBlink: true, cursorStyle: "bar", cursorWidth: 1.3,
      fontSize: 13, lineHeight: 1.5, letterSpacing: 0.2,
      fontWeight: "normal",
      fontWeightBold: "800",
      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
      theme: THEME,
      convertEol: true, scrollback: 12000, allowTransparency: true,
      macOptionIsMeta: true, rightClickSelectsWord: true, disableStdin: false,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(termElRef.current);
    try { const w = new WebglAddon(); w.onContextLoss(() => w.dispose()); term.loadAddon(w); } catch { /**/ }

    termRef.current = term;
    fitRef.current  = fit;
    term.onData(data => sendRaw(data));

    const container = termElRef.current;

    // Scrollbar styling
    const styleScrollbar = () => {
      const vS  = container?.querySelector('.scrollbar.vertical') as HTMLElement;
      const vSl = container?.querySelector('.scrollbar.vertical .slider') as HTMLElement;
      const hS  = container?.querySelector('.scrollbar.horizontal') as HTMLElement;
     if (vS)  vS.style.width = '6px';
if (vSl) { vSl.style.width = '6px'; vSl.style.borderRadius = '3px'; vSl.style.background = 'rgba(255,255,255,.25)'; }
      if (hS)  hS.style.display = 'none';
    };
    const sbObs = new MutationObserver(styleScrollbar);
    sbObs.observe(container!, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });

    // Apply top margin to xterm-screen so text has gap from top border
    // This does NOT affect row calculation — only visual offset
    const applyScreenMargin = () => {
      const screen = container?.querySelector('.xterm-screen') as HTMLElement;
      if (screen) {
        screen.style.marginTop  = '8px';
        screen.style.marginLeft = '10px';
      }
    };

    const sid = sidRef.current;
    let unO: UnlistenFn | null = null;
    let unE: UnlistenFn | null = null;
    const osc133 = /\x1b\]133;([A-D])(?:;(\d+))?[\x07\x1b\\]/g;

    Promise.all([
      listen<string>(`pty://output/${sid}`, ({ payload }) => {
        if (gone.current) return;
        term.write(payload);
        const cwd = parseOsc7(payload);
        if (cwd) { setLiveCwd(cwd); onCwdChange?.(cwd); }
        osc133.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = osc133.exec(payload)) !== null) { /* exit tracking */ }
      }),
      listen<void>(`pty://ended/${sid}`, () => {
        if (gone.current) return;
        const w = Math.min((termRef.current?.cols ?? 80) - 2, 60);
        term.write(`\r\n\x1b[38;5;238m${"─".repeat(w)}\x1b[0m\r\n`);
        term.write(`\x1b[38;5;242m  session ended  ·  press any key to restart\x1b[0m\r\n`);
        term.write(`\x1b[38;5;238m${"─".repeat(w)}\x1b[0m\r\n`);
        spawned.current = false;
        const d = term.onData(() => {
          d.dispose();
          if (!gone.current && term.cols > 0) {
            spawned.current = true;
            invoke("pty_spawn", {
              sessionId: sid, runboxId, cwd: runboxCwd,
              cols: term.cols, rows: term.rows,
            }).catch(() => {});
          }
        });
      }),
    ]).then(([a, b]) => { unO = a; unE = b; });

    // Spawn only when container has real dimensions
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;

      try { fit.fit(); } catch { return; }
      if (term.cols <= 0 || term.rows <= 0) return;

      invoke("pty_resize", { sessionId: sid, cols: term.cols, rows: term.rows }).catch(() => {});

      if (!spawned.current && !gone.current) {
        spawned.current = true;
        styleScrollbar();
        applyScreenMargin();
        term.focus();
        invoke("pty_spawn", {
          sessionId: sid, runboxId, cwd: runboxCwd,
          cols: term.cols, rows: term.rows,
        }).catch(err => {
          if (!gone.current) term.write(`\r\n\x1b[38;5;196m[error: ${err}]\x1b[0m\r\n`);
        });
      }
    });
    ro.observe(termElRef.current!);

    return () => {
      gone.current = true;
      ro.disconnect();
      sbObs.disconnect();
      unO?.(); unE?.();
      invoke("pty_kill", { sessionId: sid }).catch(() => {});
      term.dispose();
      termRef.current = null;
      fitRef.current  = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const t = e.clipboardData.getData("text");
    if (t) { e.preventDefault(); sendRaw(t); termRef.current?.focus(); }
  }, [sendRaw]);

  const DIRS = ["r","l","b","t","br","bl","tr","tl"] as const;

  return (
    <div
      className={`rp-win${isActive ? " rp-active" : ""}`}
      onMouseDown={() => onActivate?.()}
      onPaste={handlePaste}
    >
      {DIRS.map(dir => (
        <div key={dir} className={`rp-resize rp-resize-${dir}`}
          onMouseDown={e => { e.stopPropagation(); onResizeStart?.(e, dir); }} />
      ))}

      <div
        className="rp-titlebar"
        onMouseDown={e => {
          if ((e.target as HTMLElement).closest('.rp-light')) return;
          onDragStart?.(e);
        }}
      >
        <div className="rp-lights">
          <div className="rp-light rp-light-r" title="Close"
            onMouseDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onClose?.(); }} />
          <div className="rp-light rp-light-y" title="Minimize"
            onMouseDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onMinimize?.(); }} />
          <div className="rp-light rp-light-g" title="Maximize / Restore"
            onMouseDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onMaximize?.(); }} />
        </div>
        <div className="rp-vsep" />
        <span className="rp-cwd">{liveCwd || runboxCwd}</span>
        {label && <span className="rp-chip">{label}</span>}
      </div>

      <div className="rp-body">
        <div className="rp-fade-t" />
        <div className="rp-xterm" ref={termElRef} />
        <div className="rp-fade-b" />
      </div>
    </div>
  );
}