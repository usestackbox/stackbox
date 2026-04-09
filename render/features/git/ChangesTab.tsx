import { useCallback, useState } from "react";
import { C, MONO, SANS } from "../../design";
import { parseDiff, getDiffLanguage } from "../diff/diffUtils";
import { UnifiedDiff } from "../diff/UnifiedDiff";
import type { AgentSpan, LiveDiffFile } from "./types";
import { agentForFile } from "./useGitPanel";

interface Props {
  files: LiveDiffFile[];
  agentSpans: AgentSpan[];
  onFileClick: (fc: LiveDiffFile) => void;
  onStage?: (path: string) => Promise<void>;
  onUnstage?: (path: string) => Promise<void>;
  onDiscard?: (path: string) => Promise<void>;
}

const INS    = "rgba(63,255,162,.80)";
const DEL    = "rgba(255,107,107,.80)";

const CHANGE_META: Record<string, { label: string; color: string; bg: string }> = {
  created:  { label: "A", color: "rgba(63,255,162,.90)",  bg: "rgba(63,255,162,.12)"  },
  modified: { label: "M", color: "rgba(190,190,210,.55)",  bg: "rgba(255,255,255,.06)" },
  deleted:  { label: "D", color: "rgba(255,107,107,.90)", bg: "rgba(255,107,107,.12)" },
};

const AGENT_DOT: Record<string, string> = {
  claude: "#fbbf24", codex: "#4ade80", gemini: "#60a5fa",
  cursor: "rgba(255,255,255,.5)", copilot: "#60a5fa", opencode: "#a78bfa",
};

// ── Stat pills ────────────────────────────────────────────────────────────────
function StatPill({ ins, del }: { ins: number; del: number }) {
  const total = ins + del;
  if (!total) return null;
  const g = Math.round((ins / total) * 5);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
      {ins > 0 && <span style={{ fontSize: 11, fontFamily: MONO, color: INS, fontWeight: 500 }}>+{ins}</span>}
      {del > 0 && <span style={{ fontSize: 11, fontFamily: MONO, color: DEL, fontWeight: 500 }}>-{del}</span>}
      <div style={{ display: "flex", gap: 1.5, flexShrink: 0 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} style={{
            width: 6, height: 6, borderRadius: 1.5,
            background: i < g ? "rgba(63,255,162,.45)" : "rgba(255,107,107,.35)",
          }} />
        ))}
      </div>
    </div>
  );
}

// ── File row ──────────────────────────────────────────────────────────────────
function FileRow({
  fc, agentSpans, open, onToggle, onDiscard,
}: {
  fc: LiveDiffFile;
  agentSpans: AgentSpan[];
  open: boolean;
  onToggle: () => void;
  onDiscard?: (path: string) => Promise<void>;
}) {
  const name     = fc.path.split(/[/\\]/).pop() ?? fc.path;
  const dir      = fc.path.slice(0, fc.path.length - name.length);
  const meta     = CHANGE_META[fc.change_type] ?? CHANGE_META.modified;
  const agent    = agentForFile(agentSpans, fc.modified_at ?? 0);
  const agentDot = agent ? (AGENT_DOT[agent] ?? C.t3) : null;
  const lines    = fc.diff?.trim() ? parseDiff(fc.diff) : null;
  const lang     = getDiffLanguage(fc.path);

  return (
    <div style={{
      margin: "5px 8px",
      borderRadius: 10,
      overflow: "hidden",
      border: `1px solid ${C.border}`,
      background: open ? "rgba(255,255,255,.025)" : C.bg1,
      transition: "background .1s",
    }}>
      {/* Header row */}
      <div
        onClick={onToggle}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "7px 10px 7px 12px",
          cursor: "pointer", userSelect: "none",
          background: open ? "rgba(255,255,255,.038)" : "transparent",
          borderLeft: open ? "2px solid rgba(157,143,255,.65)" : "2px solid transparent",
          transition: "background .08s",
        }}
        onMouseEnter={e => {
          if (!open) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,.022)";
        }}
        onMouseLeave={e => {
          if (!open) (e.currentTarget as HTMLElement).style.background = "transparent";
        }}
      >
        {/* Chevron */}
        <svg
          width="9" height="9" viewBox="0 0 24 24" fill="none"
          stroke={open ? "rgba(255,255,255,.55)" : C.t3}
          strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .12s", flexShrink: 0 }}
        >
          <polyline points="9 6 15 12 9 18" />
        </svg>

        {/* Badge */}
        <span style={{
          fontSize: 9, fontFamily: MONO, fontWeight: 700,
          color: meta.color, background: meta.bg,
          borderRadius: 3, padding: "1px 4px", flexShrink: 0, letterSpacing: "0.05em",
        }}>
          {meta.label}
        </span>

        {/* Path */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{
            fontSize: 12, fontFamily: MONO, display: "block",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {dir && <span style={{ color: C.t3 }}>{dir}</span>}
            <span style={{ color: open ? C.t0 : C.t1 }}>{name}</span>
          </span>
        </div>

        {/* Agent dot */}
        {agentDot && (
          <div style={{ width: 5, height: 5, borderRadius: "50%", background: agentDot, flexShrink: 0 }} title={agent ?? ""} />
        )}

        {/* Stats */}
        <StatPill ins={fc.insertions ?? 0} del={fc.deletions ?? 0} />

        {/* Copy */}
        <button
          onClick={e => { e.stopPropagation(); navigator.clipboard?.writeText(fc.path).catch(() => {}); }}
          title="Copy path"
          style={{
            width: 22, height: 22, borderRadius: 4, background: "none", border: "none",
            color: C.t3, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, transition: "color .1s, opacity .1s", opacity: open ? 0.5 : 0,
          }}
          onMouseEnter={e => {
            const el = e.currentTarget as HTMLElement;
            el.style.opacity = "1"; el.style.color = C.t1;
          }}
          onMouseLeave={e => {
            const el = e.currentTarget as HTMLElement;
            el.style.opacity = open ? "0.5" : "0"; el.style.color = C.t3;
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="9" y="9" width="13" height="13" rx="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        </button>

        {/* Discard */}
        {onDiscard && (
          <button
            onClick={e => { e.stopPropagation(); onDiscard(fc.path); }}
            title="Discard"
            style={{
              width: 22, height: 22, borderRadius: 4, background: "none", border: "none",
              color: C.t3, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0, transition: "color .1s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "rgba(248,113,113,.85)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = C.t3; }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14H6L5 6M9 6V4h6v2M10 11v6M14 11v6"/>
            </svg>
          </button>
        )}
      </div>

      {/* Inline diff */}
      {open && (
        <div style={{ borderTop: `1px solid ${C.border}`, background: C.bg0 }}>
          {lines && lines.length > 0 ? (
            <div style={{ maxHeight: 360, overflow: "auto" }}>
              <UnifiedDiff lines={lines} lang={lang} />
            </div>
          ) : (
            <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 8 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth="1.5" strokeLinecap="round">
                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
                <polyline points="13 2 13 9 20 9"/>
              </svg>
              <span style={{ fontSize: 11, color: C.t3, fontFamily: SANS }}>
                {fc.change_type === "deleted" ? "File deleted." : "No diff available."}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function ChangesTab({ files, agentSpans, onFileClick, onDiscard }: Props) {
  // Multiple files can be open at once (matching screenshot)
  const [openPaths, setOpenPaths] = useState<Set<string>>(new Set());

  const toggle = useCallback((fc: LiveDiffFile) => {
    setOpenPaths(prev => {
      const next = new Set(prev);
      if (next.has(fc.path)) {
        next.delete(fc.path);
      } else {
        next.add(fc.path);
        // inline-only: do NOT call onFileClick (prevents double panel open)
      }
      return next;
    });
  }, []);

  const totalIns = files.reduce((s, f) => s + (f.insertions ?? 0), 0);
  const totalDel = files.reduce((s, f) => s + (f.deletions ?? 0), 0);

  if (files.length === 0) {
    return (
      <div style={{
        flex: 1, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 10,
      }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
          stroke={C.t3} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <span style={{ fontSize: 12, color: C.t3, fontFamily: SANS }}>Working tree clean</span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* Summary */}
      <div style={{
        padding: "5px 12px", flexShrink: 0,
        borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{
          fontSize: 10, fontFamily: MONO, color: C.t3, flex: 1,
          letterSpacing: "0.07em", textTransform: "uppercase",
        }}>
          {files.length} {files.length === 1 ? "file" : "files"} changed
        </span>
        {totalIns > 0 && <span style={{ fontSize: 11, fontFamily: MONO, color: INS }}>+{totalIns}</span>}
        {totalDel > 0 && <span style={{ fontSize: 11, fontFamily: MONO, color: DEL }}>-{totalDel}</span>}
      </div>

      {/* File list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0 6px" }}>
        {files.map(fc => (
          <FileRow
            key={fc.path}
            fc={fc}
            agentSpans={agentSpans}
            open={openPaths.has(fc.path)}
            onToggle={() => toggle(fc)}
            onDiscard={onDiscard}
          />
        ))}
      </div>
    </div>
  );
}