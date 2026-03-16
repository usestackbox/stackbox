
export interface Runbox {
  id:   string;
  name: string;
  cwd:  string;
}

export interface BusMessage {
  id:             string;
  from:           string;
  topic:          string;
  payload:        string;
  timestamp:      number;
  correlation_id: string | null;
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

export interface SubAgent {
  sessionId:     string;
  parentSession: string;
  task:          string;
  status:        "running" | "done" | "failed";
  startedAt:     number;
  endedAt?:      number;
  outputLines:   string[];
  expanded:      boolean;
}

export type SplitDir = "h" | "v";
export interface TermNode  { type: "leaf";  id: string; }
export interface SplitNode { type: "split"; dir: SplitDir; a: PaneNode; b: PaneNode; }
export type PaneNode = TermNode | SplitNode;