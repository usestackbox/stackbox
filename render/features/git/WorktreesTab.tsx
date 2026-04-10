// render/features/git/WorktreesTab.tsx

import { useState } from "react";
import { C, MONO, SANS } from "../../design";
import type { WorktreeEntry } from "./types";

interface Props {
  worktrees: WorktreeEntry[];
  onDiff: (wtPath: string) => Promise<string>;
}

export function WorktreesTab({ worktrees, onDiff }: Props) {
  const [diffText, setDiffText] = useState<Record<string, string>>({});
  const [loadingDiff, setLoadingDiff] = useState<string | null>(null);
  const [expandedPath, setExpandedPath] = useState<string | null>(null);

  // Show only calus/* worktrees, not main
  const calusWorktrees = worktrees.filter(
    (wt) => !wt.is_main && wt.branch.startsWith("calus/")
  );

  const handleToggleDiff = async (path: string) => {
    if (expandedPath === path) {
      setExpandedPath(null);
      return;
    }
    setExpandedPath(path);
    if (diffText[path] !== undefined) return;
    setLoadingDiff(path);
    try {
      const d = await onDiff(path);
      setDiffText((prev) => ({ ...prev, [path]: d ?? "" }));
    } catch (e) {
      setDiffText((prev) => ({ ...prev, [path]: `Error: ${e}` }));
    } finally {
      setLoadingDiff((cur) => (cur === path ? null : cur));
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
      }}
    >
      <div style={{ padding: "8px", display: "flex", flexDirection: "column", gap: 4 }}>
        {calusWorktrees.length === 0 && (
          <div
            style={{
              padding: "32px 0",
              textAlign: "center",
              fontSize: 12,
              color: C.t3,
              fontFamily: SANS,
            }}
          >
            No active agent worktrees.
            <br />
            <span style={{ fontSize: 11, color: C.t3, marginTop: 4, display: "block" }}>
              Worktrees appear here when an agent calls git_ensure.
            </span>
          </div>
        )}

        {calusWorktrees.map((wt) => {
          const isExpanded  = expandedPath === wt.path;
          const diff        = diffText[wt.path];
          const loading     = loadingDiff === wt.path;
          // "calus/claude/fix-auth" → "claude/fix-auth"
          const shortBranch = wt.branch.replace(/^calus\//, "");
          // Show last two path segments: hash/.worktrees/claude-fix-auth → ".worktrees/claude-fix-auth"
          const shortPath   = wt.path.split(/[/\\]/).slice(-2).join("/");

          return (
            <div
              key={wt.path}
              style={{
                background: C.bg2,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                overflow: "hidden",
              }}
            >
              {/* Header row — click to expand diff */}
              <div
                style={{
                  padding: "9px 10px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                }}
                onClick={() => handleToggleDiff(wt.path)}
              >
                {/* Active dot */}
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "#4ade80",
                    boxShadow: "0 0 6px #4ade8088",
                    flexShrink: 0,
                  }}
                />

                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Branch */}
                  <div
                    style={{
                      fontSize: 12,
                      fontFamily: MONO,
                      color: C.t0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {shortBranch}
                  </div>
                  {/* Path */}
                  <div
                    style={{
                      fontSize: 10,
                      fontFamily: MONO,
                      color: C.t3,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      marginTop: 2,
                    }}
                  >
                    {shortPath}
                  </div>
                </div>

                {wt.is_locked && (
                  <span style={{ fontSize: 10, fontFamily: MONO, color: "#facc15", flexShrink: 0 }}>
                    locked
                  </span>
                )}

                {loading ? (
                  <div
                    style={{
                      width: 11,
                      height: 11,
                      border: `1.5px solid ${C.border}`,
                      borderTopColor: C.t1,
                      borderRadius: "50%",
                      animation: "wtspin .7s linear infinite",
                      flexShrink: 0,
                    }}
                  />
                ) : (
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={C.t3}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                      transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                      transition: "transform .15s",
                      flexShrink: 0,
                    }}
                  >
                    <polyline points="9 6 15 12 9 18" />
                  </svg>
                )}
              </div>

              {/* Diff */}
              {isExpanded && !loading && diff !== undefined && (
                <div
                  style={{
                    borderTop: `1px solid ${C.border}`,
                    background: C.bg0,
                    maxHeight: 300,
                    overflowY: "auto",
                  }}
                >
                  {!diff.trim() ? (
                    <div
                      style={{ padding: "10px 12px", fontSize: 11, color: C.t3, fontFamily: SANS }}
                    >
                      No diff vs main repo.
                    </div>
                  ) : (
                    <pre
                      style={{
                        margin: 0,
                        padding: "8px 12px",
                        fontSize: 11,
                        fontFamily: MONO,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                        lineHeight: 1.6,
                      }}
                    >
                      {diff.split("\n").map((line, i) => {
                        let color: string = C.t2;
                        let bg = "transparent";
                        if (line.startsWith("+") && !line.startsWith("+++")) {
                          color = "#4ade80";
                          bg = "rgba(74,222,128,.06)";
                        } else if (line.startsWith("-") && !line.startsWith("---")) {
                          color = "#f87171";
                          bg = "rgba(248,113,113,.06)";
                        } else if (line.startsWith("@@")) {
                          color = "#60a5fa";
                        } else if (line.startsWith("diff") || line.startsWith("index")) {
                          color = C.t3;
                        }
                        return (
                          <span
                            key={i}
                            style={{ display: "block", color, background: bg }}
                          >
                            {line}
                          </span>
                        );
                      })}
                    </pre>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <style>{"@keyframes wtspin { to { transform: rotate(360deg); } }"}</style>
    </div>
  );
}