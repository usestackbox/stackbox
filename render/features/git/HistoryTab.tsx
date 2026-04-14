// render/features/git/HistoryTab.tsx
import { useCallback, useState } from "react";
import { C, MONO, SANS } from "../../design";
import type { GitCommit } from "./types";

// ── Types ─────────────────────────────────────────────────────────────────────
interface ParsedFile {
  path: string;
  change_type: "added" | "deleted" | "renamed" | "modified";
  insertions: number;
  deletions: number;
  diff: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function reldate(iso: string) {
  try {
    const d = Date.now() - new Date(iso).getTime();
    if (d < 3_600_000)   return `${Math.floor(d / 60_000)}m ago`;
    if (d < 86_400_000)  return `${Math.floor(d / 3_600_000)}h ago`;
    if (d < 604_800_000) return `${Math.floor(d / 86_400_000)}d ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch { return ""; }
}

function parseDiff(raw: string): ParsedFile[] {
  if (!raw?.trim()) return [];
  const sections = raw.split(/(?=^diff --git )/m).filter(Boolean);
  return sections.map((section) => {
    const firstLine = section.split("\n")[0];
    const m = firstLine.match(/diff --git a\/(.+) b\/(.+)/);
    const path = m ? m[2] : firstLine.slice(13).trim();

    let change_type: ParsedFile["change_type"] = "modified";
    if (/^new file mode/m.test(section))     change_type = "added";
    if (/^deleted file mode/m.test(section)) change_type = "deleted";
    if (/^rename/m.test(section))            change_type = "renamed";

    let ins = 0, del = 0;
    for (const line of section.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) ins++;
      if (line.startsWith("-") && !line.startsWith("---")) del++;
    }
    return { path, change_type, insertions: ins, deletions: del, diff: section };
  });
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

// ── File Row in left sidebar ──────────────────────────────────────────────────
function FileRow({ file, selected, onSelect }: {
  file: ParsedFile; selected: boolean; onSelect: () => void;
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
        display: "flex", alignItems: "center", gap: 7,
        padding: "6px 10px",
        background: selected ? C.bg3 : "transparent",
        borderLeft: `2px solid ${selected ? C.violet : "transparent"}`,
        cursor: "pointer", transition: "background .08s",
      }}
      onMouseEnter={(e) => { if (!selected) (e.currentTarget as HTMLElement).style.background = C.bg2; }}
      onMouseLeave={(e) => { if (!selected) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
    >
      {/* Change type */}
      <span style={{
        fontSize: 10, fontFamily: MONO, fontWeight: 700, flexShrink: 0, width: 10,
        color: CT_COLOR[file.change_type],
      }}>
        {CT_LETTER[file.change_type]}
      </span>

      {/* Name + dir */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{
            fontSize: 11, fontFamily: MONO, color: selected ? C.t0 : C.t1,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{name}</span>
          <button onClick={copy} title="Copy path" style={{
            background: "none", border: "none", cursor: "pointer",
            padding: "1px 2px", borderRadius: 3,
            color: copied ? C.green : C.t3,
            display: "flex", alignItems: "center", opacity: 0.7, flexShrink: 0,
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

      {/* +/- counts */}
      <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
        {file.insertions > 0 && <span style={{ fontSize: 9, fontFamily: MONO, color: C.green }}>+{file.insertions}</span>}
        {file.deletions  > 0 && <span style={{ fontSize: 9, fontFamily: MONO, color: C.red   }}>-{file.deletions}</span>}
      </div>
    </div>
  );
}

// ── Commit Diff Panel ─────────────────────────────────────────────────────────
function CommitDiffPanel({ commit, diff, loading, onClose }: {
  commit: GitCommit; diff: string | null; loading: boolean; onClose: () => void;
}) {
  const files = diff ? parseDiff(diff) : [];
  const [selectedPath, setSelectedPath] = useState<string | null>(
    files.length > 0 ? files[0].path : null
  );

  // Auto-select first file when files load
  if (files.length > 0 && selectedPath === null) {
    setSelectedPath(files[0].path);
  }
  if (files.length > 0 && !files.find(f => f.path === selectedPath) && selectedPath !== null) {
    setSelectedPath(files[0].path);
  }

  const selectedFile = files.find(f => f.path === selectedPath);
  const totalIns = files.reduce((s, f) => s + f.insertions, 0);
  const totalDel = files.reduce((s, f) => s + f.deletions, 0);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: C.bg0 }}>

      {/* Top bar */}
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
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Commits
        </button>

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontSize: 12, fontFamily: SANS, color: C.t0, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {commit.message}
          </span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 10, fontFamily: MONO, color: C.t3 }}>{commit.short_hash}</span>
            <span style={{ fontSize: 10, fontFamily: SANS, color: C.t3 }}>{commit.author.split(" ")[0]}</span>
            <span style={{ fontSize: 10, fontFamily: SANS, color: C.t3 }}>{reldate(commit.date)}</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
          {!loading && files.length > 0 && (
            <span style={{ fontSize: 10, fontFamily: MONO, color: C.t3 }}>{files.length} file{files.length !== 1 ? "s" : ""}</span>
          )}
          {totalIns > 0 && <span style={{ fontSize: 10, fontFamily: MONO, color: C.green, fontWeight: 700 }}>+{totalIns}</span>}
          {totalDel > 0 && <span style={{ fontSize: 10, fontFamily: MONO, color: C.red,   fontWeight: 700 }}>-{totalDel}</span>}
        </div>
      </div>

      {/* Body */}
      {loading && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <div style={{ width: 18, height: 18, border: `2px solid ${C.border}`, borderTopColor: C.violet, borderRadius: "50%", animation: "htspin .7s linear infinite" }} />
          <span style={{ fontSize: 11, color: C.t3, fontFamily: SANS }}>Loading diff…</span>
        </div>
      )}

      {!loading && files.length === 0 && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 12, color: C.t3, fontFamily: SANS }}>No diff available</span>
        </div>
      )}

      {!loading && files.length > 0 && (
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>

          {/* File list sidebar */}
          <div style={{
            width: 200, flexShrink: 0, borderRight: `1px solid ${C.border}`,
            overflowY: "auto", background: C.bg1,
          }}>
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

          {/* Diff content */}
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
                <DiffTable raw={selectedFile.diff} />
              </>
            ) : (
              <div style={{ padding: "16px", fontSize: 11, color: C.t3, fontFamily: SANS }}>
                Select a file to view diff.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
interface Props {
  commits: GitCommit[];
  onDiff?: (hash: string) => Promise<string>;
}

export function HistoryTab({ commits, onDiff }: Props) {
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [diffCache, setDiffCache]       = useState<Record<string, string>>({});
  const [loadingHash, setLoadingHash]   = useState<string | null>(null);
  const [copiedHash, setCopiedHash]     = useState<string | null>(null);

  const selectedCommit = commits.find(c => c.hash === selectedHash) ?? null;

  const handleSelect = useCallback(async (hash: string) => {
    if (selectedHash === hash) { setSelectedHash(null); return; }
    setSelectedHash(hash);
    if (diffCache[hash] !== undefined || !onDiff) return;
    setLoadingHash(hash);
    try {
      const d = await onDiff(hash);
      setDiffCache(prev => ({ ...prev, [hash]: d ?? "" }));
    } catch {
      setDiffCache(prev => ({ ...prev, [hash]: "" }));
    } finally {
      setLoadingHash(null);
    }
  }, [selectedHash, diffCache, onDiff]);

  const copyHash = useCallback(async (hash: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try { await navigator.clipboard.writeText(hash); } catch {}
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 1500);
  }, []);

  // Show diff panel when a commit is selected
  if (selectedHash && selectedCommit) {
    return (
      <>
        <CommitDiffPanel
          commit={selectedCommit}
          diff={diffCache[selectedHash] ?? null}
          loading={loadingHash === selectedHash}
          onClose={() => setSelectedHash(null)}
        />
        <style>{"@keyframes htspin { to { transform: rotate(360deg); } }"}</style>
      </>
    );
  }

  // Commit list
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "8px", display: "flex", flexDirection: "column", gap: 0 }}>
      {commits.length === 0 && (
        <div style={{ padding: "40px 0", textAlign: "center", fontSize: 12, color: C.t2, fontFamily: SANS }}>
          No commits yet.
        </div>
      )}

      {commits.length > 0 && (
        <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
          {commits.map((c, i) => {
            const isFirst    = i === 0;
            const isSelected = selectedHash === c.hash;
            const copied     = copiedHash === c.hash;

            return (
              <div
                key={c.hash}
                onClick={() => handleSelect(c.hash)}
                style={{
                  display: "flex", gap: 10, alignItems: "flex-start",
                  padding: "9px 10px", cursor: "pointer",
                  background: isSelected ? C.bg3 : isFirst ? "rgba(155,114,239,.04)" : "transparent",
                  borderLeft: `2px solid ${isSelected ? C.violet : "transparent"}`,
                  borderBottom: i < commits.length - 1 ? `1px solid ${C.border}` : "none",
                  transition: "background .08s",
                }}
                onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = C.bg3; }}
                onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = isFirst ? "rgba(155,114,239,.04)" : "transparent"; }}
              >
                {/* Timeline */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, paddingTop: 4, gap: 3 }}>
                  <div style={{
                    width: 7, height: 7, borderRadius: "50%",
                    background: isFirst ? C.violet : C.t3,
                    boxShadow: isFirst ? `0 0 0 2px ${C.violet}33` : "none",
                  }} />
                  {i < commits.length - 1 && <div style={{ width: 1, height: 14, background: C.border }} />}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 12, color: isFirst ? C.t0 : C.t1, fontFamily: SANS,
                    fontWeight: isFirst ? 500 : 400,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    marginBottom: 3,
                  }}>
                    {c.message}
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button
                      onClick={(e) => copyHash(c.hash, e)}
                      title="Copy full hash"
                      style={{
                        fontSize: 10, fontFamily: MONO,
                        color: copied ? C.green : C.t3,
                        background: "transparent", border: "none",
                        cursor: "pointer", padding: 0, transition: "color .15s",
                      }}
                    >
                      {copied ? "✓ copied" : c.short_hash}
                    </button>
                    <span style={{ fontSize: 10, color: C.t3, fontFamily: SANS }}>{c.author.split(" ")[0]}</span>
                    <span style={{ fontSize: 10, color: C.t3, fontFamily: SANS }}>{reldate(c.date)}</span>
                    {isFirst && (
                      <span style={{
                        fontSize: 9, fontFamily: MONO, color: C.blue, background: C.blueBg,
                        border: `1px solid ${C.blue}30`, borderRadius: 4, padding: "1px 5px",
                      }}>HEAD</span>
                    )}
                  </div>
                </div>

                {/* Arrow */}
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                  stroke={isSelected ? C.violet : C.t3} strokeWidth="2.5"
                  strokeLinecap="round" strokeLinejoin="round"
                  style={{ flexShrink: 0, marginTop: 4, transform: isSelected ? "rotate(90deg)" : "none", transition: "transform .15s" }}>
                  <polyline points="9 6 15 12 9 18" />
                </svg>
              </div>
            );
          })}
        </div>
      )}

      <style>{"@keyframes htspin { to { transform: rotate(360deg); } }"}</style>
    </div>
  );
}
