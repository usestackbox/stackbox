import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  LiveDiffFile, GitCommit, WorktreeEntry,
  ConflictFile, WorktreeRecord, AgentSpan,
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
  const [isGitRepo,      setIsGitRepo]      = useState<boolean | null>(null);
  const [files,          setFiles]          = useState<LiveDiffFile[]>([]);
  const [commits,        setCommits]        = useState<GitCommit[]>([]);
  const [worktrees,      setWorktrees]      = useState<WorktreeEntry[]>([]);
  const [conflicts,      setConflicts]      = useState<ConflictFile[]>([]);
  const [allBranches,    setAllBranches]    = useState<string[]>([]);
  const [agentSpans,     setAgentSpans]     = useState<AgentSpan[]>([]);
  const [worktreeRecord, setWorktreeRecord] = useState<WorktreeRecord | null>(null);
  const [notice,         setNotice]         = useState<{ text: string; ok: boolean } | null>(null);
  const [creatingPr,     setCreatingPr]     = useState(false);

  const PORT = (window as any).__STACKBOX_PORT__ ?? 7700;
  const recordPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const showNotice = useCallback((text: string, ok: boolean) => {
    setNotice({ text, ok });
    setTimeout(() => setNotice(null), 3500);
  }, []);

  // ── Detect git repo ──────────────────────────────────────────────────────────
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

  // ── Load agent spans ─────────────────────────────────────────────────────────
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

  // ── Load helpers ─────────────────────────────────────────────────────────────
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

  const loadWorktreeRecord = useCallback(() => {
    invoke<WorktreeRecord | null>("get_worktree_record", { runboxId: workspaceId })
      .then(r => setWorktreeRecord(r ?? null)).catch(() => {});
  }, [workspaceId]);

  const loadAll = useCallback(() => {
    loadFiles(); loadCommits(); loadWorktrees(); loadConflicts(); loadBranches(); loadWorktreeRecord();
  }, [loadFiles, loadCommits, loadWorktrees, loadConflicts, loadBranches, loadWorktreeRecord]);

  useEffect(() => {
    if (!isGitRepo) return;
    loadAll();
  }, [isGitRepo, loadAll]);

  // Poll worktree record every 8s so PR status stays live
  useEffect(() => {
    if (!isGitRepo) return;
    recordPollRef.current = setInterval(loadWorktreeRecord, 8000);
    return () => { if (recordPollRef.current) clearInterval(recordPollRef.current); };
  }, [isGitRepo, loadWorktreeRecord]);

  // ── Git watcher ──────────────────────────────────────────────────────────────
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

  // ── Git actions ──────────────────────────────────────────────────────────────
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

  const createPr = useCallback(async (title: string, body: string) => {
    setCreatingPr(true);
    try {
      const result = await invoke<{ pr_url: string; url: string }>("git_push_pr", {
        cwd: workspaceCwd, runboxId: workspaceId, title, body,
      });
      showNotice("PR created!", true);
      loadWorktreeRecord();
      return result.pr_url;
    } finally {
      setCreatingPr(false);
    }
  }, [workspaceCwd, workspaceId, showNotice, loadWorktreeRecord]);

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

  const createWorktree = useCallback(async (wtName: string, newBranch: string) => {
    const bn = newBranch || wtName;
    await invoke<string>("git_worktree_create", { cwd: workspaceCwd, branch: bn, wtName });
    showNotice(`Created on ${bn}`, true);
    loadWorktrees(); loadBranches();
  }, [workspaceCwd, showNotice, loadWorktrees, loadBranches]);

  const diffWorktrees = useCallback(async (wtPath: string) => {
    return invoke<string>("git_diff_between_worktrees", { cwd: workspaceCwd, otherCwd: wtPath });
  }, [workspaceCwd]);

  // ── Per-file staging ─────────────────────────────────────────────────────────

  const stageFile = useCallback(async (path: string) => {
    await invoke("git_stage_file", { cwd: workspaceCwd, runboxId: workspaceId, path });
    loadFiles();
  }, [workspaceCwd, workspaceId, loadFiles]);

  const unstageFile = useCallback(async (path: string) => {
    await invoke("git_unstage_file", { cwd: workspaceCwd, runboxId: workspaceId, path });
    loadFiles();
  }, [workspaceCwd, workspaceId, loadFiles]);

  /** Discard working-tree changes for a single file.
   *  Requires git_discard_file kernel command (see commands_new.rs). */
  const discardFile = useCallback(async (path: string) => {
    await invoke("git_discard_file", { cwd: workspaceCwd, runboxId: workspaceId, path });
    loadFiles();
  }, [workspaceCwd, workspaceId, loadFiles]);

  /** Load raw diff text for a single commit (for HistoryTab expansion). */
  const commitDiff = useCallback((hash: string) => {
    return invoke<string>("git_diff_for_commit", { cwd: workspaceCwd, runboxId: workspaceId, hash });
  }, [workspaceCwd, workspaceId]);

  return {
    isGitRepo, setIsGitRepo,
    files, commits, worktrees, conflicts, allBranches,
    agentSpans,
    worktreeRecord, loadWorktreeRecord,
    creatingPr,
    notice, showNotice,
    commit, push, createPr,
    switchBranch, createBranch,
    createWorktree, diffWorktrees,
    stageFile, unstageFile, discardFile,
    commitDiff,
    loadAll,
  };
}