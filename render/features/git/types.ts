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

export type GitTab = "changes" | "branches" | "history" | "worktrees";

export interface GitPanelProps {
  workspaceCwd: string;
  workspaceId:  string;
  branch:       string;
  onClose:      () => void;
  onFileClick?: (fc: LiveDiffFile) => void;
}