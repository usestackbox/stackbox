// render/features/git/useGitPanel.ts

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { gitDiffLive } from "../../lib/git";
import type { AgentSpan, BranchDiffFile, ConflictFile, LiveDiffFile, WorktreeEntry } from "./types";

// ── File filter ───────────────────────────────────────────────────────────────

const BLOCKED_NAMES = new Set([
  ".calus-context.md", "claude.md", "agents.md", "gemini.md", "opencode.md",
]);
const BLOCKED_PREFIXES = [
  ".claude/", ".gemini/", ".codex/", ".cursor/", ".agents/",
  ".opencode/", ".github/skills/", ".github/copilot",
];
function isTempFile(n: string) {
  return /^(rewrite_|update_|patch_|fix_|temp_|tmp_).*\.(py|js|sh|ps1)$/.test(n);
}
function shouldBlock(path: string) {
  const norm = path.replace(/\\/g, "/").toLowerCase();
  const name = norm.split("/").pop() ?? "";
  return BLOCKED_NAMES.has(name) || isTempFile(name) || BLOCKED_PREFIXES.some((p) => norm.startsWith(p));
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
  for (const s of spans) { if (s.startedAt <= modifiedAt + 2000) match = s; }
  return match ? shortAgent(match.agent) : null;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useGitPanel(workspaceCwd: string, workspaceId: string) {
  const [isGitRepo, setIsGitRepo]     = useState<boolean | null>(null);
  const [files, setFiles]             = useState<LiveDiffFile[]>([]);
  const [conflicts, setConflicts]     = useState<ConflictFile[]>([]);
  const [agentSpans, setAgentSpans]   = useState<AgentSpan[]>([]);
  const [allBranches, setAllBranches] = useState<string[]>([]);
  const [worktrees, setWorktrees]     = useState<WorktreeEntry[]>([]);
  const [notice, setNotice]           = useState<{ text: string; ok: boolean } | null>(null);
  const [detectTick, setDetectTick]   = useState(0);

  const confirmedRepo   = useRef(false);
  const emptyFilesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const PORT = (window as any).__CALUS_PORT__ ?? 7700;

  const showNotice = useCallback((text: string, ok: boolean) => {
    setNotice({ text, ok });
    setTimeout(() => setNotice(null), 3500);
  }, []);

  // ── Detect git repo ───────────────────────────────────────────────────────
  // Tries three methods in order; only marks false if all three fail.
  useEffect(() => {
    if (!workspaceCwd) { setIsGitRepo(true); return; }
    if (!confirmedRepo.current) setIsGitRepo(null);

    let cancelled = false;

    const tryConfirm = () => {
      confirmedRepo.current = true;
      if (!cancelled) setIsGitRepo(true);
    };

    const detect = async () => {
      try {
        // 1. Dedicated is-repo check
        const isRepo = await invoke<boolean>("git_is_repo", { cwd: workspaceCwd })
          .catch(() => false);
        if (cancelled) return;
        if (isRepo) { tryConfirm(); return; }

        // 2. Try reading current branch
        const b = await invoke<string>("git_current_branch", { cwd: workspaceCwd })
          .catch(() => "");
        if (cancelled) return;
        if (b.trim().length > 0) { tryConfirm(); return; }

        // 3. Last resort: git rev-parse
        const rev = await invoke<string>("git_run", {
          cwd: workspaceCwd,
          args: ["rev-parse", "--git-dir"],
        }).catch(() => "");
        if (cancelled) return;
        if (rev.trim().length > 0) { tryConfirm(); return; }

        confirmedRepo.current = false;
        setIsGitRepo(false);
      } catch {
        if (!cancelled) setIsGitRepo(false);
      }
    };

    detect();
    return () => { cancelled = true; };
  }, [workspaceCwd, workspaceId, detectTick]);

  const prevWorkspaceId = useRef(workspaceId);
  useEffect(() => {
    if (prevWorkspaceId.current !== workspaceId) {
      confirmedRepo.current = false;
      prevWorkspaceId.current = workspaceId;
    }
  }, [workspaceId]);

  // ── Load agent spans ──────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`http://localhost:${PORT}/events?runbox_id=${workspaceId}&event_type=AgentSpawned&limit=50`)
      .then((r) => r.json())
      .then((rows: any[]) =>
        setAgentSpans(
          rows.map((r) => {
            try { const p = JSON.parse(r.payload_json); return { agent: p.agent ?? "", startedAt: r.timestamp }; }
            catch { return null; }
          })
          .filter((s): s is AgentSpan => !!s && s.agent !== "Shell")
          .sort((a, b) => a.startedAt - b.startedAt)
        )
      ).catch(() => {});
  }, [workspaceId, PORT]);

  // ── Load helpers ──────────────────────────────────────────────────────────
  const applyFiles = useCallback((raw: LiveDiffFile[]) => {
    const deduped = new Map<string, LiveDiffFile>();
    for (const f of raw) deduped.set(f.path, f);
    const filtered = Array.from(deduped.values())
      .filter((f) => !shouldBlock(f.path))
      .sort((a, b) => (b.modified_at || 0) - (a.modified_at || 0));

    if (emptyFilesTimer.current) { clearTimeout(emptyFilesTimer.current); emptyFilesTimer.current = null; }
    if (filtered.length === 0) {
      emptyFilesTimer.current = setTimeout(() => { setFiles([]); emptyFilesTimer.current = null; }, 400);
    } else { setFiles(filtered); }
  }, []);

  const loadFiles = useCallback(() => {
    // Auto-stage everything silently so changes always appear
    invoke("git_run", { cwd: workspaceCwd, args: ["add", "."] })
      .catch(() => {})
      .finally(() => {
        gitDiffLive(workspaceCwd).then(applyFiles).catch(() => {});
      });
  }, [workspaceCwd, applyFiles]);

  const loadConflicts = useCallback(() => {
    invoke<ConflictFile[]>("git_conflicts", { cwd: workspaceCwd }).then(setConflicts).catch(() => setConflicts([]));
  }, [workspaceCwd]);

  const loadBranches = useCallback(() => {
    invoke<string[]>("git_branches", { cwd: workspaceCwd }).then(setAllBranches).catch(() => {});
  }, [workspaceCwd]);

  const loadWorktrees = useCallback(() => {
    invoke<WorktreeEntry[]>("git_worktree_list", { cwd: workspaceCwd }).then(setWorktrees).catch(() => {});
  }, [workspaceCwd]);

  const loadAll = useCallback(() => {
    loadFiles(); loadConflicts(); loadBranches(); loadWorktrees();
  }, [loadFiles, loadConflicts, loadBranches, loadWorktrees]);

  useEffect(() => { if (!isGitRepo) return; loadAll(); }, [isGitRepo, loadAll]);

  // Auto-refresh branches silently in background
  useEffect(() => {
    if (!isGitRepo) return;
    const id = setInterval(loadBranches, 10_000);
    return () => clearInterval(id);
  }, [isGitRepo, loadBranches]);

  // ── Git watcher ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isGitRepo) return;
    invoke("git_watch_start", { cwd: workspaceCwd, runboxId: workspaceId }).catch(() => {});
    return () => { invoke("git_watch_stop", { cwd: workspaceCwd }).catch(() => {}); };
  }, [isGitRepo, workspaceCwd, workspaceId]);

  // Re-register watcher when backend restarts (hot reload / crash recovery).
  // Backend emits "backend-ready" on every startup — WATCHERS map is empty then
  // so every open workspace tab must re-call git_watch_start.
  useEffect(() => {
    if (!isGitRepo) return;
    const u = listen<void>("backend-ready", () => {
      invoke("git_watch_start", { cwd: workspaceCwd, runboxId: workspaceId }).catch(() => {});
      loadAll();
    });
    return () => { u.then((f) => f()); };
  }, [isGitRepo, workspaceCwd, workspaceId, loadAll]);

  useEffect(() => {
    if (!isGitRepo) return;
    const u = listen<unknown>("git:live-diff", () => { loadFiles(); loadConflicts(); });
    return () => { u.then((f) => f()); };
  }, [isGitRepo, loadFiles, loadConflicts]);

  // ── Git actions ───────────────────────────────────────────────────────────
  const commit = useCallback(async (message: string) => {
    const result = await invoke<string>("git_stage_and_commit", {
      cwd: workspaceCwd, runboxId: workspaceId, message,
    });
    showNotice(result, true);
    loadFiles();
  }, [workspaceCwd, workspaceId, showNotice, loadFiles]);

  const switchBranch = useCallback(async (branch: string) => {
    await invoke("git_checkout", { cwd: workspaceCwd, branch });
    showNotice(`→ ${branch}`, true);
    loadFiles(); loadBranches();
  }, [workspaceCwd, showNotice, loadFiles, loadBranches]);

  const stageFile = useCallback(async (path: string) => {
    await invoke("git_stage_file", { cwd: workspaceCwd, runboxId: workspaceId, path }); loadFiles();
  }, [workspaceCwd, workspaceId, loadFiles]);

  const unstageFile = useCallback(async (path: string) => {
    await invoke("git_unstage_file", { cwd: workspaceCwd, runboxId: workspaceId, path }); loadFiles();
  }, [workspaceCwd, workspaceId, loadFiles]);

  const discardFile = useCallback(async (path: string) => {
    await invoke("git_discard_file", { cwd: workspaceCwd, runboxId: workspaceId, path }); loadFiles();
  }, [workspaceCwd, workspaceId, loadFiles]);

  // ── Branch diff ───────────────────────────────────────────────────────────
  // Diffs `branch` against `base` (defaults to current checked-out branch).
  // Passing currentBranch as base ensures we always diff against what's
  // actually checked out, not a hardcoded "main".
  const branchDiff = useCallback(async (branch: string, base?: string): Promise<BranchDiffFile[]> => {
    return invoke<BranchDiffFile[]>("git_diff_branch", {
      cwd: workspaceCwd,
      branch,
      base: base ?? null,
    });
  }, [workspaceCwd]);

  return {
    isGitRepo, setIsGitRepo,
    files, conflicts, agentSpans,
    allBranches, worktrees,
    notice, showNotice,
    commit, switchBranch,
    stageFile, unstageFile, discardFile,
    branchDiff,
    redetect: () => { confirmedRepo.current = false; setDetectTick(t => t + 1); },
    loadAll, loadFiles,
  };
}