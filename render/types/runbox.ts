// types/runbox.ts
export interface Runbox {
  id:        string;
  name:      string;
  cwd:       string;
  /** Optional default agent command for this workspace (e.g. "claude", "gemini"). */
  agentCmd?: string;
}

export interface RunboxSummary {
  id:   string;
  name: string;
}