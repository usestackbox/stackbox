export interface Runbox {
  id:   string;
  name: string;
  cwd:  string;
}

export interface WorkspaceEvent {
  id:           string;
  runbox_id:    string;
  session_id:   string;
  event_type:   "AgentSpawned" | "CommandExecuted" | "CommandResult" | "FileChanged" | "WorkspaceSnapshot";
  source:       string;
  payload_json: string;
  timestamp:    number;
}

export interface DiffTab {
  id:         string;
  path:       string;
  diff:       string;
  changeType: string;
  insertions: number;
  deletions:  number;
  openedAt:   number;
}

export type SplitDir = "h" | "v";
export interface TermNode  { type: "leaf";  id: string; }
export interface SplitNode { type: "split"; dir: SplitDir; a: PaneNode; b: PaneNode; }
export type PaneNode = TermNode | SplitNode;