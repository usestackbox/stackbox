// render/features/git/BranchesTab.tsx

import { useEffect, useState } from "react";
import { C, MONO, SANS } from "../../design";
import type { AgentBranch, BranchDiffFile, BranchStatus } from "./types";

// ── Helpers ───────────────────────────────────────────────────────────────────
function agentLabel(kind: string) {
  const k = kind.toLowerCase();
  if (k.includes("claude"))   return "claude";
  if (k.includes("codex"))    return "codex";
  if (k.includes("gemini"))   return "gemini";
  if (k.includes("cursor"))   return "cursor";
  if (k.includes("copilot"))  return "copilot";
  if (k.includes("opencode")) return "opencode";
  return kind || "agent";
}

function statusColor(status: AgentBranch["status"]) {
  if (status === "working") return C.t0;
  if (status === "merged")  return C.green;
  if (status === "deleted") return C.t3;
  return C.t2;
}

const CT_COLOR: Record<string, string> = {
  added: C.green, deleted: C.red, renamed: C.amber, modified: C.t2,
};
const CT_LETTER: Record<string, string> = {
  added: "A", deleted: "D", renamed: "R", modified: "M",
};

// ── Table Diff Renderer ───────────────────────────────────────────────────────
function DiffTable({ raw }: { raw: string }) {
  const lines = raw.split("\n").filter((l) =>
    !l.startsWith("diff --git ") &&
    !l.startsWith("index ") &&
    !l.startsWith("new file mode") &&
    !l.startsWith("deleted file mode")
  );

  if (!lines.some((l) => l.startsWith("+") || l.startsWith("-") || l.startsWith("@@"))) {
    return (
      <div style={{ padding: "14px", fontSize: 11, color: C.t3, fontFamily: SANS }}>
        No diff available for this file.
      </div>
    );
  }

  return (
    <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
      <colgroup>
        <col style={{ width: 44 }} />
        <col style={{ width: 18 }} />
        <col />
      </colgroup>
      <tbody>
        {lines.map((line, i) => {
          const isAdd  = line.startsWith("+") && !line.startsWith("+++");
          const isDel  = line.startsWith("-") && !line.startsWith("---");
          const isHunk = line.startsWith("@@");
          const isMeta = line.startsWith("+++") || line.startsWith("---");

          const rowBg  = isAdd ? "rgba(60,255,160,.06)"  : isDel ? "rgba(255,95,109,.06)"  : "transparent";
          const gutBg  = isAdd ? "rgba(60,255,160,.10)"  : isDel ? "rgba(255,95,109,.10)"  : "rgba(155,114,239,.03)";
          const sigCol = isAdd ? "rgba(60,255,160,.65)"  : isDel ? "rgba(255,95,109,.65)"  : "transparent";
          const txtCol = isAdd  ? "rgba(160,255,200,.90)"
                       : isDel  ? "rgba(255,160,165,.88)"
                       : isHunk ? "rgba(155,114,239,.65)"
                       : isMeta ? C.t3
                       : "rgba(200,204,240,.70)";

          return (
            <tr key={i} style={{ background: rowBg }}>
              <td style={{
                padding: "0 8px", textAlign: "right", fontSize: 10, fontFamily: MONO,
                color: "rgba(108,115,175,.35)", userSelect: "none", background: gutBg,
                borderRight: `1px solid ${C.border}`, lineHeight: "19px", whiteSpace: "nowrap",
              }}>
                {!isMeta && !isHunk ? i + 1 : ""}
              </td>
              <td style={{
                textAlign: "center", fontFamily: MONO, fontSize: 11, color: sigCol,
                userSelect: "none", background: gutBg,
                borderRight: `1px solid ${C.border}`, lineHeight: "19px",
              }}>
                {isAdd ? "+" : isDel ? "−" : ""}
              </td>
              <td style={{ paddingLeft: 12, paddingRight: 8, lineHeight: "19px" }}>
                <span style={{
                  fontSize: 11.5, color: txtCol, fontFamily: MONO,
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
  );
}

// ── File Row in sidebar ───────────────────────────────────────────────────────
function FileRow({ file, selected, onSelect }: {
  file: BranchDiffFile; selected: boolean; onSelect: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const name = file.path.split("/").pop() ?? file.path;
  const dir  = file.path.includes("/") ? file.path.split("/").slice(0, -1).join("/") : "";

  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(file.path).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1400);
    });
  };

  return (
    <div
      onClick={onSelect}
      style={{
        display: "flex", alignItems: "center", gap: 7, padding: "6px 10px",
        background: selected ? C.bg3 : "transparent",
        borderLeft: `2px solid ${selected ? C.violet : "transparent"}`,
        cursor: "pointer", transition: "background .08s",
      }}
      onMouseEnter={(e) => { if (!selected) (e.currentTarget as HTMLElement).style.background = C.bg2; }}
      onMouseLeave={(e) => { if (!selected) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
    >
      <span style={{ fontSize: 10, fontFamily: MONO, fontWeight: 700, flexShrink: 0, width: 10, color: CT_COLOR[file.change_type] ?? C.t2 }}>
        {CT_LETTER[file.change_type] ?? "M"}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 11, fontFamily: MONO, color: selected ? C.t0 : C.t1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {name}
          </span>
          <button onClick={copy} style={{
            background: "none", border: "none", cursor: "pointer", padding: "1px 2px",
            borderRadius: 3, color: copied ? C.green : C.t3, display: "flex", alignItems: "center", opacity: 0.7, flexShrink: 0,
          }}>
            {copied
              ? <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              : <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            }
          </button>
        </div>
        {dir && (
          <div style={{ fontSize: 9, fontFamily: MONO, color: C.t3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>
            {dir}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
        {file.insertions > 0 && <span style={{ fontSize: 9, fontFamily: MONO, color: C.green }}>+{file.insertions}</span>}
        {file.deletions  > 0 && <span style={{ fontSize: 9, fontFamily: MONO, color: C.red   }}>-{file.deletions}</span>}
      </div>
    </div>
  );
}

// ── Branch Diff Panel (Code Review style) ─────────────────────────────────────
function BranchDiffPanel({ branchName, files, loading, onClose }: {
  branchName: string;
  files: BranchDiffFile[];
  loading: boolean;
  onClose: () => void;
}) {
  const [selectedPath, setSelectedPath] = useState<string | null>(
    files.length > 0 ? files[0].path : null
  );

  // Auto-select first when files arrive
  useEffect(() => {
    if (files.length > 0) setSelectedPath(files[0].path);
  }, [files]);

  const selectedFile = files.find(f => f.path === selectedPath);
  const totalIns = files.reduce((s, f) => s + f.insertions, 0);
  const totalDel = files.reduce((s, f) => s + f.deletions, 0);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: C.bg0 }}>

      {/* Header */}
      <div style={{
        height: 42, flexShrink: 0, display: "flex", alignItems: "center", gap: 8,
        padding: "0 12px", borderBottom: `1px solid ${C.border}`, background: C.bg1,
      }}>
        <button onClick={onClose} style={{
          background: "none", border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", gap: 5, color: C.t2,
          fontSize: 11, fontFamily: SANS, padding: "4px 8px", borderRadius: 6,
          transition: "color .1s, background .1s",
        }}
          onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.color = C.t0; el.style.background = C.bg3; }}
          onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.color = C.t2; el.style.background = "transparent"; }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Branches
        </button>

        {/* Branch name */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6 }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={C.violet} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
            <path d="M18 9a9 9 0 0 1-9 9" />
          </svg>
          <span style={{ fontSize: 12, fontFamily: MONO, color: C.t0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {branchName}
          </span>
        </div>

        {/* Stats */}
        {!loading && (
          <div style={{ display: "flex", gap: 8, flexShrink: 0, alignItems: "center" }}>
            <span style={{ fontSize: 10, fontFamily: MONO, color: C.t3 }}>{files.length} file{files.length !== 1 ? "s" : ""}</span>
            {totalIns > 0 && <span style={{ fontSize: 10, fontFamily: MONO, color: C.green, fontWeight: 700 }}>+{totalIns}</span>}
            {totalDel > 0 && <span style={{ fontSize: 10, fontFamily: MONO, color: C.red,   fontWeight: 700 }}>-{totalDel}</span>}
          </div>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <div style={{ width: 18, height: 18, border: `2px solid ${C.border}`, borderTopColor: C.violet, borderRadius: "50%", animation: "brspin .7s linear infinite" }} />
          <span style={{ fontSize: 11, color: C.t3, fontFamily: SANS }}>Loading diff…</span>
        </div>
      )}

      {/* No files */}
      {!loading && files.length === 0 && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span style={{ fontSize: 12, color: C.t3, fontFamily: SANS }}>No changes vs base branch</span>
        </div>
      )}

      {/* Split view */}
      {!loading && files.length > 0 && (
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          {/* File list */}
          <div style={{ width: 200, flexShrink: 0, borderRight: `1px solid ${C.border}`, overflowY: "auto", background: C.bg1 }}>
            <div style={{
              padding: "5px 10px", borderBottom: `1px solid ${C.border}`,
              fontSize: 9, fontFamily: MONO, color: C.t3,
              letterSpacing: ".08em", background: C.bg2,
            }}>
              {files.length} FILE{files.length !== 1 ? "S" : ""}
            </div>
            {files.map((f) => (
              <FileRow
                key={f.path}
                file={f}
                selected={f.path === selectedPath}
                onSelect={() => setSelectedPath(f.path)}
              />
            ))}
          </div>

          {/* Diff */}
          <div style={{ flex: 1, overflowY: "auto", overflowX: "auto", background: C.bg0 }}>
            {selectedFile ? (
              <>
                <div style={{
                  position: "sticky", top: 0, zIndex: 1,
                  padding: "0 14px", height: 28,
                  borderBottom: `1px solid ${C.border}`,
                  display: "flex", alignItems: "center",
                  background: "rgba(155,114,239,.04)",
                }}>
                  <span style={{ fontSize: 10, fontFamily: MONO, color: C.t3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {selectedFile.path}
                  </span>
                </div>
                {selectedFile.diff
                  ? <DiffTable raw={selectedFile.diff} />
                  : <div style={{ padding: "14px", fontSize: 11, color: C.t3, fontFamily: SANS }}>No diff content.</div>
                }
              </>
            ) : (
              <div style={{ padding: "16px", fontSize: 11, color: C.t3, fontFamily: SANS }}>Select a file to view diff.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Agent Branch Row ──────────────────────────────────────────────────────────
function AgentBranchRow({
  ab, onMerge, onDelete, onBranchStatus, onBranchDiff, onViewDiff,
}: {
  ab: AgentBranch;
  onMerge: (b: string) => Promise<void>;
  onDelete: (b: string, force?: boolean) => Promise<void>;
  onBranchStatus: (b: string) => Promise<BranchStatus>;
  onBranchDiff: (b: string) => Promise<BranchDiffFile[]>;
  onViewDiff: (branch: string) => void;
}) {
  const [status, setStatus]   = useState<BranchStatus | null>(null);
  const [merging, setMerging] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadingDiff, setLoadingDiff] = useState(false);

  const shortBranch = ab.branch.replace(/^calus\//, "");
  const isActive    = ab.worktree_path !== null;
  const canMerge    = ab.status === "done" || ab.status === "working";
  const canDelete   = ab.status !== "deleted";

  useEffect(() => {
    if (ab.status === "done" || ab.status === "working") {
      onBranchStatus(ab.branch).then(setStatus).catch(() => {});
    }
  }, [ab.branch, ab.status]);

  const handleDiff = async () => {
    setLoadingDiff(true);
    try {
      await onBranchDiff(ab.branch); // pre-fetch; parent will cache or re-fetch
      onViewDiff(ab.branch);
    } catch {
      onViewDiff(ab.branch);
    } finally {
      setLoadingDiff(false);
    }
  };

  const handleMerge = async () => {
    setMerging(true);
    try { await onMerge(ab.branch); } finally { setMerging(false); }
  };

  const handleDelete = async (force = false) => {
    setDeleting(true);
    try { await onDelete(ab.branch, force); } finally { setDeleting(false); }
  };

  return (
    <div style={{
      background: C.bg2, border: `1px solid ${isActive ? C.borderMd : C.border}`,
      borderRadius: 8, overflow: "hidden",
    }}>
      <div style={{ padding: "9px 10px", display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{
          width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
          background: isActive ? C.green : C.bg4,
          boxShadow: isActive ? `0 0 6px ${C.green}88` : "none",
        }} />

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, fontFamily: MONO, color: C.t0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {shortBranch}
            </span>
            <span style={{ fontSize: 11, fontFamily: MONO, color: C.t3, background: C.bg4, borderRadius: 4, padding: "1px 6px", flexShrink: 0 }}>
              {agentLabel(ab.agent_kind)}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, fontFamily: SANS, color: statusColor(ab.status) }}>
              {isActive ? "● running" : ab.status}
            </span>
            {status && status.ahead > 0 && (
              <span style={{ fontSize: 10, fontFamily: MONO, fontWeight: 600, color: C.green, background: C.greenBg, border: `1px solid ${C.greenBorder}`, borderRadius: 4, padding: "1px 5px" }}>
                +{status.ahead}
              </span>
            )}
            {status && status.behind > 0 && (
              <span style={{ fontSize: 10, fontFamily: MONO, fontWeight: 600, color: C.red, background: C.redBg, border: `1px solid ${C.redBorder}`, borderRadius: 4, padding: "1px 5px" }}>
                -{status.behind}
              </span>
            )}
            {status?.has_conflicts && (
              <span style={{ fontSize: 11, fontFamily: MONO, color: C.red }}>⚡conflicts</span>
            )}
            {ab.commit_count > 0 && !status && (
              <span style={{ fontSize: 11, fontFamily: MONO, color: C.t3 }}>
                {ab.commit_count} commit{ab.commit_count !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          {canMerge && (
            <Btn onClick={handleDiff} loading={loadingDiff} label="Diff" title="View changed files vs base" />
          )}
          {canMerge && ab.status !== "merged" && (
            <Btn onClick={handleMerge} loading={merging} label="Merge" primary disabled={status?.has_conflicts} />
          )}
          {canDelete && ab.status !== "working" && (
            <Btn onClick={() => handleDelete(ab.status === "merged")} loading={deleting} label="Delete" danger />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Regular Branch Row ────────────────────────────────────────────────────────
function BranchRow({
  b, currentBranch, onSwitch, onRename, onViewDiff,
  renamingId, setRenamingId, renameVal, setRenameVal,
}: {
  b: string; currentBranch: string;
  onSwitch: (b: string) => void;
  onRename?: (oldName: string, newName: string) => Promise<void>;
  onViewDiff: (branch: string) => void;
  renamingId: string | null; setRenamingId: (id: string | null) => void;
  renameVal: string; setRenameVal: (v: string) => void;
}) {
  const clean    = b.replace("remotes/origin/", "").replace("heads/", "");
  const isActive = clean === currentBranch || b === currentBranch;
  const isRemote = b.startsWith("remotes/");
  const isRenamingThis = renamingId === clean;

  const [renaming, setRenaming] = useState(false);

  const handleRename = async () => {
    const name = renameVal.trim();
    if (!name || !renamingId || !onRename) return;
    setRenaming(true);
    try {
      await onRename(renamingId, name);
      setRenamingId(null);
      setRenameVal("");
    } finally {
      setRenaming(false);
    }
  };

  return (
    <div style={{
      background: isActive ? C.bg3 : C.bg2,
      border: `1px solid ${isActive ? C.borderMd : C.border}`,
      borderRadius: 8, overflow: "hidden",
    }}>
      <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: isRenamingThis ? 8 : 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: "2px", background: isActive ? C.violet : C.t3, flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontFamily: MONO, color: isActive ? C.t0 : C.t1, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {isActive && <span style={{ color: C.t3, marginRight: 5 }}>→</span>}
            {clean}
          </span>

          {isRemote && !isActive && (
            <span style={{ fontSize: 11, fontFamily: MONO, color: C.t3, background: C.bg4, borderRadius: 4, padding: "1px 6px" }}>remote</span>
          )}
          {isActive && (
            <span style={{ fontSize: 11, fontFamily: SANS, color: C.t3, background: C.bg4, borderRadius: 6, padding: "2px 7px" }}>current</span>
          )}

          {!isActive && (
            <SmallBtn label="Diff" onClick={() => onViewDiff(clean)} />
          )}

          {isActive && !isRemote && onRename && !isRenamingThis && (
            <SmallBtn label="Rename" onClick={() => { setRenamingId(clean); setRenameVal(clean); }} />
          )}
          {!isActive && !isRemote && (
            <SmallBtn label="Switch" onClick={() => onSwitch(clean)} />
          )}
          {isRemote && !isActive && (
            <SmallBtn label="Checkout" onClick={() => onSwitch(clean)} />
          )}
        </div>

        {isRenamingThis && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <input
              value={renameVal}
              onChange={(e) => setRenameVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
                if (e.key === "Escape") { setRenamingId(null); setRenameVal(""); }
              }}
              placeholder="new-branch-name"
              style={{ background: C.bg0, border: `1px solid ${C.borderMd}`, borderRadius: 8, color: C.t0, fontSize: 12, padding: "7px 10px", outline: "none", fontFamily: MONO, width: "100%", boxSizing: "border-box" }}
            />
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => { setRenamingId(null); setRenameVal(""); }}
                style={{ padding: "6px 12px", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 7, color: C.t2, fontSize: 12, fontFamily: SANS, cursor: "pointer" }}>
                Cancel
              </button>
              <button onClick={handleRename} disabled={renaming || !renameVal.trim() || renameVal.trim() === renamingId}
                style={{ flex: 1, padding: "6px 0", borderRadius: 7, border: "none", background: renameVal.trim() && renameVal.trim() !== renamingId && !renaming ? C.t0 : C.bg4, color: renameVal.trim() && renameVal.trim() !== renamingId && !renaming ? C.bg0 : C.t3, fontSize: 12, fontFamily: SANS, fontWeight: 600, cursor: "pointer" }}>
                {renaming ? "Renaming…" : "Rename Branch"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Shared Buttons ─────────────────────────────────────────────────────────────
function Btn({ onClick, loading, label, title, primary, danger, disabled }: {
  onClick: () => void; loading: boolean; label: string;
  title?: string; primary?: boolean; danger?: boolean; disabled?: boolean;
}) {
  const bg    = primary ? C.t0 : "transparent";
  const color = primary ? C.bg0 : danger ? C.red : C.t2;
  const border = primary ? "none" : `1px solid ${danger ? `${C.red}66` : C.border}`;
  return (
    <button onClick={onClick} disabled={loading || disabled} title={title}
      style={{
        padding: "4px 9px", borderRadius: 6, border,
        background: disabled ? C.bg4 : loading ? C.bg3 : bg,
        color: disabled ? C.t3 : color,
        fontSize: 11, fontFamily: SANS,
        cursor: disabled || loading ? "default" : "pointer",
        transition: "all .1s", fontWeight: primary ? 600 : 400, opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={(e) => {
        if (!disabled && !loading && !primary) {
          const el = e.currentTarget as HTMLElement;
          el.style.borderColor = danger ? C.red : C.borderMd;
          el.style.color = danger ? C.red : C.t0;
        }
      }}
      onMouseLeave={(e) => {
        if (!primary) {
          const el = e.currentTarget as HTMLElement;
          el.style.borderColor = danger ? `${C.red}66` : C.border;
          el.style.color = color;
        }
      }}
    >
      {loading ? "…" : label}
    </button>
  );
}

function SmallBtn({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        padding: "4px 10px", background: "transparent",
        border: `1px solid ${C.border}`, borderRadius: 6,
        color: C.t2, fontSize: 11, fontFamily: SANS,
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          const el = e.currentTarget as HTMLElement;
          el.style.borderColor = C.borderMd;
          el.style.color = C.t0;
        }
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = C.border;
        el.style.color = C.t2;
      }}
    >
      {label}
    </button>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
interface Props {
  agentBranches: AgentBranch[];
  allBranches: string[];
  currentBranch: string;
  onSwitch: (b: string) => void;
  onCreate?: (b: string) => Promise<void>;
  onRename?: (oldName: string, newName: string) => Promise<void>;
  onMerge: (b: string) => Promise<void>;
  onDelete: (b: string, force?: boolean) => Promise<void>;
  onBranchStatus: (b: string) => Promise<BranchStatus>;
  onBranchDiff: (b: string) => Promise<BranchDiffFile[]>;
}

export function BranchesTab({
  agentBranches, allBranches, currentBranch,
  onSwitch, onCreate, onRename,
  onMerge, onDelete, onBranchStatus, onBranchDiff,
}: Props) {
  const [showNew, setShowNew]       = useState(false);
  const [newName, setNewName]       = useState("");
  const [creating, setCreating]     = useState(false);
  const [filter, setFilter]         = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal]   = useState("");

  // Diff panel state
  const [diffBranch, setDiffBranch]   = useState<string | null>(null);
  const [diffFiles, setDiffFiles]     = useState<BranchDiffFile[]>([]);
  const [loadingDiff, setLoadingDiff] = useState(false);

  const openDiff = async (branch: string) => {
    setDiffBranch(branch);
    setDiffFiles([]);
    setLoadingDiff(true);
    try {
      const files = await onBranchDiff(branch);
      setDiffFiles(files);
    } catch {
      setDiffFiles([]);
    } finally {
      setLoadingDiff(false);
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try { await onCreate?.(name); setNewName(""); setShowNew(false); }
    finally { setCreating(false); }
  };

  // Show diff panel
  if (diffBranch !== null) {
    return (
      <>
        <BranchDiffPanel
          branchName={diffBranch}
          files={diffFiles}
          loading={loadingDiff}
          onClose={() => { setDiffBranch(null); setDiffFiles([]); }}
        />
        <style>{"@keyframes brspin { to { transform: rotate(360deg); } }"}</style>
      </>
    );
  }

  // Only show branches that still exist in git locally.
  // Checking local only (no "remotes/") so manually deleted local branches
  // disappear immediately even if a remote tracking ref lingers.
  const localBranches = new Set(
    allBranches.filter((b) => !b.startsWith("remotes/"))
  );
  const visibleAgentBranches = agentBranches.filter(
    (ab) => ab.status !== "deleted" && localBranches.has(ab.branch),
  );

  const filtered = allBranches.filter((b) => {
    const clean = b.replace("remotes/origin/", "").replace("heads/", "");
    if (clean.startsWith("calus/")) return false;
    return !filter || clean.toLowerCase().includes(filter.toLowerCase());
  });

  const local  = filtered.filter((b) => !b.startsWith("remotes/"));
  const remote = filtered.filter((b) =>  b.startsWith("remotes/"));

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflowY: "auto" }}>

      {/* Agent Branches */}
      {visibleAgentBranches.length > 0 && (
        <div style={{ padding: "8px 8px 0" }}>
          <div style={{ fontSize: 9, fontFamily: MONO, color: C.t3, letterSpacing: ".08em", padding: "4px 2px 6px" }}>
            AGENT BRANCHES
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {visibleAgentBranches.map((ab) => (
              <AgentBranchRow
                key={ab.id}
                ab={ab}
                onMerge={onMerge}
                onDelete={onDelete}
                onBranchStatus={onBranchStatus}
                onBranchDiff={onBranchDiff}
                onViewDiff={openDiff}
              />
            ))}
          </div>
          <div style={{ height: 1, background: C.border, margin: "10px 0 0" }} />
        </div>
      )}

      {/* Create new branch */}
      <div style={{ padding: "8px", flexShrink: 0 }}>
        {!showNew ? (
          <button onClick={() => setShowNew(true)}
            style={{ width: "100%", padding: "8px", borderRadius: 8, background: "transparent", border: `1px dashed ${C.border}`, color: C.t2, fontSize: 13, fontFamily: SANS, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
            onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.borderColor = C.borderMd; el.style.color = C.t0; el.style.background = C.bg2; }}
            onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.borderColor = C.border; el.style.color = C.t2; el.style.background = "transparent"; }}
          >
            <span style={{ fontSize: 16, fontWeight: 300 }}>+</span>
            New branch from current
          </button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") { setShowNew(false); setNewName(""); } }}
              placeholder="branch-name" autoFocus
              style={{ background: C.bg0, border: `1px solid ${C.borderMd}`, borderRadius: 8, color: C.t0, fontSize: 12, padding: "8px 10px", outline: "none", fontFamily: MONO, width: "100%", boxSizing: "border-box" }}
            />
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => { setShowNew(false); setNewName(""); }}
                style={{ padding: "7px 14px", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.t2, fontSize: 12, fontFamily: SANS, cursor: "pointer" }}>
                Cancel
              </button>
              <button onClick={handleCreate} disabled={creating || !newName.trim()}
                style={{ flex: 1, padding: "7px 0", borderRadius: 8, border: "none", background: newName.trim() && !creating ? C.t0 : C.bg4, color: newName.trim() && !creating ? C.bg0 : C.t3, fontSize: 12, fontFamily: SANS, fontWeight: 600, cursor: "pointer" }}>
                {creating ? "Creating…" : "Create & Switch"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Filter */}
      {allBranches.filter((b) => !b.startsWith("calus/")).length > 5 && (
        <div style={{ padding: "0 8px 6px", flexShrink: 0 }}>
          <input value={filter} onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter branches…"
            style={{ width: "100%", boxSizing: "border-box", background: C.bg0, border: `1px solid ${C.border}`, borderRadius: 7, color: C.t1, fontSize: 11, padding: "5px 10px", outline: "none", fontFamily: SANS }}
          />
        </div>
      )}

      {/* Branch list */}
      <div style={{ flex: 1, padding: "0 8px 8px", display: "flex", flexDirection: "column", gap: 3 }}>
        {local.length > 0 && (
          <>
            {remote.length > 0 && (
              <div style={{ fontSize: 9, fontFamily: MONO, color: C.t3, letterSpacing: ".08em", padding: "4px 2px", marginTop: 2 }}>LOCAL</div>
            )}
            {local.map((b) => (
              <BranchRow key={b} b={b} currentBranch={currentBranch}
                onSwitch={onSwitch} onRename={onRename}
                onViewDiff={openDiff}
                renamingId={renamingId} setRenamingId={setRenamingId}
                renameVal={renameVal} setRenameVal={setRenameVal}
              />
            ))}
          </>
        )}
        {remote.length > 0 && (
          <>
            <div style={{ fontSize: 9, fontFamily: MONO, color: C.t3, letterSpacing: ".08em", padding: "4px 2px", marginTop: 6 }}>REMOTE</div>
            {remote.map((b) => (
              <BranchRow key={b} b={b} currentBranch={currentBranch}
                onSwitch={onSwitch} onRename={onRename}
                onViewDiff={openDiff}
                renamingId={renamingId} setRenamingId={setRenamingId}
                renameVal={renameVal} setRenameVal={setRenameVal}
              />
            ))}
          </>
        )}
        {filtered.length === 0 && filter && (
          <div style={{ padding: "16px 0", textAlign: "center", fontSize: 12, color: C.t3, fontFamily: SANS }}>
            No branches match "{filter}"
          </div>
        )}
        {filtered.length === 0 && !filter && allBranches.filter((b) => !b.startsWith("calus/")).length === 0 && (
          <div style={{ padding: "16px 0", textAlign: "center", fontSize: 12, color: C.t2, fontFamily: SANS }}>
            No branches found.
          </div>
        )}
      </div>

      <style>{"@keyframes brspin { to { transform: rotate(360deg); } }"}</style>
    </div>
  );
}
