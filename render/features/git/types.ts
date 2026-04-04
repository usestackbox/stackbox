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

/** Mirrors db::runboxes::WorktreeRecord on the Rust side */
export interface WorktreeRecord {
  runbox_id:     string;
  agent_kind:    string;
  worktree_path: string | null;
  branch:        string | null;
  pr_url:        string | null;
  /** working | pr_open | approved | changes_requested | merged | cancelled */
  status:        string;
  created_at:    number;
  updated_at:    number;
}

/** Attribution of a file change to a specific agent */
export interface AgentSpan {
  agent:     string;
  startedAt: number;
}

export type GitTab = "changes" | "branches" | "history" | "worktrees" | "github";

export interface GitPanelProps {
  workspaceCwd: string;
  workspaceId:  string;
  branch:       string;
  onClose:      () => void;
  onFileClick?: (fc: LiveDiffFile) => void;
}

// ── PR detail types (mirrors kernel PrDetails) ────────────────────────────────

export interface PrReview {
  author: string;
  state:  "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | string;
}

export interface PrCheck {
  name:       string;
  status:     "SUCCESS" | "FAILURE" | "PENDING" | "IN_PROGRESS" | "SKIPPED" | string;
  conclusion: string;
}

export interface PrDetails {
  title:      string;
  body:       string;
  number:     number;
  state:      "OPEN" | "MERGED" | "CLOSED" | string;
  url:        string;
  mergeable:  "MERGEABLE" | "CONFLICTING" | "UNKNOWN" | string;
  author:     string;
  created_at: string;
  reviews:    PrReview[];
  checks:     PrCheck[];
}