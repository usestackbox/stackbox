import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

const MONO = "Menlo, Monaco, 'Courier New', monospace";

function getLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    rs: "rust", py: "python", json: "json", md: "markdown",
    css: "css", html: "html", toml: "toml", yaml: "yaml", yml: "yaml",
    sh: "shell", zsh: "shell", bash: "shell", txt: "text",
  };
  return map[ext] ?? "text";
}

const DIRS = ["r", "l", "b", "t", "br", "bl", "tr", "tl"] as const;

interface FileViewerPaneProps {
  id:            string;
  path:          string;
  x:             number;
  y:             number;
  w:             number;
  h:             number;
  zIndex:        number;
  isActive:      boolean;
  onActivate:    () => void;
  onClose:       () => void;
  onDragStart:   (e: React.MouseEvent) => void;
  onResizeStart: (e: React.MouseEvent, dir: string) => void;
}

export default function FileViewerPane({
  id, path, x, y, w, h, zIndex,
  isActive, onActivate, onClose, onDragStart, onResizeStart,
}: FileViewerPaneProps) {
  const [content, setContent] = useState<string | null>(null);
  const [error,   setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fileName = path.split("/").pop() ?? path;
  const lang     = getLanguage(path);

  useEffect(() => {
    setLoading(true); setError(null);
    invoke<string>("read_text_file", { path })
      .then(c => { setContent(c); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, [path]);

  const lines = content?.split("\n") ?? [];

  const resizeStyle = (dir: string): React.CSSProperties => {
    if (dir === "r")  return { top: 8, right: -3,  width: 6, height: "calc(100% - 16px)", cursor: "ew-resize" };
    if (dir === "l")  return { top: 8, left: -3,   width: 6, height: "calc(100% - 16px)", cursor: "ew-resize" };
    if (dir === "b")  return { bottom: -3, left: 8, width: "calc(100% - 16px)", height: 6, cursor: "ns-resize" };
    if (dir === "t")  return { top: -3, left: 8, width: "calc(100% - 16px)", height: 6, cursor: "ns-resize" };
    if (dir === "br") return { bottom: -3, right: -3, width: 14, height: 14, cursor: "nwse-resize" };
    if (dir === "bl") return { bottom: -3, left: -3,  width: 14, height: 14, cursor: "nesw-resize" };
    if (dir === "tr") return { top: -3, right: -3,    width: 14, height: 14, cursor: "nesw-resize" };
    return                   { top: -3, left: -3,     width: 14, height: 14, cursor: "nwse-resize" };
  };

  return (
    <div
      onMouseDown={onActivate}
      style={{
        position: "absolute",
        left: x, top: y, width: w, height: h, zIndex,
        display: "flex", flexDirection: "column",
        background: "#0c0c0c",
        borderRadius: 10,
        border: isActive
          ? "1.5px solid rgba(255,255,255,.32)"
          : "1px solid rgba(255,255,255,.06)",
        overflow: "hidden", boxSizing: "border-box",
        transition: "border-color .15s",
      }}
    >
      {/* Resize handles */}
      {DIRS.map(dir => (
        <div key={dir} style={{ position: "absolute", zIndex: 100, ...resizeStyle(dir) }}
          onMouseDown={e => { e.stopPropagation(); onResizeStart(e, dir); }} />
      ))}

      {/* Title bar */}
      <div
        onMouseDown={e => { if ((e.target as HTMLElement).closest(".fv-light")) return; onDragStart(e); }}
        style={{
          height: 36, flexShrink: 0,
          display: "flex", alignItems: "center",
          padding: "0 12px", gap: 10,
          background: isActive ? "rgba(255,255,255,.05)" : "rgba(255,255,255,.025)",
          borderBottom: `1px solid ${isActive ? "rgba(255,255,255,.1)" : "rgba(255,255,255,.06)"}`,
          cursor: "grab", userSelect: "none", borderRadius: "10px 10px 0 0",
        }}
      >
        {/* Traffic lights */}
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
          <div className="fv-light"
            onClick={e => { e.stopPropagation(); onClose(); }}
            style={{ width: 12, height: 12, borderRadius: "50%", background: "#ff5f57", cursor: "pointer",
              filter: isActive ? "none" : "grayscale(1) brightness(.35)" }} />
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#febc2e",
            filter: isActive ? "none" : "grayscale(1) brightness(.35)" }} />
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#27c93f",
            filter: isActive ? "none" : "grayscale(1) brightness(.35)" }} />
        </div>

        <div style={{ width: 1, height: 12, background: "rgba(255,255,255,.08)", flexShrink: 0 }} />

        <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
          stroke="rgba(255,255,255,.4)" strokeWidth="2" style={{ flexShrink: 0 }}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>

        <span style={{
          flex: 1, minWidth: 0, fontSize: 11, fontFamily: MONO,
          color: isActive ? "rgba(255,255,255,.7)" : "rgba(255,255,255,.3)",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {fileName}
        </span>

        <span style={{
          fontSize: 9, fontFamily: MONO, letterSpacing: ".05em", flexShrink: 0,
          color: "rgba(255,255,255,.3)", background: "rgba(255,255,255,.06)",
          border: "1px solid rgba(255,255,255,.08)", borderRadius: 4, padding: "1px 7px",
        }}>
          {lang}
        </span>
      </div>

      {/* Content */}
      <div style={{
        flex: 1, minHeight: 0, overflow: "auto",
        opacity: isActive ? 1 : 0.45, transition: "opacity .2s",
      }}>
        {loading && (
          <div style={{ padding: 20, color: "#555", fontSize: 12, fontFamily: MONO }}>Loading...</div>
        )}
        {error && (
          <div style={{ padding: 20, color: "#e05252", fontSize: 12, fontFamily: MONO }}>
            Cannot read file: {error}
          </div>
        )}
        {content !== null && !loading && (
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12, fontFamily: MONO, lineHeight: 1.6 }}>
            <tbody>
              {lines.map((line, i) => (
                <tr key={i} style={{ verticalAlign: "top" }}>
                  <td style={{
                    padding: "0 12px 0 16px", color: "rgba(255,255,255,.18)",
                    userSelect: "none", textAlign: "right", minWidth: 40,
                    fontSize: 11,
                  }}>
                    {i + 1}
                  </td>
                  <td style={{ padding: "0 16px 0 8px", color: "#e8e8e8", whiteSpace: "pre" }}>
                    {line || " "}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}