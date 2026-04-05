import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  LiveDiffFile, GitCommit, WorktreeEntry,
  ConflictFile, AgentBranch, AgentSpan, BranchStatus, GitCommit as GC,
} from "./types";

// ── File filter ───────────────────────────────────────────────────────────────

const BLOCKED_NAMES = new Set([
  ".stackbox-context.md", "claude.md", "agents.md", "gemini.md", "opencode.md",
  "copilot-instructions.md", "mcp.json", "skill.md", "payload.json",
  "rewrite_app.py", "update_app.py",
]);
const BLOCKED_PREFIXES = [
  ".claude/", ".gemini/", ".codex/", ".cursor/",
  ".agents/", ".opencode/", ".github/skills/", ".github/copilot",
];
function isTempFile(n: string) {
  return /^(rewrite_|update_|patch_|fix_|temp_|tmp_).*\.(py|js|sh|ps1)$/.test(n);
}
function shouldBlock(path: string) {
  const norm = path.replace(/\\/g, "/").toLowerCase();
  const name = norm.split("/").pop() ?? "";
  return BLOCKED_NAMES.has(name) || isTempFile(name) || BLOCKED_PREFIXES.some(p => norm.startsWith(p));
}

// ── Agent attribution ─────────────────────────────────────────────────────────

function shortAgent(name: string) {
  const n = name.toLowerCase();
  if (n.includes("codex"))    return "codex";
  if (n.includes("claude"))   return "claude";
  if (n.includes("gemini"))   return "gemini";
  if (n.includes("cursor"))   return "cursor";
  if (n.includes("copilot"))  return "copilot";
  if (n.includes("opencode")) return "opencode";
  return name.split(" ")[0].toLowerCase();
}

export function agentForFile(spans: AgentSpan[], modifiedAt: number): string | null {
  if (!spans.length || !modifiedAt) return null;
  let match: AgentSpan | null = null;
  for (const s of spans) { if (s.startedAt <= modifiedAt + 5000) match = s; }
  return match ? shortAgent(match.agent) : null;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useGitPanel(workspaceCwd: string, workspaceId: string) {
  const [isGitRepo,     setIsGitRepo]     = useState<boolean | null>(null);
  const [files,         setFiles]         = useState<LiveDiffFile[]>([]);
  const [commits,       setCommits]       = useState<GitCommit[]>([]);
  const [worktrees,     setWorktrees]     = useState<WorktreeEntry[]>([]);
  const [conflicts,     setConflicts]     = useState<ConflictFile[]>([]);
  const [allBranches,   setAllBranches]   = useState<string[]>([]);
  const [agentSpans,    setAgentSpans]    = useState<AgentSpan[]>([]);
  const [agentBranches, setAgentBranches] = useState<AgentBranch[]>([]);
  const [notice,        setNotice]        = useState<{ text: string; ok: boolean } | null>(null);

  const PORT = (window as any).__STACKBOX_PORT__ ?? 7700;

  const showNotice = useCallback((text: string, ok: boolean) => {
    setNotice({ text, ok });
    setTimeout(() => setNotice(null), 3500);
  }, []);

  // ── Detect git repo ───────────────────────────────────────────────────────────
  useEffect(() => {
    const detect = async () => {
      try {
        const b = await invoke<string>("git_current_branch", { cwd: workspaceCwd });
        if (b?.trim().length > 0) { setIsGitRepo(true); return; }
      } catch { /* not git */ }
      try {
        const wts = await invoke<any[]>("git_worktree_list", { cwd: workspaceCwd });
        if (Array.isArray(wts) && wts.length > 0) { setIsGitRepo(true); return; }
      } catch { /* not git */ }
      try {
        await invoke("git_init", { cwd: workspaceCwd });
        setIsGitRepo(true);
      } catch {
        setIsGitRepo(false);
      }
    };
    detect();
  }, [workspaceCwd, workspaceId]);

  // ── Load agent spans ──────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`http://localhost:${PORT}/events?runbox_id=${workspaceId}&event_type=AgentSpawned&limit=50`)
      .then(r => r.json())
      .then((rows: any[]) =>
        setAgentSpans(
          rows.map(r => {
            try {
              const p = JSON.parse(r.payload_json);
              return { agent: p.agent ?? "", startedAt: r.timestamp };
            } catch { return null; }
          })
            .filter((s): s is AgentSpan => !!s && s.agent !== "Shell")
            .sort((a, b) => a.startedAt - b.startedAt),
        )
      )
      .catch(() => {});
  }, [workspaceId, PORT]);

  // ── Load helpers ──────────────────────────────────────────────────────────────
  const applyFiles = useCallback((raw: LiveDiffFile[]) => {
    const deduped = new Map<string, LiveDiffFile>();
    for (const f of raw) deduped.set(f.path, f);
    setFiles(
      Array.from(deduped.values())
        .filter(f => !shouldBlock(f.path))
        .sort((a, b) => (b.modified_at || 0) - (a.modified_at || 0)),
    );
  }, []);

  const loadFiles = useCallback(() => {
    invoke<LiveDiffFile[]>("git_diff_live", { cwd: workspaceCwd, runboxId: workspaceId })
      .then(applyFiles).catch(() => {});
  }, [workspaceCwd, workspaceId, applyFiles]);

  const loadCommits = useCallback(() => {
    invoke<GitCommit[]>("git_log_for_runbox", { cwd: workspaceCwd, runboxId: workspaceId })
      .then(setCommits).catch(() => {});
  }, [workspaceCwd, workspaceId]);

  const loadWorktrees = useCallback(() => {
    invoke<WorktreeEntry[]>("git_worktree_list", { cwd: workspaceCwd })
      .then(setWorktrees).catch(() => {});
  }, [workspaceCwd]);

  const loadConflicts = useCallback(() => {
    invoke<ConflictFile[]>("git_conflicts", { cwd: workspaceCwd })
      .then(setConflicts).catch(() => setConflicts([]));
  }, [workspaceCwd]);

  const loadBranches = useCallback(() => {
    invoke<string[]>("git_branches", { cwd: workspaceCwd })
      .then(setAllBranches).catch(() => {});
  }, [workspaceCwd]);

  const loadAgentBranches = useCallback(() => {
    invoke<AgentBranch[]>("git_agent_branches", { runboxId: workspaceId })
      .then(setAgentBranches).catch(() => {});
  }, [workspaceId]);

  const loadAll = useCallback(() => {
    loadFiles(); loadCommits(); loadWorktrees(); loadConflicts();
    loadBranches(); loadAgentBranches();
  }, [loadFiles, loadCommits, loadWorktrees, loadConflicts, loadBranches, loadAgentBranches]);

  useEffect(() => {
    if (!isGitRepo) return;
    loadAll();
  }, [isGitRepo, loadAll]);

  // Refresh agent branches when a PTY session ends
  useEffect(() => {
    const u = listen<string>("pty:exited", () => {
      loadAgentBranches();
    });
    return () => { u.then(f => f()); };
  }, [loadAgentBranches]);

  // ── Git watcher ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isGitRepo) return;
    invoke("git_watch_start", { cwd: workspaceCwd, runboxId: workspaceId }).catch(() => {});
    return () => { invoke("git_watch_stop", { cwd: workspaceCwd }).catch(() => {}); };
  }, [isGitRepo, workspaceCwd, workspaceId]);

  useEffect(() => {
    if (!isGitRepo) return;
    const u = listen<LiveDiffFile[]>("git:live-diff", ({ payload }) => {
      applyFiles(payload);
      loadConflicts();
    });
    return () => { u.then(f => f()); };
  }, [isGitRepo, applyFiles, loadConflicts]);

  // ── Git actions ───────────────────────────────────────────────────────────────
  const commit = useCallback(async (message: string) => {
    const result = await invoke<string>("git_stage_and_commit", {
      cwd: workspaceCwd, runboxId: workspaceId, message,
    });
    showNotice(result, true);
    loadFiles(); loadCommits();
  }, [workspaceCwd, workspaceId, showNotice, loadFiles, loadCommits]);

  const switchBranch = useCallback(async (branch: string) => {
    await invoke("git_checkout", { cwd: workspaceCwd, branch });
    showNotice(`→ ${branch}`, true);
    loadFiles(); loadCommits(); loadBranches();
  }, [workspaceCwd, showNotice, loadFiles, loadCommits, loadBranches]);

  const createBranch = useCallback(async (branch: string) => {
    await invoke("git_checkout", { cwd: workspaceCwd, branch });
    showNotice(`Created & switched to ${branch}`, true);
    loadFiles(); loadCommits(); loadBranches();
  }, [workspaceCwd, showNotice, loadFiles, loadCommits, loadBranches]);

  const renameBranch = useCallback(async (oldName: string, newName: string) => {
    await invoke("git_rename_branch", { cwd: workspaceCwd, oldName, newName });
    showNotice(`Renamed to ${newName}`, true);
    loadBranches();
  }, [workspaceCwd, showNotice, loadBranches]);

  // ── Agent branch operations ───────────────────────────────────────────────────

  const mergeBranch = useCallback(async (branch: string) => {
    const result = await invoke<string>("git_merge_branch", { cwd: workspaceCwd, branch });
    showNotice(`Merged ${branch.split("/").pop()}`, true);
    loadAgentBranches(); loadCommits(); loadFiles();
    return result;
  }, [workspaceCwd, showNotice, loadAgentBranches, loadCommits, loadFiles]);

  const deleteBranch = useCallback(async (branch: string, force = false) => {
    await invoke("git_delete_branch", { cwd: workspaceCwd, branch, force });
    showNotice(`Deleted ${branch.split("/").pop()}`, true);
    loadAgentBranches(); loadBranches();
  }, [workspaceCwd, showNotice, loadAgentBranches, loadBranches]);

  const branchLog = useCallback((branch: string, base?: string): Promise<GC[]> => {
    return invoke<GC[]>("git_branch_log", { cwd: workspaceCwd, branch, base });
  }, [workspaceCwd]);

  const branchStatus = useCallback((branch: string, base?: string): Promise<BranchStatus> => {
    return invoke<BranchStatus>("git_branch_status", { cwd: workspaceCwd, branch, base });
  }, [workspaceCwd]);

  // ── Per-file staging ──────────────────────────────────────────────────────────

  const stageFile = useCallback(async (path: string) => {
    await invoke("git_stage_file", { cwd: workspaceCwd, runboxId: workspaceId, path });
    loadFiles();
  }, [workspaceCwd, workspaceId, loadFiles]);

  const unstageFile = useCallback(async (path: string) => {
    await invoke("git_unstage_file", { cwd: workspaceCwd, runboxId: workspaceId, path });
    loadFiles();
  }, [workspaceCwd, workspaceId, loadFiles]);

  const discardFile = useCallback(async (path: string) => {
    await invoke("git_discard_file", { cwd: workspaceCwd, runboxId: workspaceId, path });
    loadFiles();
  }, [workspaceCwd, workspaceId, loadFiles]);

  const commitDiff = useCallback((hash: string) => {
    return invoke<string>("git_diff_for_commit", { cwd: workspaceCwd, runboxId: workspaceId, hash });
  }, [workspaceCwd, workspaceId]);

  const createWorktree = useCallback(async (wtName: string, newBranch: string) => {
    const bn = newBranch || wtName;
    await invoke<string>("git_worktree_create", { cwd: workspaceCwd, branch: bn, wtName });
    showNotice(`Created on ${bn}`, true);
    loadWorktrees(); loadBranches();
  }, [workspaceCwd, showNotice, loadWorktrees, loadBranches]);

  const diffWorktrees = useCallback(async (wtPath: string) => {
    return invoke<string>("git_diff_between_worktrees", { cwd: workspaceCwd, otherCwd: wtPath });
  }, [workspaceCwd]);

  return {
    isGitRepo, setIsGitRepo,
    files, commits, worktrees, conflicts, allBranches,
    agentSpans, agentBranches,
    notice, showNotice,
    commit,
    switchBranch, createBranch, renameBranch,
    mergeBranch, deleteBranch, branchLog, branchStatus,
    createWorktree, diffWorktrees,
    stageFile, unstageFile, discardFile,
    commitDiff,
    loadAll, loadAgentBranches, loadFiles, loadCommits, loadBranches,
  };
}