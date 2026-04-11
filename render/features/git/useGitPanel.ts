// render/features/git/useGitPanel.ts

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
// NOTE: gitIsRepo/gitDiffLive from lib/git.ts route through git_run which does
// NOT expand "~" in cwd on Windows — all git subprocesses silently fail.
// Fix: call the Tauri commands directly; their Rust impls all call expand_home().
import { gitDiffLive, gitCurrentBranch } from "../../lib/git";
import type {
  AgentBranch,
  AgentSpan,
  BranchDiffFile,
  BranchStatus,
  ConflictFile,
  GitCommit,
  LiveDiffFile,
  WorktreeEntry,
} from "./types";

// ── File filter ───────────────────────────────────────────────────────────────

const BLOCKED_NAMES = new Set([
  ".calus-context.md",
  "claude.md",
  "agents.md",
  "gemini.md",
  "opencode.md",
  "copilot-instructions.md",
  "mcp.json",
  "skill.md",
  "payload.json",
]);
const BLOCKED_PREFIXES = [
  ".claude/",
  ".gemini/",
  ".codex/",
  ".cursor/",
  ".agents/",
  ".opencode/",
  ".github/skills/",
  ".github/copilot",
];
function isTempFile(n: string) {
  return /^(rewrite_|update_|patch_|fix_|temp_|tmp_).*\.(py|js|sh|ps1)$/.test(n);
}
function shouldBlock(path: string) {
  const norm = path.replace(/\\/g, "/").toLowerCase();
  const name = norm.split("/").pop() ?? "";
  return (
    BLOCKED_NAMES.has(name) ||
    isTempFile(name) ||
    BLOCKED_PREFIXES.some((p) => norm.startsWith(p))
  );
}

// ── Agent attribution ─────────────────────────────────────────────────────────

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

export function agentForFile(spans: AgentSpan[], modifiedAt: number): string | null {
  if (!spans.length || !modifiedAt) return null;
  let match: AgentSpan | null = null;
  for (const s of spans) {
    // Match spans that started at or before the modification time.
    // Allow a 2s grace for timing skew between DB record and file write.
    if (s.startedAt <= modifiedAt + 2000) match = s;
  }
  return match ? shortAgent(match.agent) : null;
}

// ── Timeout helper — prevents IPC hangs from blocking the UI forever ──────────

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useGitPanel(workspaceCwd: string, workspaceId: string) {
  const [isGitRepo, setIsGitRepo] = useState<boolean | null>(null);
  const [files, setFiles] = useState<LiveDiffFile[]>([]);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [worktrees, setWorktrees] = useState<WorktreeEntry[]>([]);
  const [conflicts, setConflicts] = useState<ConflictFile[]>([]);
  const [allBranches, setAllBranches] = useState<string[]>([]);
  const [agentSpans, setAgentSpans] = useState<AgentSpan[]>([]);
  const [agentBranches, setAgentBranches] = useState<AgentBranch[]>([]);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  // FIX: bump this to force re-detection without changing cwd/workspaceId
  const [detectTick, setDetectTick] = useState(0);

  // Track whether we've ever confirmed this is a git repo so we don't flash
  // the loading spinner on subsequent cwd updates (e.g. worktree path change).
  const confirmedRepo = useRef(false);
  const emptyFilesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const PORT = (window as any).__CALUS_PORT__ ?? 7700;

  const showNotice = useCallback((text: string, ok: boolean) => {
    setNotice({ text, ok });
    setTimeout(() => setNotice(null), 3500);
  }, []);

  // ── Detect git repo — with timeout so a hanging IPC never spins forever ────────
  useEffect(() => {
    // No cwd yet — show panel optimistically rather than spinning forever
    if (!workspaceCwd) {
      setIsGitRepo(true);
      return;
    }

    // Only flash the loading spinner on the very first detection for this
    // workspace. After that, re-detect silently so the panel stays visible.
    if (!confirmedRepo.current) {
      setIsGitRepo(null);
    }

    let cancelled = false;

    const detect = async () => {
      try {
        // 4-second timeout per check — a hanging Tauri IPC never blocks the UI
        const isRepo = await withTimeout(invoke<boolean>("git_is_repo", { cwd: workspaceCwd }), 4000, false);
        if (cancelled) return;
        if (isRepo) { confirmedRepo.current = true; setIsGitRepo(true); return; }

        // Double-check via branch (handles bare worktrees / detached HEAD)
        const b = await withTimeout(invoke<string>("git_current_branch", { cwd: workspaceCwd }), 4000, "");
        if (cancelled) return;
        if (b.length > 0) { confirmedRepo.current = true; setIsGitRepo(true); return; }

        confirmedRepo.current = false;
        setIsGitRepo(false);
      } catch {
        if (!cancelled) { setIsGitRepo(false); }
      }
    };

    detect();
    return () => { cancelled = true; };
  }, [workspaceCwd, workspaceId, detectTick]);

  // Reset the confirmed flag when the workspace itself changes (not just cwd).
  const prevWorkspaceId = useRef(workspaceId);
  useEffect(() => {
    if (prevWorkspaceId.current !== workspaceId) {
      confirmedRepo.current = false;
      prevWorkspaceId.current = workspaceId;
    }
  }, [workspaceId]);

  // ── Load agent spans ──────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(
      `http://localhost:${PORT}/events?runbox_id=${workspaceId}&event_type=AgentSpawned&limit=50`
    )
      .then((r) => r.json())
      .then((rows: any[]) =>
        setAgentSpans(
          rows
            .map((r) => {
              try {
                const p = JSON.parse(r.payload_json);
                return { agent: p.agent ?? "", startedAt: r.timestamp };
              } catch { return null; }
            })
            .filter((s): s is AgentSpan => !!s && s.agent !== "Shell")
            .sort((a, b) => a.startedAt - b.startedAt)
        )
      )
      .catch(() => {});
  }, [workspaceId, PORT]);

  // ── Load helpers ──────────────────────────────────────────────────────────────
  const applyFiles = useCallback((raw: LiveDiffFile[]) => {
    const deduped = new Map<string, LiveDiffFile>();
    for (const f of raw) deduped.set(f.path, f);
    const filtered = Array.from(deduped.values())
      .filter((f) => !shouldBlock(f.path))
      .sort((a, b) => (b.modified_at || 0) - (a.modified_at || 0));
    // Clear any pending empty-debounce from a previous call.
    if (emptyFilesTimer.current) {
      clearTimeout(emptyFilesTimer.current);
      emptyFilesTimer.current = null;
    }
    if (filtered.length === 0) {
      // Debounce clearing the list: watcher recomputes are async and may
      // briefly return empty mid-recompute. If a follow-up call arrives
      // with real files within 400 ms the timer is cancelled. If the 400 ms
      // fires it means all changes are genuinely gone (e.g. all committed).
      emptyFilesTimer.current = setTimeout(() => {
        setFiles([]);
        emptyFilesTimer.current = null;
      }, 400);
    } else {
      setFiles(filtered);
    };
  }, []);

  const loadFiles = useCallback(() => {
    // Wrap in a timeout so a hanging git_run IPC never silently blocks data loading
    withTimeout(gitDiffLive(workspaceCwd), 10000, [])
      .then(applyFiles)
      .catch(() => {});
  }, [workspaceCwd, applyFiles]);

  const loadCommits = useCallback(() => {
    invoke<GitCommit[]>("git_log_for_runbox", { cwd: workspaceCwd, runboxId: workspaceId })
      .then(setCommits)
      .catch(() => {});
  }, [workspaceCwd, workspaceId]);

  const loadWorktrees = useCallback(() => {
    invoke<WorktreeEntry[]>("git_worktree_list", { cwd: workspaceCwd })
      .then(setWorktrees)
      .catch(() => {});
  }, [workspaceCwd]);

  const loadConflicts = useCallback(() => {
    invoke<ConflictFile[]>("git_conflicts", { cwd: workspaceCwd })
      .then(setConflicts)
      .catch(() => setConflicts([]));
  }, [workspaceCwd]);

  const loadBranches = useCallback(() => {
    invoke<string[]>("git_branches", { cwd: workspaceCwd })
      .then(setAllBranches)
      .catch(() => {});
  }, [workspaceCwd]);

  const loadAgentBranches = useCallback(() => {
    invoke<AgentBranch[]>("git_agent_branches", { runboxId: workspaceId })
      .then(setAgentBranches)
      .catch(() => {});
  }, [workspaceId]);

  const loadAll = useCallback(() => {
    loadFiles();
    loadCommits();
    loadWorktrees();
    loadConflicts();
    loadBranches();
    loadAgentBranches();
  }, [loadFiles, loadCommits, loadWorktrees, loadConflicts, loadBranches, loadAgentBranches]);

  useEffect(() => {
    if (!isGitRepo) return;
    loadAll();
  }, [isGitRepo, loadAll]);

  useEffect(() => {
    const u = listen<string>("pty:exited", () => { loadAgentBranches(); });
    return () => { u.then((f) => f()); };
  }, [loadAgentBranches]);

  // ── Git watcher ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isGitRepo) return;
    invoke("git_watch_start", { cwd: workspaceCwd, runboxId: workspaceId }).catch(() => {});
    return () => { invoke("git_watch_stop", { cwd: workspaceCwd }).catch(() => {}); };
  }, [isGitRepo, workspaceCwd, workspaceId]);

  useEffect(() => {
    if (!isGitRepo) return;
    // The watcher fires git:live-diff when files change.
    // We ignore the backend payload and recompute the diff ourselves.
    const u = listen<unknown>("git:live-diff", () => {
      loadFiles();
      loadConflicts();
    });
    return () => { u.then((f) => f()); };
  }, [isGitRepo, loadFiles, loadConflicts]);

  // ── Git actions ───────────────────────────────────────────────────────────────
  const commit = useCallback(
    async (message: string) => {
      const result = await invoke<string>("git_stage_and_commit", {
        cwd: workspaceCwd, runboxId: workspaceId, message,
      });
      showNotice(result, true);
      loadFiles();
      loadCommits();
    },
    [workspaceCwd, workspaceId, showNotice, loadFiles, loadCommits]
  );

  const switchBranch = useCallback(
    async (branch: string) => {
      await invoke("git_checkout", { cwd: workspaceCwd, branch });
      showNotice(`→ ${branch}`, true);
      loadFiles(); loadCommits(); loadBranches();
    },
    [workspaceCwd, showNotice, loadFiles, loadCommits, loadBranches]
  );

  const createBranch = useCallback(
    async (branch: string) => {
      await invoke("git_checkout", { cwd: workspaceCwd, branch });
      showNotice(`Created & switched to ${branch}`, true);
      loadFiles(); loadCommits(); loadBranches();
    },
    [workspaceCwd, showNotice, loadFiles, loadCommits, loadBranches]
  );

  const renameBranch = useCallback(
    async (oldName: string, newName: string) => {
      await invoke("git_rename_branch", { cwd: workspaceCwd, oldName, newName });
      showNotice(`Renamed to ${newName}`, true);
      loadBranches();
    },
    [workspaceCwd, showNotice, loadBranches]
  );

  // ── Agent branch operations ───────────────────────────────────────────────────

  const mergeBranch = useCallback(
    async (branch: string) => {
      const result = await invoke<string>("git_merge_branch", { cwd: workspaceCwd, branch });
      showNotice(`Merged ${branch.split("/").pop()}`, true);
      loadAgentBranches(); loadCommits(); loadFiles();
      return result;
    },
    [workspaceCwd, showNotice, loadAgentBranches, loadCommits, loadFiles]
  );

  const deleteBranch = useCallback(
    async (branch: string, force = false) => {
      await invoke("git_delete_branch", { cwd: workspaceCwd, branch, force });
      showNotice(`Deleted ${branch.split("/").pop()}`, true);
      loadAgentBranches(); loadBranches();
    },
    [workspaceCwd, showNotice, loadAgentBranches, loadBranches]
  );

  const branchLog = useCallback(
    (branch: string, base?: string): Promise<GitCommit[]> =>
      invoke<GitCommit[]>("git_branch_log", { cwd: workspaceCwd, branch, base }),
    [workspaceCwd]
  );

  const branchStatus = useCallback(
    (branch: string, base?: string): Promise<BranchStatus> =>
      invoke<BranchStatus>("git_branch_status", { cwd: workspaceCwd, branch, base }),
    [workspaceCwd]
  );

  // ── Branch diff (for diff view in BranchesTab) ───────────────────────────────

  const branchDiff = useCallback(
    (branch: string, base?: string): Promise<BranchDiffFile[]> =>
      invoke<BranchDiffFile[]>("git_diff_branch", { cwd: workspaceCwd, branch, base }),
    [workspaceCwd]
  );

  // ── Per-file staging ──────────────────────────────────────────────────────────

  const stageFile = useCallback(
    async (path: string) => {
      await invoke("git_stage_file", { cwd: workspaceCwd, runboxId: workspaceId, path });
      loadFiles();
    },
    [workspaceCwd, workspaceId, loadFiles]
  );

  const unstageFile = useCallback(
    async (path: string) => {
      await invoke("git_unstage_file", { cwd: workspaceCwd, runboxId: workspaceId, path });
      loadFiles();
    },
    [workspaceCwd, workspaceId, loadFiles]
  );

  const discardFile = useCallback(
    async (path: string) => {
      await invoke("git_discard_file", { cwd: workspaceCwd, runboxId: workspaceId, path });
      loadFiles();
    },
    [workspaceCwd, workspaceId, loadFiles]
  );

  const commitDiff = useCallback(
    (hash: string) =>
      invoke<string>("git_diff_for_commit", { cwd: workspaceCwd, runboxId: workspaceId, hash }),
    [workspaceCwd, workspaceId]
  );

  const createWorktree = useCallback(
    async (wtName: string, newBranch: string) => {
      const bn = newBranch || wtName;
      await invoke<string>("git_worktree_create", { cwd: workspaceCwd, branch: bn, wtName });
      showNotice(`Created on ${bn}`, true);
      loadWorktrees(); loadBranches();
    },
    [workspaceCwd, showNotice, loadWorktrees, loadBranches]
  );

  const diffWorktrees = useCallback(
    (wtPath: string) =>
      invoke<string>("git_diff_between_worktrees", { cwd: workspaceCwd, otherCwd: wtPath }),
    [workspaceCwd]
  );

  return {
    isGitRepo, setIsGitRepo,
    files, commits, worktrees, conflicts,
    allBranches, agentSpans, agentBranches,
    notice, showNotice,
    commit, switchBranch, createBranch, renameBranch,
    mergeBranch, deleteBranch, branchLog, branchStatus, branchDiff,
    createWorktree, diffWorktrees,
    stageFile, unstageFile, discardFile, commitDiff,
    redetect: () => { confirmedRepo.current = false; setDetectTick(t => t + 1); },
    loadAll, loadAgentBranches, loadFiles, loadCommits, loadBranches,
  };
}
