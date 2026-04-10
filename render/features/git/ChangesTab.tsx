import { useState, useCallback } from "react";
import { C, FS, MONO, SANS } from "../../design";
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

const INS_COL = C.green;
const DEL_COL = C.red;

function ClipboardIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform .15s ease", flexShrink: 0 }}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function StatusPill({ type }: { type: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    modified: { label: "M", color: C.amber,       bg: C.amberBg },
    added:    { label: "A", color: C.green,        bg: C.greenBg },
    deleted:  { label: "D", color: C.red,          bg: C.redBg   },
    renamed:  { label: "R", color: C.violet,       bg: C.violetBg },
    copied:   { label: "C", color: C.blue,         bg: C.blueBg  },
  };
  const s = map[type] ?? { label: "?", color: C.t3, bg: "transparent" };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 18, height: 18, borderRadius: 4,
      fontSize: 10, fontFamily: MONO, fontWeight: 700,
      color: s.color, background: s.bg,
      flexShrink: 0,
    }}>
      {s.label}
    </span>
  );
}

function InlineDiff({ diff }: { diff: string }) {
  const lines = diff.split("\n");
  return (
    <div style={{ borderTop: `1px solid ${C.border}`, overflowX: "auto", maxHeight: 360, overflowY: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: 34 }} />
          <col style={{ width: 14 }} />
          <col />
        </colgroup>
        <tbody>
          {lines.map((line, i) => {
            const isAdd  = line.startsWith("+") && !line.startsWith("+++");
            const isDel  = line.startsWith("-") && !line.startsWith("---");
            const isHunk = line.startsWith("@@");
            const isMeta = !isAdd && !isDel && !isHunk &&
              (line.startsWith("+++") || line.startsWith("---") ||
               line.startsWith("diff ") || line.startsWith("index ") ||
               line.startsWith("new file") || line.startsWith("deleted file"));
            const rowBg  = isAdd ? "rgba(77,255,170,.05)" : isDel ? "rgba(255,107,107,.05)" : "transparent";
            const gutBg  = isAdd ? "rgba(77,255,170,.07)" : isDel ? "rgba(255,107,107,.07)" : "rgba(255,255,255,.01)";
            const sigCol = isAdd ? "rgba(77,255,170,.5)"  : isDel ? "rgba(255,107,107,.5)"  : "transparent";
            const txtCol = isAdd  ? "rgba(160,235,190,.85)"
                         : isDel  ? "rgba(235,155,155,.85)"
                         : isHunk ? "rgba(106,172,172,.55)"
                         : isMeta ? C.t3
                         : C.t2;
            return (
              <tr key={i} style={{ background: rowBg }}>
                <td style={{
                  padding: "0 6px", textAlign: "right",
                  fontSize: 9, fontFamily: MONO, color: "rgba(255,255,255,.12)",
                  userSelect: "none", background: gutBg,
                  borderRight: `1px solid ${C.border}`, lineHeight: "17px", verticalAlign: "top",
                }}>
                  {!isMeta && !isHunk ? i + 1 : ""}
                </td>
                <td style={{
                  textAlign: "center", fontSize: 10, fontFamily: MONO,
                  color: sigCol, userSelect: "none", background: gutBg,
                  borderRight: `1px solid ${C.border}`, lineHeight: "17px", verticalAlign: "top",
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

function CopyPathBtn({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(path).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }, [path]);

  return (
    <button
      onClick={handleCopy}
      title={copied ? "Copied!" : `Copy path`}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 22, height: 22, borderRadius: 5,
        background: copied ? C.greenBg : "transparent",
        border: `1px solid ${copied ? C.greenBorder : "transparent"}`,
        color: copied ? C.green : C.t3,
        cursor: "pointer", flexShrink: 0,
        transition: "all .12s ease",
        padding: 0,
      }}
      onMouseEnter={e => {
        if (!copied) {
          const el = e.currentTarget as HTMLElement;
          el.style.background = C.bg4;
          el.style.color = C.t1;
          el.style.borderColor = C.border;
        }
      }}
      onMouseLeave={e => {
        if (!copied) {
          const el = e.currentTarget as HTMLElement;
          el.style.background = "transparent";
          el.style.color = C.t3;
          el.style.borderColor = "transparent";
        }
      }}
    >
      {copied ? <CheckIcon /> : <ClipboardIcon />}
    </button>
  );
}

function FileRow({ fc }: { fc: LiveDiffFile }) {
  const [open, setOpen] = useState(true);
  const [hovered, setHovered] = useState(false);

  const segments = fc.path.split(/[/\\]/);
  const name = segments.pop() ?? fc.path;
  const dir  = segments.join("/");
  const hasDiff = !!fc.diff?.trim();
  const changeType = (fc as any).change_type ?? "modified";
  const ins = (fc as any).insertions ?? 0;
  const del = (fc as any).deletions  ?? 0;

  return (
    <div style={{
      border: `1px solid ${hovered ? C.borderMd : C.border}`,
      borderRadius: 8, overflow: "hidden",
      background: C.bg2,
      transition: "border-color .12s ease",
    }}>
      <div
        onClick={() => hasDiff && setOpen(v => !v)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "7px 10px",
          cursor: hasDiff ? "pointer" : "default",
          userSelect: "none",
          background: hovered ? C.bg3 : C.bg2,
          transition: "background .1s ease",
        }}
      >
        <span style={{ color: hasDiff ? C.t3 : C.t4, opacity: hasDiff ? 1 : 0.3 }}>
          <ChevronIcon open={open && hasDiff} />
        </span>

        <StatusPill type={changeType} />

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{
            fontSize: FS.xs, fontFamily: MONO, color: C.t0, fontWeight: 600,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            lineHeight: "16px",
          }}>
            {name}
          </span>
          {dir && (
            <span style={{
              fontSize: 10, fontFamily: MONO, color: C.t3,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              lineHeight: "13px",
            }}>
              {dir}/
            </span>
          )}
        </div>

        {(ins > 0 || del > 0) && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <span style={{ fontSize: 10, fontFamily: MONO, color: ins > 0 ? INS_COL : C.t3, fontWeight: 600 }}>
              +{ins}
            </span>
            <span style={{ fontSize: 10, fontFamily: MONO, color: del > 0 ? DEL_COL : C.t3, fontWeight: 600 }}>
              -{del}
            </span>
          </div>
        )}

        <span style={{ opacity: hovered ? 1 : 0, transition: "opacity .1s ease" }}>
          <CopyPathBtn path={fc.path} />
        </span>
      </div>

      {hasDiff && open && <InlineDiff diff={fc.diff!} />}

      {!hasDiff && (
        <div style={{
          padding: "6px 12px", borderTop: `1px solid ${C.border}`,
          fontSize: FS.xxs, color: C.t3, fontFamily: SANS,
        }}>
          {changeType === "deleted" ? "File deleted" : "Recomputing…"}
        </div>
      )}
    </div>
  );
}

function WorktreeDropdown({ worktrees, selectedPath, onChange }: {
  worktrees: WorktreeEntry[];
  selectedPath: string | null;
  onChange: (path: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const mainWt  = worktrees.find(wt => wt.is_main);
  const nonMain = worktrees.filter(wt => !wt.is_main);
  const selected = selectedPath ? worktrees.find(wt => wt.path === selectedPath) : null;
  const label = selected
    ? (selected.branch.split("/").pop() ?? selected.branch)
    : (mainWt?.branch.split("/").pop() ?? mainWt?.branch ?? "main");

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          height: 22, padding: "0 8px",
          background: "transparent", border: `1px solid ${C.border}`,
          borderRadius: 5, color: C.t2, fontSize: FS.xxs, fontFamily: MONO,
          cursor: "pointer", transition: "all .1s",
        }}
        onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = C.borderMd; el.style.color = C.t1; }}
        onMouseLeave={e => { if (!open) { const el = e.currentTarget as HTMLElement; el.style.borderColor = C.border; el.style.color = C.t2; } }}
      >
        {label}
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0)", transition: "transform .15s" }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={() => setOpen(false)} />
          <div style={{
            position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 100,
            background: C.bg3, border: `1px solid ${C.borderMd}`,
            borderRadius: 8, boxShadow: C.shadowSm, minWidth: 150, padding: 3,
          }}>
            {[
              { path: null, branch: mainWt?.branch ?? "main", sublabel: "main worktree" },
              ...nonMain.map(wt => ({ path: wt.path, branch: wt.branch, sublabel: wt.path.split(/[/\\]/).slice(-2).join("/") })),
            ].map(item => (
              <div
                key={item.path ?? "__main__"}
                onClick={() => { onChange(item.path); setOpen(false); }}
                style={{
                  padding: "5px 8px", borderRadius: 4, cursor: "pointer",
                  background: selectedPath === item.path ? C.bg4 : "transparent",
                  transition: "background .08s",
                }}
                onMouseEnter={e => { if (selectedPath !== item.path) (e.currentTarget as HTMLElement).style.background = C.bg4; }}
                onMouseLeave={e => { if (selectedPath !== item.path) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <div style={{ fontSize: FS.xs, fontFamily: MONO, color: C.t0 }}>{item.branch.split("/").pop()}</div>
                <div style={{ fontSize: 10, fontFamily: MONO, color: C.t3 }}>{item.sublabel}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function ChangesTab({
  files, commitCount, worktrees, selectedWorktreePath, onWorktreeChange,
}: Props) {
  const totalIns = files.reduce((s, f) => s + ((f as any).insertions ?? 0), 0);
  const totalDel = files.reduce((s, f) => s + ((f as any).deletions  ?? 0), 0);
  const hasWorktrees = worktrees && worktrees.length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>

      <div style={{
        padding: "0 12px", height: 38,
        display: "flex", alignItems: "center", gap: 10,
        borderBottom: `1px solid ${C.border}`, flexShrink: 0,
        background: C.bg1,
      }}>
        {hasWorktrees && onWorktreeChange ? (
          <WorktreeDropdown worktrees={worktrees!} selectedPath={selectedWorktreePath ?? null} onChange={onWorktreeChange} />
        ) : (
          <span style={{ fontSize: FS.xs, fontFamily: MONO, fontWeight: 600, color: C.t1 }}>main</span>
        )}

        {files.length > 0 && (
          <span style={{ fontSize: FS.xxs, fontFamily: MONO, color: C.t3 }}>
            {files.length} {files.length === 1 ? "file" : "files"}
          </span>
        )}

        {(totalIns > 0 || totalDel > 0) && (
          <>
            <span style={{ color: C.t4, fontSize: FS.xxs, fontFamily: MONO }}>•</span>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: FS.xxs, fontFamily: MONO, color: INS_COL, fontWeight: 600 }}>+{totalIns}</span>
              <span style={{ fontSize: FS.xxs, fontFamily: MONO, color: DEL_COL, fontWeight: 600 }}>-{totalDel}</span>
            </div>
          </>
        )}

        {commitCount !== undefined && commitCount > 0 && (
          <>
            <span style={{ color: C.t4, fontSize: FS.xxs, fontFamily: MONO }}>•</span>
            <span style={{ fontSize: FS.xxs, fontFamily: MONO, color: C.t3 }}>
              {commitCount} {commitCount === 1 ? "commit" : "commits"}
            </span>
          </>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "8px", display: "flex", flexDirection: "column", gap: 4 }}>
        {files.length === 0 ? (
          <div style={{ padding: "52px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.t3}
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span style={{ fontSize: FS.xs, color: C.t3, fontFamily: SANS }}>Working tree clean</span>
          </div>
        ) : (
          files.map(fc => <FileRow key={fc.path} fc={fc} />)
        )}
      </div>
    </div>
  );
}
