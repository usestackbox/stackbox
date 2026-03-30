// src/core/RunPane.tsx
import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

const BG     = "#0b0e10";
const BG_ACT = "#0e1214";

const THEME = {
  background:          "#0b0e10",
  foreground:          "#d4d4d4",
  cursor:              "#b0b0b0",
  cursorAccent:        BG,
  selectionBackground: "rgba(255,255,255,.13)",
  selectionForeground: "#ffffff",
  black:   "#1e2428", brightBlack:   "#4a5058",
  red:     "#c07070", brightRed:     "#d88888",
  green:   "#80a880", brightGreen:   "#98c098",
  yellow:  "#ffd700", brightYellow:  "#ffec3d",
  blue:    "#6888a8", brightBlue:    "#80a0c0",
  magenta: "#9870a0", brightMagenta: "#b088b8",
  cyan:    "#00e5ff", brightCyan:    "#18ffff",
  white:   "#c8c8c8", brightWhite:   "#e8e8e8",
};

const CSS = `
.rp-win {
  width: 100%; height: 100%;
  box-sizing: border-box;
  background: ${BG};
  display: flex; flex-direction: column;
  overflow: hidden;
  position: relative;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,.06);
  transition: border-color .15s, background .15s;
}
.rp-win.rp-active {
  border: 1px solid rgba(255,255,255,.18);
  background: ${BG_ACT};
}

.rp-titlebar {
  height: 32px; flex-shrink: 0;
  display: flex; align-items: center;
  padding: 0 6px 0 10px; gap: 6px;
  background: rgba(255,255,255,.02);
  border-bottom: 1px solid rgba(255,255,255,.05);
  cursor: grab; user-select: none;
  border-radius: 8px 8px 0 0;
  transition: background .15s;
  box-sizing: border-box;
  min-height: 32px; max-height: 32px;
}
.rp-win.rp-active .rp-titlebar {
  background: rgba(255,255,255,.035);
  border-bottom-color: rgba(255,255,255,.08);
}
.rp-titlebar:active { cursor: grabbing; }

.rp-dot {
  width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
  background: rgba(255,255,255,.12);
  transition: background .15s;
}
.rp-win.rp-active .rp-dot {
  background: #00e5ff;
  box-shadow: 0 0 6px rgba(0,229,255,.5);
}

.rp-vsep { width: 1px; height: 10px; background: rgba(255,255,255,.07); flex-shrink: 0; }

.rp-cwd {
  flex: 1; min-width: 0;
  font-size: 11px;
  font-family: ui-monospace, 'SF Mono', Menlo, Monaco, 'Cascadia Mono', 'Consolas', monospace;
  color: rgba(255,255,255,.2);
  letter-spacing: .01em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  transition: color .15s;
}
.rp-win.rp-active .rp-cwd { color: rgba(255,255,255,.55); }

.rp-chip {
  font-size: 9px;
  font-family: ui-monospace, 'SF Mono', Menlo, Monaco, monospace;
  letter-spacing: .05em; flex-shrink: 0;
  color: rgba(255,255,255,.18);
  background: rgba(255,255,255,.04);
  border: 1px solid rgba(255,255,255,.07);
  border-radius: 3px; padding: 1px 6px;
  transition: all .15s;
}
.rp-win.rp-active .rp-chip {
  color: rgba(255,255,255,.4);
  background: rgba(255,255,255,.07);
  border-color: rgba(255,255,255,.12);
}

.rp-tbtn {
  width: 22px; height: 22px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border-radius: 5px; cursor: pointer;
  color: rgba(255,255,255,.18);
  border: none; background: transparent;
  transition: background .12s, color .12s;
  padding: 0;
}
.rp-win.rp-active .rp-tbtn { color: rgba(255,255,255,.3); }
.rp-win.rp-active .rp-tbtn:hover {
  background: rgba(255,255,255,.09);
  color: rgba(255,255,255,.75);
}
.rp-tbtn.rp-close-btn:hover {
  background: rgba(239,68,68,.2) !important;
  color: #f87171 !important;
}

.rp-body {
  flex: 1; min-height: 0; min-width: 0;
  position: relative; overflow: hidden;
  border-radius: 0 0 7px 7px;
  background: ${BG};
  display: block;
}
.rp-win.rp-active .rp-body { background: ${BG_ACT}; }
.rp-win:not(.rp-active) .rp-body { opacity: 0.45; }

.rp-xterm {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  overflow: hidden;
}
.rp-xterm .xterm,
.rp-xterm .xterm-viewport,
.rp-xterm .xterm-screen { background: transparent !important; }

.xterm .scrollbar.vertical { width: 5px !important; }
.xterm .scrollbar.vertical .slider {
  width: 5px !important; border-radius: 3px !important;
  background: rgba(255,255,255,.18) !important;
}
.xterm .scrollbar.horizontal { height: 0 !important; display: none !important; }

.rp-fade-t {
  position: absolute; top: 0; left: 0; right: 0; height: 12px;
  background: linear-gradient(to bottom, ${BG}, transparent);
  pointer-events: none; z-index: 4;
}
.rp-fade-b {
  position: absolute; bottom: 0; left: 0; right: 0; height: 18px;
  background: linear-gradient(to top, ${BG}, transparent);
  pointer-events: none; z-index: 4;
}
.rp-win.rp-active .rp-fade-t { background: linear-gradient(to bottom, ${BG_ACT}, transparent); }
.rp-win.rp-active .rp-fade-b { background: linear-gradient(to top,    ${BG_ACT}, transparent); }

.rp-resize { position: absolute; z-index: 100; }
.rp-resize-r  { top: 8px;  right: 0;   width: 5px; height: calc(100% - 16px); cursor: ew-resize; }
.rp-resize-l  { top: 8px;  left: 0;    width: 5px; height: calc(100% - 16px); cursor: ew-resize; }
.rp-resize-b  { bottom: 0; left: 8px;  width: calc(100% - 16px); height: 5px; cursor: ns-resize; }
.rp-resize-t  { top: 0;    left: 8px;  width: calc(100% - 16px); height: 5px; cursor: ns-resize; }
.rp-resize-br { bottom: 0; right: 0;   width: 12px; height: 12px; cursor: nwse-resize; }
.rp-resize-bl { bottom: 0; left: 0;    width: 12px; height: 12px; cursor: nesw-resize; }
.rp-resize-tr { top: 0;    right: 0;   width: 12px; height: 12px; cursor: nesw-resize; }
.rp-resize-tl { top: 0;    left: 0;    width: 12px; height: 12px; cursor: nwse-resize; }
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

function TBtn({ title, onClick, danger, children }: {
  title: string; onClick: (e: React.MouseEvent) => void;
  danger?: boolean; children: React.ReactNode;
}) {
  return (
    <button className={`rp-tbtn${danger ? " rp-close-btn" : ""}`} title={title}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); onClick(e); }}>
      {children}
    </button>
  );
}

function IcoSplitDown() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="1.5" width="13" height="13" rx="2"/><line x1="1.5" y1="8.5" x2="14.5" y2="8.5"/>
    </svg>
  );
}

function IcoSplitLeft() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="1.5" width="13" height="13" rx="2"/><line x1="8.5" y1="1.5" x2="8.5" y2="14.5"/>
    </svg>
  );
}

function IcoMinimize() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="1" width="14" height="14" rx="3.5" strokeWidth="1.8"/>
      <line x1="4.5" y1="11.5" x2="11.5" y2="11.5" strokeWidth="2.2"/>
    </svg>
  );
}

function IcoClose() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/>
    </svg>
  );
}

export default function RunPane({
  runboxCwd = "~/", runboxId = "default", runboxName = "runbox",
  sessionId, label = "",
  onCwdChange, onSessionChange, isActive, onActivate,
  onClose, onMinimize, onMaximize, onSplitDown, onSplitLeft,
  onDragStart, onResizeStart,
}: {
  runboxCwd?: string; runboxId?: string; runboxName?: string;
  sessionId?: string; label?: string;
  onCwdChange?: (cwd: string) => void; onSessionChange?: (sid: string) => void;
  isActive?: boolean; onActivate?: () => void;
  onClose?: () => void; onMinimize?: () => void; onMaximize?: () => void;
  onSplitDown?: () => void; onSplitLeft?: () => void;
  onDragStart?: (e: React.MouseEvent) => void;
  onResizeStart?: (e: React.MouseEvent, dir: string) => void;
}) {
  const termElRef = useRef<HTMLDivElement>(null);
  const termRef   = useRef<Terminal | null>(null);
  const fitRef    = useRef<FitAddon | null>(null);
  const sidRef    = useRef<string>(sessionId ?? `${runboxId}-${crypto.randomUUID()}`);
  const gone      = useRef(false);
  const spawned   = useRef(false);
  const [liveCwd, setLiveCwd] = useState(runboxCwd);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onSessionChange?.(sidRef.current); }, []);

  useEffect(() => {
    ["sbx-css","sbx-css-v2","sbx-css-v3","sbx-css-v4","sbx-css-v5",
     "rp-css-v1","rp-css-v2","rp-css-v3","rp-css-v4","rp-css-v5",
     "rp-css-v6","rp-css-v7","rp-css-v8","rp-css-v9","rp-css-v10",
     "rp-css-v11","rp-css-v12"]
      .forEach(id => document.getElementById(id)?.remove());
    const s = document.createElement("style");
    s.id = "rp-css-v12"; s.textContent = CSS;
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
    gone.current = false; spawned.current = false;

    const term = new Terminal({
      cursorBlink: true, cursorStyle: "bar", cursorWidth: 1.5,
      fontSize: 13,
      lineHeight: 1.4,  // slightly tighter than 1.5 — fits more rows, less chance of last row being cut
      letterSpacing: 0, fontWeight: "normal", fontWeightBold: "bold",
      fontFamily: "ui-monospace, 'SF Mono', Menlo, Monaco, 'Cascadia Mono', 'Consolas', 'Courier New', monospace",
      theme: THEME, convertEol: true, scrollback: 12000,
      allowTransparency: true, macOptionIsMeta: true,
      rightClickSelectsWord: true, disableStdin: false,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(termElRef.current);
    try {
      const w = new WebglAddon();
      w.onContextLoss(() => w.dispose());
      term.loadAddon(w);
    } catch { /**/ }

    termRef.current = term;
    fitRef.current  = fit;
    term.onData(data => sendRaw(data));

    const container = termElRef.current;

    const styleScrollbar = () => {
      const vS  = container?.querySelector('.scrollbar.vertical') as HTMLElement;
      const vSl = container?.querySelector('.scrollbar.vertical .slider') as HTMLElement;
      const hS  = container?.querySelector('.scrollbar.horizontal') as HTMLElement;
      if (vS)  vS.style.width = '5px';
      if (vSl) { vSl.style.width = '5px'; vSl.style.borderRadius = '3px'; vSl.style.background = 'rgba(255,255,255,.18)'; }
      if (hS)  hS.style.display = 'none';
    };

    const sbObs = new MutationObserver(styleScrollbar);
    sbObs.observe(container!, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });

    const applyScreenMargin = () => {
      const screen = container?.querySelector('.xterm-screen') as HTMLElement;
      if (screen) { screen.style.marginTop = '8px'; screen.style.marginLeft = '10px'; }
    };

    const sid = sidRef.current;
    let unO: UnlistenFn | null = null;
    let unE: UnlistenFn | null = null;

    Promise.all([
      listen<string>(`pty://output/${sid}`, ({ payload }) => {
        if (gone.current) return;
        term.write(payload);
        const cwd = parseOsc7(payload);
        if (cwd) { setLiveCwd(cwd); onCwdChange?.(cwd); }
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
            invoke("pty_spawn", { sessionId: sid, runboxId, cwd: runboxCwd, cols: term.cols, rows: term.rows }).catch(() => {});
          }
        });
      }),
    ]).then(([a, b]) => { unO = a; unE = b; });

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]; if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;
      try { fit.fit(); } catch { return; }
      if (term.cols <= 0 || term.rows <= 0) return;
      invoke("pty_resize", { sessionId: sid, cols: term.cols, rows: term.rows }).catch(() => {});
      if (!spawned.current && !gone.current) {
        spawned.current = true;
        styleScrollbar(); applyScreenMargin(); term.focus();
        invoke("pty_spawn", { sessionId: sid, runboxId, cwd: runboxCwd, cols: term.cols, rows: term.rows })
          .catch(err => { if (!gone.current) term.write(`\r\n\x1b[38;5;196m[error: ${err}]\x1b[0m\r\n`); });
      }
    });
    ro.observe(termElRef.current!);

    return () => {
      gone.current = true;
      ro.disconnect(); sbObs.disconnect();
      unO?.(); unE?.();
      invoke("pty_kill", { sessionId: sid }).catch(() => {});
      term.dispose();
      termRef.current = null; fitRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const t = e.clipboardData.getData("text");
    if (t) { e.preventDefault(); sendRaw(t); termRef.current?.focus(); }
  }, [sendRaw]);

  const DIRS = ["r","l","b","t","br","bl","tr","tl"] as const;

  return (
    <div className={`rp-win${isActive ? " rp-active" : ""}`}
      onMouseDown={() => onActivate?.()} onPaste={handlePaste}>
      {DIRS.map(dir => (
        <div key={dir} className={`rp-resize rp-resize-${dir}`}
          onMouseDown={e => { e.stopPropagation(); onResizeStart?.(e, dir); }} />
      ))}
      <div className="rp-titlebar"
        onMouseDown={e => { if ((e.target as HTMLElement).closest('.rp-tbtn')) return; onDragStart?.(e); }}>
        <div className="rp-dot" />
        <div className="rp-vsep" />
        <span className="rp-cwd">{liveCwd || runboxCwd}</span>
        {label && <span className="rp-chip">{label}</span>}
        <div style={{ display: "flex", alignItems: "center", gap: 1, marginLeft: 2 }}>
          {onSplitDown && <TBtn title="Split down" onClick={onSplitDown}><IcoSplitDown /></TBtn>}
          {onSplitLeft && <TBtn title="Split left" onClick={onSplitLeft}><IcoSplitLeft /></TBtn>}
          {onMinimize  && <TBtn title="Minimize"   onClick={onMinimize} ><IcoMinimize  /></TBtn>}
          {onClose     && <TBtn title="Close" onClick={onClose} danger  ><IcoClose     /></TBtn>}
        </div>
      </div>
      <div className="rp-body">
        <div className="rp-fade-t" />
        <div className="rp-xterm" ref={termElRef} />
        <div className="rp-fade-b" />
      </div>
    </div>
  );
}