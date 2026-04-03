import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { LiveDiffFile, GitCommit, WorktreeEntry, ConflictFile } from "./types";

export function useGitPanel(workspaceCwd: string, workspaceId: string) {
  const [isGitRepo,   setIsGitRepo]   = useState<boolean | null>(null);
  const [files,       setFiles]       = useState<LiveDiffFile[]>([]);
  const [commits,     setCommits]     = useState<GitCommit[]>([]);
  const [worktrees,   setWorktrees]   = useState<WorktreeEntry[]>([]);
  const [conflicts,   setConflicts]   = useState<ConflictFile[]>([]);
  const [allBranches, setAllBranches] = useState<string[]>([]);
  const [notice,      setNotice]      = useState<{ text: string; ok: boolean } | null>(null);

  const showNotice = useCallback((text: string, ok: boolean) => {
    setNotice({ text, ok });
    setTimeout(() => setNotice(null), 3000);
  }, []);

  // Detect git repo
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

  const loadFiles = useCallback(() => {
    invoke<LiveDiffFile[]>("git_diff_live", { cwd: workspaceCwd, runboxId: workspaceId })
      .then(f => setFiles(f.sort((a, b) => (b.modified_at || 0) - (a.modified_at || 0))))
      .catch(() => {});
  }, [workspaceCwd, workspaceId]);

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

  const loadAll = useCallback(() => {
    loadFiles(); loadCommits(); loadWorktrees(); loadConflicts(); loadBranches();
  }, [loadFiles, loadCommits, loadWorktrees, loadConflicts, loadBranches]);

  useEffect(() => {
    if (!isGitRepo) return;
    loadAll();
  }, [isGitRepo, loadAll]);

  useEffect(() => {
    if (!isGitRepo) return;
    invoke("git_watch_start", { cwd: workspaceCwd, runboxId: workspaceId }).catch(() => {});
    return () => { invoke("git_watch_stop", { cwd: workspaceCwd }).catch(() => {}); };
  }, [isGitRepo, workspaceCwd, workspaceId]);

  useEffect(() => {
    if (!isGitRepo) return;
    const u = listen<LiveDiffFile[]>("git:live-diff", ({ payload }) => {
      setFiles(payload.sort((a, b) => (b.modified_at || 0) - (a.modified_at || 0)));
      loadConflicts();
    });
    return () => { u.then(f => f()); };
  }, [isGitRepo, loadConflicts]);

  const commit = useCallback(async (message: string) => {
    const result = await invoke<string>("git_stage_and_commit", {
      cwd: workspaceCwd, runboxId: workspaceId, message,
    });
    showNotice(result, true);
    loadFiles(); loadCommits();
  }, [workspaceCwd, workspaceId, showNotice, loadFiles, loadCommits]);

  const push = useCallback(async () => {
    const result = await invoke<string>("git_push", { cwd: workspaceCwd, runboxId: workspaceId });
    showNotice(result || "Pushed.", true);
  }, [workspaceCwd, workspaceId, showNotice]);

  const switchBranch = useCallback(async (branch: string) => {
    await invoke("git_checkout", { cwd: workspaceCwd, branch });
    showNotice(`→ ${branch}`, true);
    loadFiles(); loadCommits(); loadBranches();
  }, [workspaceCwd, showNotice, loadFiles, loadCommits, loadBranches]);

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
    notice, showNotice,
    commit, push, switchBranch, createWorktree, diffWorktrees,
    loadAll,
  };
}