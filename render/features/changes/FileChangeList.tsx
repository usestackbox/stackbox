// features/changes/FileChangeList.tsx
import { useCallback, useState } from "react";
import { C, MONO, SANS } from "../../design";
import { type AgentSpan, type LiveDiffFile, useFileChanges } from "./useFileChanges";

function shortAgent(name: string) {
  const n = name.toLowerCase();
  if (n.includes("codex")) return "codex";
  if (n.includes("claude")) return "claude";
  if (n.includes("gemini")) return "gemini";
  if (n.includes("cursor")) return "cursor";
  if (n.includes("copilot")) return "copilot";
  if (n.includes("opencode")) return "opencode";
  return name.split(" ")[0].toLowerCase();
}

function agentAt(spans: AgentSpan[], ts: number): string | null {
  if (!spans.length || !ts) return null;
  let match: AgentSpan | null = null;
  for (const s of spans) {
    if (s.startedAt <= ts + 5000) match = s;
  }
  return match ? shortAgent(match.agent) : null;
}

function reltime(ms: number) {
  if (!ms) return "";
  const d = Date.now() - ms;
  if (d < 60_000) return "just now";
  if (d < 3600_000) return `${Math.floor(d / 60_000)}m`;
  if (d < 86400_000) return `${Math.floor(d / 3600_000)}h`;
  return `${Math.floor(d / 86400_000)}d`;
}

const CHANGE_LETTER = { created: "A", modified: "M", deleted: "D" };
const CHANGE_STYLE = {
  created:  { color: "rgba(60,255,160,0.75)",  dot: "rgba(60,255,160,0.50)"  },
  modified: { color: "rgba(168,175,230,0.65)", dot: "rgba(130,138,200,0.40)" },
  deleted:  { color: "rgba(255,95,109,0.75)",  dot: "rgba(255,95,109,0.50)"  },
};

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };
  return (
    <button
      onClick={copy}
      title="Copy path"
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: "2px 4px",
        borderRadius: 4,
        color: copied ? C.green : C.t3,
        display: "flex",
        alignItems: "center",
        flexShrink: 0,
        transition: "color .15s, opacity .15s",
        opacity: 0,
      }}
      className="copy-btn"
    >
      {copied ? (
        // checkmark
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        // clipboard
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

// ── Full diff view ────────────────────────────────────────────────────────────
function FullDiffView({ fc, onBack }: { fc: LiveDiffFile; onBack: () => void }) {
  const fileName = fc.path.split(/[/\\]/).pop() ?? fc.path;

  // Parse diff lines — skip the noisy git meta header
  const rawLines = fc.diff ? fc.diff.split("\n") : [];
  const lines = rawLines.filter((line) => {
    // drop "diff --git", "index abc..def", "new file mode", "deleted file mode"
    if (line.startsWith("diff --git ")) return false;
    if (line.startsWith("index ")) return false;
    if (line.startsWith("new file mode")) return false;
    if (line.startsWith("deleted file mode")) return false;
    return true;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg0 }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", height: 40, flexShrink: 0,
        borderBottom: `1px solid ${C.border}`, padding: "0 4px 0 0", gap: 4,
        background: C.bg1,
      }}>
        <button
          onClick={onBack}
          style={{
            height: "100%", padding: "0 14px", background: "none", border: "none",
            borderRight: `1px solid ${C.border}`, color: C.t2, cursor: "pointer",
            fontSize: 11, fontFamily: SANS, display: "flex", alignItems: "center",
            gap: 5, transition: "color .1s",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = C.t0; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = C.t2; }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Files
        </button>

        <span style={{
          fontSize: 12, fontFamily: MONO, fontWeight: 600, color: C.t0,
          padding: "0 8px", flex: 1, overflow: "hidden", textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {fileName}
        </span>

        {/* Copy full path */}
        <button
          onClick={() => navigator.clipboard.writeText(fc.path)}
          title="Copy full path"
          style={{
            background: "none", border: "none", cursor: "pointer", padding: "3px 6px",
            borderRadius: 4, color: C.t3, display: "flex", alignItems: "center",
            transition: "color .15s",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = C.violet; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = C.t3; }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>

        <div style={{ display: "flex", gap: 6, paddingRight: 14, flexShrink: 0, fontSize: 11, fontFamily: MONO }}>
          {fc.insertions > 0 && <span style={{ color: C.green }}>+{fc.insertions}</span>}
          {fc.deletions > 0 && <span style={{ color: C.red }}>-{fc.deletions}</span>}
        </div>
      </div>

      {/* Path breadcrumb */}
      <div style={{
        padding: "0 14px", height: 26, flexShrink: 0, borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", background: "rgba(155,114,239,.03)",
      }}>
        <span style={{ fontSize: 10, fontFamily: MONO, color: C.t3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {fc.path}
        </span>
      </div>

      {/* Diff body */}
      {!fc.diff?.trim() ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 12, color: C.t3, fontFamily: SANS }}>No diff available</span>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: "auto", overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed", minWidth: 480 }}>
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

                const rowBg  = isAdd ? "rgba(60,255,160,.06)"   : isDel ? "rgba(255,95,109,.06)"  : "transparent";
                const gutBg  = isAdd ? "rgba(60,255,160,.10)"   : isDel ? "rgba(255,95,109,.10)"  : "rgba(155,114,239,.03)";
                const sigCol = isAdd ? "rgba(60,255,160,.65)"   : isDel ? "rgba(255,95,109,.65)"  : "transparent";
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
                      borderRight: `1px solid ${C.border}`, lineHeight: "19px",
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
        </div>
      )}
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  runboxId: string;
  runboxCwd: string;
  onFileClick: (fc: LiveDiffFile) => void;
}

export function FileChangeList({ runboxId, runboxCwd, onFileClick }: Props) {
  const { files, loading, error, branch, agentSpans, reload } = useFileChanges(runboxId, runboxCwd);
  const [diffFile, setDiffFile] = useState<LiveDiffFile | null>(null);

  const totalIns = files.reduce((s, f) => s + f.insertions, 0);
  const totalDel = files.reduce((s, f) => s + f.deletions, 0);

  const handleFileClick = useCallback(
    (fc: LiveDiffFile) => { setDiffFile(fc); onFileClick(fc); },
    [onFileClick]
  );

  if (diffFile) {
    return <FullDiffView fc={diffFile} onBack={() => setDiffFile(null)} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg1 }}>
      {/* Branch header */}
      <div style={{
        padding: "10px 12px", borderBottom: `1px solid ${C.border}`,
        flexShrink: 0, display: "flex", alignItems: "center", gap: 8, background: C.bg2,
      }}>
        {branch && (
          <>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={C.violet} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
            <span style={{ fontSize: 11, fontFamily: MONO, color: C.violet, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {branch}
            </span>
          </>
        )}
        <span style={{ fontSize: 10, fontFamily: MONO, color: C.t3, flexShrink: 0 }}>
          {files.length > 0 ? `${files.length} file${files.length !== 1 ? "s" : ""}` : "clean"}
        </span>
        {(totalIns > 0 || totalDel > 0) && (
          <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
            {totalIns > 0 && <span style={{ fontSize: 10, fontFamily: MONO, color: C.green, fontWeight: 600 }}>+{totalIns}</span>}
            {totalDel > 0 && <span style={{ fontSize: 10, fontFamily: MONO, color: C.red, fontWeight: 600 }}>-{totalDel}</span>}
          </div>
        )}
      </div>

      {/* File list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 6px" }}>
        {loading && (
          <div style={{ padding: "32px 0", display: "flex", justifyContent: "center" }}>
            <div style={{
              width: 14, height: 14, border: `2px solid ${C.border}`,
              borderTopColor: C.violet, borderRadius: "50%",
              animation: "spin .7s linear infinite",
            }} />
          </div>
        )}
        {!loading && error && (
          <div style={{
            margin: "6px", padding: "10px 12px",
            background: C.redBg, border: `1px solid ${C.redBorder}`,
            borderRadius: 8, fontSize: 12, color: C.red, fontFamily: SANS,
          }}>
            {error}
            <button
              onClick={() => reload(false)}
              style={{
                display: "block", marginTop: 8, padding: "4px 10px",
                background: C.bg3, border: `1px solid ${C.border}`,
                borderRadius: 6, color: C.t2, fontSize: 11, fontFamily: SANS, cursor: "pointer",
              }}
            >
              Retry
            </button>
          </div>
        )}
        {!loading && !error && files.length === 0 && (
          <div style={{ padding: "40px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span style={{ fontSize: 12, color: C.t3, fontFamily: SANS }}>No uncommitted changes</span>
          </div>
        )}

        {!loading && !error && files.map((fc) => {
          const fileName = fc.path.split(/[/\\]/).pop() ?? fc.path;
          const dirPart  = fc.path.slice(0, fc.path.length - fileName.length);
          const agentName = agentAt(agentSpans, fc.modified_at);
          const ts = reltime(fc.modified_at);
          const letter = CHANGE_LETTER[fc.change_type];
          const st = CHANGE_STYLE[fc.change_type];

          return (
            <div
              key={fc.path}
              onClick={() => handleFileClick(fc)}
              className="file-row"
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "7px 9px", borderRadius: 7, marginBottom: 1,
                cursor: "pointer", transition: "background .1s",
                position: "relative",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = C.bg3;
                const btn = (e.currentTarget as HTMLElement).querySelector(".copy-btn") as HTMLElement | null;
                if (btn) btn.style.opacity = "1";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "transparent";
                const btn = (e.currentTarget as HTMLElement).querySelector(".copy-btn") as HTMLElement | null;
                if (btn) btn.style.opacity = "0";
              }}
            >
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: st.dot, flexShrink: 0 }} />

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{
                    fontSize: 12, fontFamily: MONO, color: C.t0, fontWeight: 500,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {fileName}
                  </span>
                  {/* Copy button — appears on hover */}
                  <CopyBtn text={fc.path} />
                  <span style={{ fontSize: 9, fontFamily: MONO, fontWeight: 700, color: st.color, flexShrink: 0 }}>
                    {letter}
                  </span>
                </div>
                {dirPart && (
                  <div style={{
                    fontSize: 10, fontFamily: MONO, color: C.t3,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1,
                  }}>
                    {dirPart}
                  </div>
                )}
              </div>

              {agentName && (
                <span style={{
                  fontSize: 9, fontFamily: MONO, color: C.violet,
                  background: C.violetBg, borderRadius: 4, padding: "1px 5px", flexShrink: 0,
                }}>
                  {agentName}
                </span>
              )}

              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                {fc.insertions > 0 && <span style={{ fontSize: 10, fontFamily: MONO, color: C.green, fontWeight: 600 }}>+{fc.insertions}</span>}
                {fc.deletions > 0  && <span style={{ fontSize: 10, fontFamily: MONO, color: C.red,   fontWeight: 600 }}>-{fc.deletions}</span>}
              </div>

              {ts && <span style={{ fontSize: 10, fontFamily: MONO, color: C.t3, flexShrink: 0 }}>{ts}</span>}
            </div>
          );
        })}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .file-row:hover .copy-btn { opacity: 1 !important; }
      `}</style>
    </div>
  );
}

export default FileChangeList;