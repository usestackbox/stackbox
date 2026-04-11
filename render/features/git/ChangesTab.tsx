// render/features/git/ChangesTab.tsx

import { useState, useCallback } from "react";
import { C, MONO, SANS } from "../../design";
import type { AgentSpan, LiveDiffFile, WorktreeEntry } from "./types";

interface Props {
  files: LiveDiffFile[];
  agentSpans?: AgentSpan[];
  commitCount?: number;
  onFileClick?: (fc: LiveDiffFile) => void;
  worktrees?: WorktreeEntry[];
  selectedWorktreePath?: string | null;
  onWorktreeChange?: (path: string | null) => void;
  committing?: boolean;
  pushing?: boolean;
  message?: string;
  onMessage?: (m: string) => void;
  onCommit?: () => void;
  onCommitPush?: () => void;
  onPush?: () => void;
  onStage?: (path: string) => Promise<void>;
  onUnstage?: (path: string) => Promise<void>;
  onDiscard?: (path: string) => Promise<void>;
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform .15s", flexShrink: 0 }}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function DiscardIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 .49-3.38" />
    </svg>
  );
}

function OpenIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// ── Change type badge ─────────────────────────────────────────────────────────

const TYPE_MAP: Record<string, { label: string; color: string; bg: string }> = {
  modified: { label: "M", color: C.amber, bg: C.amberBg },
  added:    { label: "A", color: C.green, bg: C.greenBg },
  created:  { label: "A", color: C.green, bg: C.greenBg },
  deleted:  { label: "D", color: C.red,   bg: C.redBg   },
  renamed:  { label: "R", color: C.violet, bg: C.violetBg },
};

function TypeBadge({ type }: { type: string }) {
  const s = TYPE_MAP[type] ?? { label: "M", color: C.t3, bg: C.bg4 };
  return (
    <span style={{
      width: 16, height: 16, borderRadius: 3, flexShrink: 0,
      fontSize: 9, fontFamily: MONO, fontWeight: 700,
      color: s.color, background: s.bg,
      display: "inline-flex", alignItems: "center", justifyContent: "center",
    }}>
      {s.label}
    </span>
  );
}

// ── Inline diff viewer ────────────────────────────────────────────────────────

function InlineDiff({ diff }: { diff: string }) {
  const lines = diff.split("\n");
  return (
    <div style={{ borderTop: `1px solid ${C.border}`, background: C.bg0, overflowX: "auto", maxHeight: 380, overflowY: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: 36 }} />
          <col style={{ width: 14 }} />
          <col />
        </colgroup>
        <tbody>
          {lines.map((line, i) => {
            const isAdd  = line.startsWith("+") && !line.startsWith("+++");
            const isDel  = line.startsWith("-") && !line.startsWith("---");
            const isHunk = line.startsWith("@@");
            const isMeta = !isAdd && !isDel && !isHunk &&
              (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index "));
            const rowBg  = isAdd ? "rgba(60,255,160,.055)" : isDel ? "rgba(255,95,109,.055)" : "transparent";
            const gutBg  = isAdd ? "rgba(60,255,160,.07)"  : isDel ? "rgba(255,95,109,.07)"  : "rgba(255,255,255,.012)";
            const sigCol = isAdd ? "rgba(60,255,160,.55)"  : isDel ? "rgba(255,95,109,.55)"  : "transparent";
            const txtCol = isAdd  ? "rgba(155,240,195,.88)"
                         : isDel  ? "rgba(240,155,162,.88)"
                         : isHunk ? "rgba(90,175,200,.55)"
                         : isMeta ? C.t3 : C.t2;
            return (
              <tr key={i} style={{ background: rowBg }}>
                <td style={{
                  padding: "0 6px 0 4px", textAlign: "right",
                  fontSize: 9, fontFamily: MONO, color: "rgba(255,255,255,.13)",
                  userSelect: "none", background: gutBg,
                  borderRight: `1px solid ${C.border}`,
                  lineHeight: "17px", verticalAlign: "top",
                }}>
                  {!isMeta && !isHunk ? i + 1 : ""}
                </td>
                <td style={{
                  textAlign: "center", fontSize: 10, fontFamily: MONO,
                  color: sigCol, userSelect: "none", background: gutBg,
                  borderRight: `1px solid ${C.border}`,
                  lineHeight: "17px", verticalAlign: "top", fontWeight: 700,
                }}>
                  {isAdd ? "+" : isDel ? "−" : ""}
                </td>
                <td style={{ paddingLeft: 8, paddingRight: 6, lineHeight: "17px", verticalAlign: "top" }}>
                  <span style={{
                    fontSize: 11, color: txtCol, fontFamily: MONO,
                    whiteSpace: "pre-wrap", wordBreak: "break-all",
                    fontStyle: isHunk ? "italic" : "normal",
                  }}>
                    {line || " "}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── File row ──────────────────────────────────────────────────────────────────

function FileRow({
  fc, onDiscard, onFileClick,
}: {
  fc: LiveDiffFile;
  onDiscard?: (path: string) => Promise<void>;
  onFileClick?: (fc: LiveDiffFile) => void;
}) {
  const [open, setOpen]         = useState(false);
  const [hovered, setHovered]   = useState(false);
  const [copied, setCopied]     = useState(false);
  const [discarding, setDiscarding] = useState(false);

  const segs = fc.path.replace(/\\/g, "/").split("/");
  const name = segs.pop() ?? fc.path;
  const dir  = segs.join("/");
  const ins  = fc.insertions ?? 0;
  const del  = fc.deletions  ?? 0;
  const ct   = (fc as any).change_type ?? "modified";
  const hasDiff = !!fc.diff?.trim();

  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(fc.path).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [fc.path]);

  const handleDiscard = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onDiscard) return;
    setDiscarding(true);
    try { await onDiscard(fc.path); } finally { setDiscarding(false); }
  }, [fc.path, onDiscard]);

  const handleOpen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onFileClick?.(fc);
  }, [fc, onFileClick]);

  return (
    <div style={{ borderBottom: `1px solid ${C.border}` }}>
      {/* Row header */}
      <div
        onClick={() => hasDiff && setOpen(v => !v)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex", alignItems: "center", gap: 7,
          padding: "6px 10px",
          cursor: hasDiff ? "pointer" : "default",
          background: hovered ? C.bg2 : C.bg1,
          transition: "background .08s",
          userSelect: "none",
        }}
      >
        {/* Chevron */}
        <span style={{ color: hasDiff ? C.t3 : "transparent", flexShrink: 0, width: 12 }}>
          {hasDiff && <ChevronIcon open={open} />}
        </span>

        {/* Type badge */}
        <TypeBadge type={ct} />

        {/* Filename */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 12, fontFamily: MONO, color: C.t0, fontWeight: 600, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {name}
          </span>
          {dir && (
            <span style={{ fontSize: 10, fontFamily: MONO, color: C.t3, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {dir}/
            </span>
          )}
        </div>

        {/* +/- pill */}
        {(ins > 0 || del > 0) && (
          <div style={{
            display: "flex", alignItems: "center", gap: 3,
            background: C.bg3, border: `1px solid ${C.border}`,
            borderRadius: 4, padding: "2px 6px", flexShrink: 0,
          }}>
            <span style={{ fontSize: 10, fontFamily: MONO, color: C.green, fontWeight: 700 }}>+{ins}</span>
            <span style={{ fontSize: 9, color: C.t3 }}>·</span>
            <span style={{ fontSize: 10, fontFamily: MONO, color: del > 0 ? C.red : C.t3, fontWeight: 700 }}>-{del}</span>
          </div>
        )}

        {/* Action icons — show on hover */}
        <div style={{
          display: "flex", gap: 1, opacity: hovered ? 1 : 0,
          transition: "opacity .1s", flexShrink: 0,
        }}>
          <ActionBtn onClick={handleCopy} title={copied ? "Copied!" : "Copy path"}>
            {copied ? <CheckIcon /> : <CopyIcon />}
          </ActionBtn>
          {onDiscard && (
            <ActionBtn onClick={handleDiscard} title="Discard changes" danger>
              {discarding
                ? <div style={{ width: 10, height: 10, border: `1.5px solid ${C.border}`, borderTopColor: C.red, borderRadius: "50%", animation: "gitspin .7s linear infinite" }} />
                : <DiscardIcon />}
            </ActionBtn>
          )}
          {onFileClick && (
            <ActionBtn onClick={handleOpen} title="Open file">
              <OpenIcon />
            </ActionBtn>
          )}
        </div>
      </div>

      {/* Diff */}
      {open && hasDiff && <InlineDiff diff={fc.diff!} />}
      {open && !hasDiff && (
        <div style={{ padding: "5px 12px 6px 39px", fontSize: 11, color: C.t3, fontFamily: SANS, borderTop: `1px solid ${C.border}`, background: C.bg0 }}>
          {ct === "deleted" ? "File deleted" : "Computing diff…"}
        </div>
      )}
    </div>
  );
}

function ActionBtn({ onClick, title, children, danger }: {
  onClick: (e: React.MouseEvent) => void; title: string; children: React.ReactNode; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 22, height: 22, borderRadius: 4, border: "none",
        background: "transparent", color: C.t3,
        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
        transition: "all .1s", flexShrink: 0,
      }}
      onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = danger ? C.redBg : C.bg4; el.style.color = danger ? C.red : C.t0; }}
      onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.color = C.t3; }}
    >
      {children}
    </button>
  );
}

// ── Commit box ────────────────────────────────────────────────────────────────

function CommitBox({ message, onMessage, onCommit, committing }: {
  message: string; onMessage: (m: string) => void; onCommit: () => void; committing: boolean;
}) {
  return (
    <div style={{ flexShrink: 0, borderTop: `1px solid ${C.border}`, padding: "10px 10px", background: C.bg1, display: "flex", flexDirection: "column", gap: 7 }}>
      <textarea
        value={message}
        onChange={e => onMessage(e.target.value)}
        placeholder="Commit message…"
        rows={2}
        style={{
          width: "100%", boxSizing: "border-box",
          background: C.bg0, border: `1px solid ${C.border}`,
          borderRadius: 6, color: C.t0, fontSize: 12,
          padding: "7px 10px", outline: "none",
          fontFamily: SANS, resize: "none", lineHeight: 1.5,
        }}
        onFocus={e => { (e.target as HTMLElement).style.borderColor = C.borderMd; }}
        onBlur={e => { (e.target as HTMLElement).style.borderColor = C.border; }}
        onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onCommit(); }}
      />
      <button
        onClick={onCommit}
        disabled={committing || !message.trim()}
        style={{
          width: "100%", padding: "8px 0", borderRadius: 6, border: "none",
          background: message.trim() && !committing ? C.t0 : C.bg4,
          color: message.trim() && !committing ? C.bg0 : C.t3,
          fontSize: 12, fontFamily: SANS, fontWeight: 600,
          cursor: message.trim() && !committing ? "pointer" : "default",
          transition: "all .12s",
        }}
      >
        {committing ? "Committing…" : "Commit all changes"}
      </button>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function ChangesTab({
  files, committing, message, onMessage, onCommit,
  onFileClick, onDiscard, commitCount,
}: Props) {
  const totalIns = files.reduce((s, f) => s + (f.insertions ?? 0), 0);
  const totalDel = files.reduce((s, f) => s + (f.deletions  ?? 0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>

      {/* Sub-header */}
      <div style={{
        height: 34, padding: "0 10px",
        display: "flex", alignItems: "center", gap: 8,
        borderBottom: `1px solid ${C.border}`,
        flexShrink: 0, background: C.bg1,
      }}>
        <span style={{ fontSize: 11, fontFamily: SANS, color: C.t2, fontWeight: 500 }}>
          Changes
        </span>

        {files.length > 0 ? (
          <>
            <span style={{
              fontSize: 10, fontFamily: MONO, color: C.t0,
              background: C.bg4, borderRadius: 4, padding: "1px 6px",
              border: `1px solid ${C.border}`, fontWeight: 600,
            }}>
              {files.length}
            </span>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 10, fontFamily: MONO, color: C.green, fontWeight: 700 }}>+{totalIns}</span>
            <span style={{ fontSize: 10, fontFamily: MONO, color: C.red, fontWeight: 700 }}>-{totalDel}</span>
          </>
        ) : (
          <div style={{ flex: 1 }} />
        )}

        {commitCount !== undefined && commitCount > 0 && (
          <span style={{ fontSize: 10, fontFamily: MONO, color: C.t3 }}>
            {commitCount} ahead
          </span>
        )}
      </div>

      {/* File list */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {files.length === 0 ? (
          <div style={{ padding: "44px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span style={{ fontSize: 12, color: C.t3, fontFamily: SANS }}>Working tree clean</span>
          </div>
        ) : (
          files.map(fc => (
            <FileRow key={fc.path} fc={fc} onDiscard={onDiscard} onFileClick={onFileClick} />
          ))
        )}
      </div>

      {/* Commit box */}
      {files.length > 0 && onCommit && onMessage && (
        <CommitBox
          message={message ?? ""}
          onMessage={onMessage}
          onCommit={onCommit}
          committing={committing ?? false}
        />
      )}

      <style>{"@keyframes gitspin{to{transform:rotate(360deg)}}"}</style>
    </div>
  );
}
