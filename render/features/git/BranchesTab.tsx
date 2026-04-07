import { useEffect, useState } from "react";
import { C, MONO, SANS } from "../../design";
import type { AgentBranch, BranchStatus, GitCommit } from "./types";

// ── Agent slug display ────────────────────────────────────────────────────────

function agentLabel(kind: string) {
  const k = kind.toLowerCase();
  if (k.includes("claude")) return "claude";
  if (k.includes("codex")) return "codex";
  if (k.includes("gemini")) return "gemini";
  if (k.includes("cursor")) return "cursor";
  if (k.includes("copilot")) return "copilot";
  if (k.includes("opencode")) return "opencode";
  return kind || "agent";
}

function statusColor(status: AgentBranch["status"]) {
  if (status === "working") return C.t0;
  if (status === "merged") return "#4ade80";
  if (status === "deleted") return C.t3;
  return C.t2; // done
}

// ── Agent Branch Row ──────────────────────────────────────────────────────────

function AgentBranchRow({
  ab,
  onMerge,
  onDelete,
  onBranchLog,
  onBranchStatus,
}: {
  ab: AgentBranch;
  onMerge: (b: string) => Promise<void>;
  onDelete: (b: string, force?: boolean) => Promise<void>;
  onBranchLog: (b: string) => Promise<GitCommit[]>;
  onBranchStatus: (b: string) => Promise<BranchStatus>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [status, setStatus] = useState<BranchStatus | null>(null);
  const [merging, setMerging] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadingLog, setLoadingLog] = useState(false);

  const shortBranch = ab.branch.split("/").slice(1).join("/") || ab.branch;
  const isActive = ab.worktree_path !== null;
  const canMerge = ab.status === "done" || ab.status === "working";
  const canDelete = ab.status !== "deleted";

  useEffect(() => {
    // Load status immediately for done branches so we show ahead count
    if (ab.status === "done" || ab.status === "working") {
      onBranchStatus(ab.branch)
        .then(setStatus)
        .catch(() => {});
    }
  }, [ab.branch, ab.status]);

  const toggleLog = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setLoadingLog(true);
    try {
      const log = await onBranchLog(ab.branch);
      setCommits(log);
      setExpanded(true);
    } catch {
      /* no commits */
    } finally {
      setLoadingLog(false);
    }
  };

  const handleMerge = async () => {
    setMerging(true);
    try {
      await onMerge(ab.branch);
    } finally {
      setMerging(false);
    }
  };

  const handleDelete = async (force = false) => {
    setDeleting(true);
    try {
      await onDelete(ab.branch, force);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      style={{
        background: C.bg2,
        border: `1px solid ${isActive ? C.borderMd : C.border}`,
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      {/* Main row */}
      <div style={{ padding: "9px 10px", display: "flex", alignItems: "center", gap: 8 }}>
        {/* Active indicator dot */}
        <div
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            flexShrink: 0,
            background: isActive ? "#4ade80" : C.bg4,
            boxShadow: isActive ? "0 0 6px #4ade8088" : "none",
          }}
        />

        {/* Branch name + agent badge */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
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
            </span>
            <span
              style={{
                fontSize: 9,
                fontFamily: MONO,
                color: C.t3,
                background: C.bg4,
                borderRadius: 4,
                padding: "1px 5px",
                flexShrink: 0,
              }}
            >
              {agentLabel(ab.agent_kind)}
            </span>
          </div>

          {/* Status line */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10, fontFamily: SANS, color: statusColor(ab.status) }}>
              {isActive ? "● running" : ab.status}
            </span>
            {status && status.ahead > 0 && (
              <span style={{ fontSize: 10, fontFamily: MONO, color: C.t3 }}>
                +{status.ahead} commit{status.ahead !== 1 ? "s" : ""}
              </span>
            )}
            {status?.has_conflicts && (
              <span style={{ fontSize: 10, fontFamily: MONO, color: "#f87171" }}>⚡conflicts</span>
            )}
            {ab.commit_count > 0 && !status && (
              <span style={{ fontSize: 10, fontFamily: MONO, color: C.t3 }}>
                {ab.commit_count} commit{ab.commit_count !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          {/* View commits */}
          {canMerge && (
            <Btn
              onClick={toggleLog}
              loading={loadingLog}
              label={expanded ? "▲" : "commits"}
              title="View commits on this branch"
            />
          )}

          {/* Merge */}
          {canMerge && ab.status !== "merged" && (
            <Btn
              onClick={handleMerge}
              loading={merging}
              label="Merge"
              title={`Merge ${ab.branch} into current branch`}
              primary
              disabled={status?.has_conflicts}
            />
          )}

          {/* Delete */}
          {canDelete && ab.status !== "working" && (
            <Btn
              onClick={() => handleDelete(ab.status === "merged")}
              loading={deleting}
              label="Delete"
              title="Delete this branch"
              danger
            />
          )}
        </div>
      </div>

      {/* Expanded commit log */}
      {expanded && commits.length > 0 && (
        <div
          style={{
            borderTop: `1px solid ${C.border}`,
            background: C.bg1,
            maxHeight: 200,
            overflowY: "auto",
          }}
        >
          {commits.map((c) => (
            <div
              key={c.hash}
              style={{
                padding: "6px 12px",
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                borderBottom: `1px solid ${C.border}`,
              }}
            >
              <span
                style={{ fontSize: 10, fontFamily: MONO, color: C.t3, flexShrink: 0, marginTop: 1 }}
              >
                {c.short_hash}
              </span>
              <span style={{ fontSize: 11, fontFamily: SANS, color: C.t1, flex: 1 }}>
                {c.message}
              </span>
            </div>
          ))}
        </div>
      )}

      {expanded && commits.length === 0 && (
        <div
          style={{
            padding: "8px 12px",
            fontSize: 11,
            color: C.t3,
            fontFamily: SANS,
            borderTop: `1px solid ${C.border}`,
          }}
        >
          No commits ahead of main.
        </div>
      )}
    </div>
  );
}

function Btn({
  onClick,
  loading,
  label,
  title,
  primary,
  danger,
  disabled,
}: {
  onClick: () => void;
  loading: boolean;
  label: string;
  title?: string;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  const bg = primary ? C.t0 : danger ? "transparent" : "transparent";
  const color = primary ? C.bg0 : danger ? "#f87171" : C.t2;
  const border = primary ? "none" : `1px solid ${danger ? "#f8717166" : C.border}`;

  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      title={title}
      style={{
        padding: "4px 9px",
        borderRadius: 6,
        border,
        background: disabled ? C.bg4 : loading ? C.bg3 : bg,
        color: disabled ? C.t3 : color,
        fontSize: 10,
        fontFamily: SANS,
        cursor: disabled || loading ? "default" : "pointer",
        transition: "all .1s",
        fontWeight: primary ? 600 : 400,
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={(e) => {
        if (!disabled && !loading) {
          const el = e.currentTarget as HTMLElement;
          if (!primary) {
            el.style.borderColor = danger ? "#f87171" : C.borderMd;
            el.style.color = danger ? "#f87171" : C.t0;
          }
        }
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement;
        if (!primary) {
          el.style.borderColor = danger ? "#f8717166" : C.border;
          el.style.color = color;
        }
      }}
    >
      {loading ? "…" : label}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  agentBranches: AgentBranch[];
  allBranches: string[];
  currentBranch: string;
  onSwitch: (b: string) => void;
  onCreate?: (b: string) => Promise<void>;
  onRename?: (oldName: string, newName: string) => Promise<void>;
  onMerge: (b: string) => Promise<void>;
  onDelete: (b: string, force?: boolean) => Promise<void>;
  onBranchLog: (b: string) => Promise<GitCommit[]>;
  onBranchStatus: (b: string) => Promise<BranchStatus>;
}

export function BranchesTab({
  agentBranches,
  allBranches,
  currentBranch,
  onSwitch,
  onCreate,
  onRename,
  onMerge,
  onDelete,
  onBranchLog,
  onBranchStatus,
}: Props) {
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [renaming, setRenaming] = useState(false);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await onCreate?.(name);
      setNewName("");
      setShowNew(false);
    } finally {
      setCreating(false);
    }
  };

  const handleRename = async () => {
    const name = renameVal.trim();
    if (!name || !renamingId) return;
    setRenaming(true);
    try {
      await onRename?.(renamingId, name);
      setRenamingId(null);
      setRenameVal("");
    } finally {
      setRenaming(false);
    }
  };

  // Only show active + done agent branches (not deleted)
  const visibleAgentBranches = agentBranches.filter((ab) => ab.status !== "deleted");

  const filtered = allBranches.filter((b) => {
    const clean = b.replace("remotes/origin/", "").replace("heads/", "");
    // Hide agent branches from the regular list — they have their own section
    if (clean.startsWith("stackbox/")) return false;
    return !filter || clean.toLowerCase().includes(filter.toLowerCase());
  });

  const local = filtered.filter((b) => !b.startsWith("remotes/"));
  const remote = filtered.filter((b) => b.startsWith("remotes/"));

  const BranchRow = ({ b }: { b: string }) => {
    const clean = b.replace("remotes/origin/", "").replace("heads/", "");
    const isActive = clean === currentBranch || b === currentBranch;
    const isRemote = b.startsWith("remotes/");
    const isRenamingThis = renamingId === clean;

    return (
      <div
        style={{
          background: isActive ? C.bg3 : C.bg2,
          border: `1px solid ${isActive ? C.borderMd : C.border}`,
          borderRadius: 8,
          padding: "8px 10px",
          display: "flex",
          flexDirection: "column",
          gap: isRenamingThis ? 8 : 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: "2px",
              background: isActive ? C.t0 : C.t3,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: 12,
              fontFamily: MONO,
              color: isActive ? C.t0 : C.t1,
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {isActive && <span style={{ color: C.t3, marginRight: 5 }}>→</span>}
            {clean}
          </span>

          {isRemote && !isActive && (
            <span
              style={{
                fontSize: 9,
                fontFamily: MONO,
                color: C.t3,
                background: C.bg4,
                borderRadius: 4,
                padding: "1px 5px",
              }}
            >
              remote
            </span>
          )}
          {isActive && (
            <span
              style={{
                fontSize: 10,
                fontFamily: SANS,
                color: C.t3,
                background: C.bg4,
                borderRadius: 6,
                padding: "2px 7px",
              }}
            >
              current
            </span>
          )}
          {isActive && !isRemote && onRename && !isRenamingThis && (
            <button
              onClick={() => {
                setRenamingId(clean);
                setRenameVal(clean);
              }}
              style={{
                padding: "4px 10px",
                background: "transparent",
                border: `1px solid ${C.border}`,
                borderRadius: 6,
                color: C.t2,
                fontSize: 10,
                fontFamily: SANS,
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.borderColor = C.borderMd;
                el.style.color = C.t0;
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.borderColor = C.border;
                el.style.color = C.t2;
              }}
            >
              Rename
            </button>
          )}
          {!isActive && !isRemote && (
            <button
              onClick={() => onSwitch(clean)}
              style={{
                padding: "4px 10px",
                background: "transparent",
                border: `1px solid ${C.border}`,
                borderRadius: 6,
                color: C.t2,
                fontSize: 10,
                fontFamily: SANS,
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.borderColor = C.borderMd;
                el.style.color = C.t0;
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.borderColor = C.border;
                el.style.color = C.t2;
              }}
            >
              Switch
            </button>
          )}
          {isRemote && !isActive && (
            <button
              onClick={() => onSwitch(clean)}
              style={{
                padding: "4px 10px",
                background: "transparent",
                border: `1px solid ${C.border}`,
                borderRadius: 6,
                color: C.t2,
                fontSize: 10,
                fontFamily: SANS,
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.borderColor = C.borderMd;
                el.style.color = C.t0;
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.borderColor = C.border;
                el.style.color = C.t2;
              }}
            >
              Checkout
            </button>
          )}
        </div>

        {isRenamingThis && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <input
              value={renameVal}
              onChange={(e) => setRenameVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
                if (e.key === "Escape") {
                  setRenamingId(null);
                  setRenameVal("");
                }
              }}
              placeholder="new-branch-name"
              style={{
                background: C.bg0,
                border: `1px solid ${C.borderMd}`,
                borderRadius: 8,
                color: C.t0,
                fontSize: 12,
                padding: "7px 10px",
                outline: "none",
                fontFamily: MONO,
                width: "100%",
                boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => {
                  setRenamingId(null);
                  setRenameVal("");
                }}
                style={{
                  padding: "6px 12px",
                  background: "transparent",
                  border: `1px solid ${C.border}`,
                  borderRadius: 7,
                  color: C.t2,
                  fontSize: 11,
                  fontFamily: SANS,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleRename}
                disabled={renaming || !renameVal.trim() || renameVal.trim() === renamingId}
                style={{
                  flex: 1,
                  padding: "6px 0",
                  borderRadius: 7,
                  border: "none",
                  background:
                    renameVal.trim() && renameVal.trim() !== renamingId && !renaming ? C.t0 : C.bg4,
                  color:
                    renameVal.trim() && renameVal.trim() !== renamingId && !renaming ? C.bg0 : C.t3,
                  fontSize: 11,
                  fontFamily: SANS,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {renaming ? "Renaming…" : "Rename Branch"}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflowY: "auto" }}
    >
      {/* ── Agent Branches section ── */}
      {visibleAgentBranches.length > 0 && (
        <div style={{ padding: "8px 8px 0" }}>
          <div
            style={{
              fontSize: 9,
              fontFamily: MONO,
              color: C.t3,
              letterSpacing: ".08em",
              padding: "4px 2px 6px",
            }}
          >
            AGENT BRANCHES
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {visibleAgentBranches.map((ab) => (
              <AgentBranchRow
                key={ab.id}
                ab={ab}
                onMerge={onMerge}
                onDelete={onDelete}
                onBranchLog={onBranchLog}
                onBranchStatus={onBranchStatus}
              />
            ))}
          </div>
          <div style={{ height: 1, background: C.border, margin: "10px 0 0" }} />
        </div>
      )}

      {/* ── Create new branch ── */}
      <div style={{ padding: "8px", flexShrink: 0 }}>
        {!showNew ? (
          <button
            onClick={() => setShowNew(true)}
            style={{
              width: "100%",
              padding: "8px",
              borderRadius: 8,
              background: "transparent",
              border: `1px dashed ${C.border}`,
              color: C.t2,
              fontSize: 12,
              fontFamily: SANS,
              cursor: "pointer",
              transition: "all .15s",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLElement;
              el.style.borderColor = C.borderMd;
              el.style.color = C.t0;
              el.style.background = C.bg2;
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLElement;
              el.style.borderColor = C.border;
              el.style.color = C.t2;
              el.style.background = "transparent";
            }}
          >
            <span style={{ fontSize: 16, fontWeight: 300, lineHeight: 1 }}>+</span>
            New branch from current
          </button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") {
                  setShowNew(false);
                  setNewName("");
                }
              }}
              placeholder="branch-name"
              style={{
                background: C.bg0,
                border: `1px solid ${C.borderMd}`,
                borderRadius: 8,
                color: C.t0,
                fontSize: 12,
                padding: "8px 10px",
                outline: "none",
                fontFamily: MONO,
                width: "100%",
                boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => {
                  setShowNew(false);
                  setNewName("");
                }}
                style={{
                  padding: "7px 14px",
                  background: "transparent",
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  color: C.t2,
                  fontSize: 11,
                  fontFamily: SANS,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
                style={{
                  flex: 1,
                  padding: "7px 0",
                  borderRadius: 8,
                  border: "none",
                  background: newName.trim() && !creating ? C.t0 : C.bg4,
                  color: newName.trim() && !creating ? C.bg0 : C.t3,
                  fontSize: 11,
                  fontFamily: SANS,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {creating ? "Creating…" : "Create & Switch"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Filter ── */}
      {allBranches.filter((b) => !b.startsWith("stackbox/")).length > 5 && (
        <div style={{ padding: "0 8px 6px", flexShrink: 0 }}>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter branches…"
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: C.bg0,
              border: `1px solid ${C.border}`,
              borderRadius: 7,
              color: C.t1,
              fontSize: 11,
              padding: "5px 10px",
              outline: "none",
              fontFamily: SANS,
            }}
          />
        </div>
      )}

      {/* ── Regular branches ── */}
      <div
        style={{ flex: 1, padding: "0 8px 8px", display: "flex", flexDirection: "column", gap: 3 }}
      >
        {filtered.length === 0 &&
          allBranches.filter((b) => !b.startsWith("stackbox/")).length === 0 && (
            <div
              style={{
                padding: "16px 0",
                textAlign: "center",
                fontSize: 12,
                color: C.t2,
                fontFamily: SANS,
              }}
            >
              No branches found.
            </div>
          )}

        {local.length > 0 && (
          <>
            {remote.length > 0 && (
              <div
                style={{
                  fontSize: 9,
                  fontFamily: MONO,
                  color: C.t3,
                  letterSpacing: ".08em",
                  padding: "4px 2px",
                  marginTop: 2,
                }}
              >
                LOCAL
              </div>
            )}
            {local.map((b) => (
              <BranchRow key={b} b={b} />
            ))}
          </>
        )}

        {remote.length > 0 && (
          <>
            <div
              style={{
                fontSize: 9,
                fontFamily: MONO,
                color: C.t3,
                letterSpacing: ".08em",
                padding: "4px 2px",
                marginTop: 6,
              }}
            >
              REMOTE
            </div>
            {remote.map((b) => (
              <BranchRow key={b} b={b} />
            ))}
          </>
        )}

        {filtered.length === 0 && filter && (
          <div
            style={{
              padding: "16px 0",
              textAlign: "center",
              fontSize: 12,
              color: C.t3,
              fontFamily: SANS,
            }}
          >
            No branches match "{filter}"
          </div>
        )}
      </div>
    </div>
  );
}
