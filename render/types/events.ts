// types/events.ts
export interface WorkspaceEvent {
  id: string;
  runbox_id: string;
  session_id: string;
  event_type:
    | "AgentSpawned"
    | "CommandExecuted"
    | "CommandResult"
    | "FileChanged"
    | "WorkspaceSnapshot";
  source: string;
  payload_json: string;
  timestamp: number;
}

export interface DiffTab {
  id: string;
  path: string;
  diff: string;
  changeType: string;
  insertions: number;
  deletions: number;
  openedAt: number;
}

export interface LiveDiffFile {
  path: string;
  change_type: "created" | "modified" | "deleted";
  diff: string;
  insertions: number;
  deletions: number;
  modified_at: number;
}
