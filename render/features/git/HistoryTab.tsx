import { useCallback, useState } from "react";
import { C, MONO, SANS } from "../../design";
import type { GitCommit } from "./types";

function reldate(iso: string) {
  try {
    const d = Date.now() - new Date(iso).getTime();
    if (d < 3600_000) return `${Math.floor(d / 60_000)}m ago`;
    if (d < 86400_000) return `${Math.floor(d / 3600_000)}h ago`;
    if (d < 604800_000) return `${Math.floor(d / 86400_000)}d ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

// ── Minimal diff renderer (reused from ChangesTab) ────────────────────────────

function InlineDiff({ diff }: { diff: string }) {
  if (!diff?.trim())
    return (
      <div style={{ padding: "10px 12px", fontSize: 11, color: C.t3, fontFamily: MONO }}>
        No diff available.
      </div>
    );
  return (
    <div
      style={{
        maxHeight: 360,
        overflowY: "auto",
        fontSize: 11,
        fontFamily: MONO,
        lineHeight: 1.6,
        background: C.bg0,
        borderTop: `1px solid ${C.border}`,
      }}
    >
      {diff.split("\n").map((line, i) => {
        const isAdd = line.startsWith("+") && !line.startsWith("+++");
        const isDel = line.startsWith("-") && !line.startsWith("---");
        const isHunk = line.startsWith("@@");
        return (
          <div
            key={i}
            style={{
              padding: "0 12px",
              color: isAdd ? C.green : isDel ? C.red : isHunk ? C.blue : C.t3,
              background: isAdd
                ? "rgba(74,222,128,.06)"
                : isDel
                  ? "rgba(248,113,113,.06)"
                  : "transparent",
              whiteSpace: "pre",
              overflowX: "auto",
            }}
          >
            {line || " "}
          </div>
        );
      })}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  commits: GitCommit[];
  onDiff?: (hash: string) => Promise<string>;
}

export function HistoryTab({ commits, onDiff }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [diffText, setDiffText] = useState<Record<string, string>>({});
  const [loadingHash, setLoadingHash] = useState<string | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const handleToggle = useCallback(
    async (hash: string) => {
      if (expanded === hash) {
        setExpanded(null);
        return;
      }
      setExpanded(hash);
      if (diffText[hash] !== undefined || !onDiff) return;
      setLoadingHash(hash);
      try {
        const d = await onDiff(hash);
        setDiffText((prev) => ({ ...prev, [hash]: d }));
      } catch (e) {
        setDiffText((prev) => ({ ...prev, [hash]: `Error: ${e}` }));
      } finally {
        setLoadingHash(null);
      }
    },
    [expanded, diffText, onDiff]
  );

  const copyHash = useCallback(async (hash: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(hash);
    } catch {
      /* */
    }
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 1500);
  }, []);

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "8px",
        display: "flex",
        flexDirection: "column",
        gap: 3,
      }}
    >
      {commits.length === 0 && (
        <div
          style={{
            padding: "32px 0",
            textAlign: "center",
            fontSize: 12,
            color: C.t2,
            fontFamily: SANS,
          }}
        >
          No commits yet.
        </div>
      )}

      {commits.map((c, i) => {
        const isFirst = i === 0;
        const isExpanded = expanded === c.hash;
        const diff = diffText[c.hash];
        const loading = loadingHash === c.hash;
        const copied = copiedHash === c.hash;

        return (
          <div
            key={c.hash}
            style={{
              background: isFirst ? C.bg3 : C.bg2,
              border: `1px solid ${isExpanded ? C.borderMd : isFirst ? C.borderMd : C.border}`,
              borderRadius: 8,
              overflow: "hidden",
              transition: "all .1s",
            }}
          >
            {/* Commit row */}
            <div
              onClick={() => handleToggle(c.hash)}
              style={{
                padding: "9px 10px",
                cursor: "pointer",
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = C.bg4;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "";
              }}
            >
              {/* Graph dot */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  flexShrink: 0,
                  paddingTop: 3,
                  gap: 3,
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: isFirst ? C.t0 : C.t3,
                    border: isFirst ? `2px solid ${C.bg4}` : "none",
                    boxShadow: isFirst ? `0 0 0 2px ${C.t0}22` : "none",
                  }}
                />
                {i < commits.length - 1 && (
                  <div style={{ width: 1, height: 16, background: C.border }} />
                )}
              </div>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12,
                    color: isFirst ? C.t0 : C.t1,
                    fontFamily: SANS,
                    fontWeight: isFirst ? 500 : 400,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    marginBottom: 4,
                  }}
                >
                  {c.message}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button
                    onClick={(e) => copyHash(c.hash, e)}
                    title="Copy full hash"
                    style={{
                      fontSize: 10,
                      fontFamily: MONO,
                      color: copied ? C.green : C.t3,
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      padding: 0,
                      transition: "color .15s",
                    }}
                  >
                    {copied ? "✓ copied" : c.short_hash}
                  </button>
                  <span style={{ fontSize: 10, color: C.t3, fontFamily: SANS }}>
                    {c.author.split(" ")[0]}
                  </span>
                  <span style={{ fontSize: 10, color: C.t3, fontFamily: SANS }}>
                    {reldate(c.date)}
                  </span>
                  {isFirst && (
                    <span
                      style={{
                        fontSize: 9,
                        fontFamily: MONO,
                        color: C.blue,
                        background: C.blueBg,
                        border: `1px solid ${C.blue}30`,
                        borderRadius: 4,
                        padding: "1px 5px",
                      }}
                    >
                      HEAD
                    </span>
                  )}
                </div>
              </div>

              {/* Expand toggle */}
              {onDiff && (
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: isExpanded ? "rgba(255,255,255,.12)" : "transparent",
                    transition: "background .1s",
                  }}
                >
                  {loading ? (
                    <div
                      style={{
                        width: 11,
                        height: 11,
                        border: `1.5px solid ${C.border}`,
                        borderTopColor: C.t1,
                        borderRadius: "50%",
                        animation: "htspin .7s linear infinite",
                      }}
                    />
                  ) : (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={isExpanded ? C.t0 : C.t2}
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{
                        transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                        transition: "transform .15s",
                      }}
                    >
                      <polyline points="9 6 15 12 9 18" />
                    </svg>
                  )}
                </div>
              )}
            </div>

            {/* Inline diff */}
            {isExpanded && !loading && diff !== undefined && <InlineDiff diff={diff} />}
            {isExpanded && loading && (
              <div
                style={{
                  padding: "12px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  borderTop: `1px solid ${C.border}`,
                }}
              >
                <div
                  style={{
                    width: 10,
                    height: 10,
                    border: `1.5px solid ${C.border}`,
                    borderTopColor: C.t1,
                    borderRadius: "50%",
                    animation: "htspin .7s linear infinite",
                  }}
                />
                <span style={{ fontSize: 11, color: C.t3, fontFamily: SANS }}>Loading diff…</span>
              </div>
            )}
          </div>
        );
      })}

      <style>{"@keyframes htspin { to { transform: rotate(360deg); } }"}</style>
    </div>
  );
}
