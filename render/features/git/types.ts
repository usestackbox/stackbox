// render/features/git/types.ts

export interface LiveDiffFile {
  path: string;
  change_type: "created" | "modified" | "deleted";
  diff: string;
  insertions: number;
  deletions: number;
  modified_at: number;
}

export interface GitCommit {
  hash: string;
  short_hash: string;
  message: string;
  date: string;
  author: string;
}

export interface WorktreeEntry {
  path: string;
  branch: string;
  head: string;
  is_main: boolean;
  is_bare: boolean;
  is_locked: boolean;
}

export interface ConflictFile {
  path: string;
  status: string;
}

/** Per-file diff between main and a calus/* branch */
export interface BranchDiffFile {
  path: string;
  /** "added" | "modified" | "deleted" | "renamed" */
  change_type: string;
  insertions: number;
  deletions: number;
  /** Full unified diff text */
  diff: string;
}

/** Mirrors db::branches::AgentBranch on the Rust side */
export interface AgentBranch {
  id: string;
  runbox_id: string;
  session_id: string;
  agent_kind: string;
  /** e.g. "calus/claude/fix-null-crash" */
  branch: string;
  /** null once PTY exits; branch still alive */
  worktree_path: string | null;
  /** working | done | merged | deleted */
  status: "working" | "done" | "merged" | "deleted";
  commit_count: number;
  created_at: number;
  updated_at: number;
  merged_at: number | null;
}

export interface BranchStatus {
  ahead: number;
  behind: number;
  has_conflicts: boolean;
}

export interface AgentSpan {
  agent: string;
  startedAt: number;
}

// ── GitHub / PR types ─────────────────────────────────────────────────────────

export interface PrReview {
  author: string;
  state: string;
}

export interface PrCheck {
  name: string;
  status: string;
  conclusion: string | null;
}

export interface PrDetails {
  title: string;
  state: string;
  author: string;
  url: string;
  body: string;
  mergeable: string;
  reviews: PrReview[];
  checks: PrCheck[];
}

export interface WorktreeRecord {
  branch: string;
  worktree_path: string | null;
  pr_url: string | null;
  pr_number: number | null;
}

// ── Panel types ───────────────────────────────────────────────────────────────

export type GitTab = "changes" | "branches" | "worktrees";

export interface GitPanelProps {
  workspaceCwd: string;
  workspaceId: string;
  branch: string;
  onClose: () => void;
  onFileClick?: (fc: LiveDiffFile) => void;
}
