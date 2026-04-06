export interface LiveDiffFile {
  path:        string;
  change_type: "created" | "modified" | "deleted";
  diff:        string;
  insertions:  number;
  deletions:   number;
  modified_at: number;
}

export interface GitCommit {
  hash:       string;
  short_hash: string;
  message:    string;
  date:       string;
  author:     string;
}

export interface WorktreeEntry {
  path:      string;
  branch:    string;
  head:      string;
  is_main:   boolean;
  is_bare:   boolean;
  is_locked: boolean;
}

export interface ConflictFile {
  path:   string;
  status: string;
}

/** Mirrors db::branches::AgentBranch on the Rust side */
export interface AgentBranch {
  id:            string;
  runbox_id:     string;
  session_id:    string;
  agent_kind:    string;
  /** e.g. "stackbox/a1b2c3d4/codex" */
  branch:        string;
  /** null once PTY exits; branch still alive */
  worktree_path: string | null;
  /** working | done | merged | deleted */
  status:        "working" | "done" | "merged" | "deleted";
  commit_count:  number;
  created_at:    number;
  updated_at:    number;
  merged_at:     number | null;
}

export interface BranchStatus {
  ahead:         number;
  behind:        number;
  has_conflicts: boolean;
}

/** Attribution of a file change to a specific agent */
export interface AgentSpan {
  agent:     string;
  startedAt: number;
}

export type GitTab = "changes" | "source" | "worktrees";

export interface GitPanelProps {
  workspaceCwd: string;
  workspaceId:  string;
  branch:       string;
  onClose:      () => void;
  onFileClick?: (fc: LiveDiffFile) => void;
}