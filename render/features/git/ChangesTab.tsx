// render/features/git/ChangesTab.tsx

import { useState, useCallback, useMemo } from "react";
import { C, MONO, SANS } from "../../design";
import type { AgentSpan, BranchDiffFile, LiveDiffFile, WorktreeEntry } from "./types";

interface Props {
  files: (LiveDiffFile | BranchDiffFile)[];
  cwd?: string;
  agentSpans?: AgentSpan[];
  commitCount?: number;
  committing?: boolean;
  pushing?: boolean;
  message?: string;
  onMessage?: (msg: string) => void;
  onCommit?: () => void;
  onCommitPush?: () => void;
  onPush?: () => void;
  onFileClick?: (fc: LiveDiffFile) => void;
  onOpenFile?: (path: string) => void;
  worktrees?: WorktreeEntry[];
  selectedWorktreePath?: string | null;
  onWorktreeChange?: (path: string | null) => void;
  onStage?: (path: string) => Promise<void>;
  onUnstage?: (path: string) => Promise<void>;
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform .15s", flexShrink: 0 }}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="13" height="13" rx="2.5" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function OpenIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h6v6" />
      <path d="M10 14L21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// ── Change type badge ─────────────────────────────────────────────────────────

const TYPE_MAP: Record<string, { label: string; color: string; bg: string }> = {
  modified: { label: "M", color: C.amber,  bg: C.amberBg  },
  added:    { label: "A", color: C.green,  bg: C.greenBg  },
  created:  { label: "A", color: C.green,  bg: C.greenBg  },
  deleted:  { label: "D", color: C.red,    bg: C.redBg    },
  renamed:  { label: "R", color: C.violet, bg: C.violetBg },
};

function TypeBadge({ type }: { type: string }) {
  const s = TYPE_MAP[type] ?? { label: "M", color: C.t3, bg: C.bg4 };
  return (
    <span style={{
      width: 18, height: 18, borderRadius: 4, flexShrink: 0,
      fontSize: 10, fontFamily: MONO, fontWeight: 700,
      color: s.color, background: s.bg,
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      letterSpacing: 0,
    }}>
      {s.label}
    </span>
  );
}

// ── Inline diff viewer ────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildDiffHtml(diff: string): string {
  const lines = diff.split("\n");
  const GUT = `border-right:1px solid rgba(255,255,255,.08);`;
  const rows = lines.map((raw, i) => {
    const line = raw || " ";
    const isAdd  = raw.startsWith("+") && !raw.startsWith("+++");
    const isDel  = raw.startsWith("-") && !raw.startsWith("---");
    const isHunk = raw.startsWith("@@");
    const isMeta = !isAdd && !isDel && !isHunk &&
      (raw.startsWith("+++") || raw.startsWith("---") ||
       raw.startsWith("diff ") || raw.startsWith("index "));

    const rowBg  = isAdd ? "rgba(60,255,160,.065)" : isDel ? "rgba(255,95,109,.065)" : "";
    const gutBg  = isAdd ? "rgba(60,255,160,.08)"  : isDel ? "rgba(255,95,109,.08)"  : "rgba(255,255,255,.012)";
    const sigCol = isAdd ? "rgba(60,255,160,.75)"  : isDel ? "rgba(255,95,109,.75)"  : "transparent";
    const txtCol = isAdd  ? "rgba(160,245,200,.92)"
                 : isDel  ? "rgba(245,160,165,.92)"
                 : isHunk ? "rgba(90,175,200,.6)"
                 : isMeta ? "rgba(255,255,255,.3)" : "rgba(255,255,255,.75)";
    const lnNum  = (!isMeta && !isHunk) ? String(i + 1) : "";
    const sig    = isAdd ? "+" : isDel ? "−" : "";
    const style  = `font-style:${isHunk ? "italic" : "normal"}`;

    return `<tr style="background:${rowBg}">` +
      `<td style="padding:0 6px 0 4px;text-align:right;font-size:10px;font-family:monospace;` +
      `color:rgba(255,255,255,.15);user-select:none;background:${gutBg};${GUT}` +
      `line-height:18px;vertical-align:top;width:38px">${lnNum}</td>` +
      `<td style="text-align:center;font-size:11px;font-family:monospace;color:${sigCol};` +
      `user-select:none;background:${gutBg};${GUT}` +
      `line-height:18px;vertical-align:top;font-weight:700;width:16px">${sig}</td>` +
      `<td style="padding-left:10px;padding-right:6px;line-height:18px;vertical-align:top">` +
      `<span style="font-size:12px;color:${txtCol};font-family:monospace;` +
      `white-space:pre-wrap;word-break:break-all;${style}">${esc(line)}</span></td></tr>`;
  }).join("");

  return `<table style="border-collapse:collapse;width:100%;table-layout:fixed"><tbody>${rows}</tbody></table>`;
}

function InlineDiff({ diff }: { diff: string }) {
  const html = useMemo(() => buildDiffHtml(diff), [diff]);
  const lineCount = useMemo(() => diff.split("\n").length, [diff]);
  const maxH = Math.min(lineCount * 18, 520);

  return (
    <div
      style={{
        borderTop: `1px solid ${C.border}`,
        background: C.bg0,
        overflowX: "auto",
        overflowY: "auto",
        maxHeight: maxH,
        borderRadius: "0 0 8px 8px",
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// ── File row ──────────────────────────────────────────────────────────────────

function FileRow({
  fc, cwd, onOpenFile,
}: {
  fc: LiveDiffFile | BranchDiffFile;
  cwd?: string;
  onOpenFile?: (path: string) => void;
}) {
  const [open, setOpen]       = useState(false);
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied]   = useState(false);

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

  // Open the actual file from the workspace folder, not the diff overlay
  const handleOpen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (onOpenFile) {
      const sep = cwd?.includes("\\") ? "\\" : "/";
      const fullPath = cwd ? `${cwd}${sep}${fc.path}` : fc.path;
      onOpenFile(fullPath);
    }
  }, [fc.path, cwd, onOpenFile]);

  return (
    <div style={{
      marginBottom: 4,
      borderRadius: 8,
      border: `1px solid ${open ? C.borderMd : C.border}`,
      overflow: "hidden",
      background: hovered ? C.bg2 : C.bg1,
      transition: "border-color .12s, background .1s",
    }}>
      {/* Row header */}
      <div
        onClick={() => hasDiff && setOpen(v => !v)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "7px 10px",
          cursor: hasDiff ? "pointer" : "default",
          userSelect: "none",
        }}
      >
        {/* Chevron */}
        <span style={{ color: hasDiff ? C.t2 : "transparent", flexShrink: 0, width: 14 }}>
          {hasDiff && <ChevronIcon open={open} />}
        </span>

        {/* Type badge */}
        <TypeBadge type={ct} />

        {/* Filename */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{
            fontSize: 14, fontFamily: MONO, color: C.t0, fontWeight: 600,
            display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {name}
          </span>
          {dir && (
            <span style={{
              fontSize: 12, fontFamily: MONO, color: C.t3,
              display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {dir}/
            </span>
          )}
        </div>

         <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
          <ActionBtn onClick={handleCopy} title={copied ? "Copied!" : "Copy path"}>
            {copied ? <CheckIcon /> : <CopyIcon />}
          </ActionBtn>
        </div>

        {/* +additions left, -deletions right */}
        {(ins > 0 || del > 0) && (
          <div style={{
            display: "flex", alignItems: "center", gap: 3,
            background: C.bg3, border: `1px solid ${C.border}`,
            borderRadius: 5, padding: "2px 7px", flexShrink: 0,
          }}>
            <span style={{ fontSize: 12, fontFamily: MONO, color: C.green, fontWeight: 700 }}>+{ins}</span>
            <span style={{ fontSize: 11, color: C.t3 }}>·</span>
            <span style={{ fontSize: 12, fontFamily: MONO, color:  C.red , fontWeight: 700 }}>-{del}</span>
          </div>
        )}

      </div>

      {/* Diff — toggled by clicking the row */}
      {open && hasDiff && <InlineDiff diff={fc.diff!} />}
      {open && !hasDiff && (
        <div style={{
          padding: "6px 14px 8px 42px", fontSize: 12, color: C.t3,
          fontFamily: SANS, borderTop: `1px solid ${C.border}`, background: C.bg0,
        }}>
          {ct === "deleted" ? "File deleted" : "Computing diff…"}
        </div>
      )}
    </div>
  );
}

function ActionBtn({ onClick, title, children, active }: {
  onClick: (e: React.MouseEvent) => void;
  title: string;
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 26, height: 26, borderRadius: 5, border: "none",
        background: active ? C.bg4 : "transparent",
        color: "rgba(255,255,255,0.75)",
        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
        transition: "all .1s", flexShrink: 0,
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.background = C.bg4;
        el.style.color = "rgba(255,255,255,1)";
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.background = active ? C.bg4 : "transparent";
        el.style.color = "rgba(255,255,255,0.75)";
      }}
    >
      {children}
    </button>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function ChangesTab({
  files, cwd, onOpenFile, commitCount,
}: Props) {
  const totalIns = files.reduce((s, f) => s + (f.insertions ?? 0), 0);
  const totalDel = files.reduce((s, f) => s + (f.deletions  ?? 0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>

      {/* File list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "6px 8px 8px" }}>
        {files.length === 0 ? (
          <div style={{ padding: "44px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span style={{ fontSize: 13, color: C.t3, fontFamily: SANS }}>No Changes done</span>
          </div>
        ) : (
          files.map(fc => (
            <FileRow key={fc.path} fc={fc} cwd={cwd} onOpenFile={onOpenFile} />
          ))
        )}
      </div>

      <style>{"@keyframes gitspin{to{transform:rotate(360deg)}}"}</style>
    </div>
  );
}