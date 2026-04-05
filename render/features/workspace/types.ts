// features/workspace/types.ts
// Local types used only within the workspace feature.

export interface WinState {
  id:        string;
  label:     string;
  kind:      "terminal" | "browser";
  x:         number;
  y:         number;
  w:         number;
  h:         number;
  minimized: boolean;
  maximized: boolean;
  preMaxX?:  number;
  preMaxY?:  number;
  preMaxW?:  number;
  preMaxH?:  number;
  cwd:       string;
  zIndex:    number;
  /** Agent command to run in this pane (e.g. "claude", "gemini"). Undefined = plain shell. */
  agentCmd?: string;
}

export interface FileTab {
  id:       string;
  filePath: string;
}

export type SidePanel = "files" | "git" | "memory" | null;
export type FilesView = "list" | "diff";

export const GAP   = 0;
export const MIN_W = 280;
export const MIN_H = 180;

let _topZ = 10;
export const nextZ = () => ++_topZ;

export function tileWindows(count: number, aw: number, ah: number) {
  if (count === 0) return [];
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const w    = Math.floor((aw - GAP * (cols + 1)) / cols);
  const h    = Math.floor((ah - GAP * (rows + 1)) / rows);
  return Array.from({ length: count }, (_, i) => ({
    x: GAP + (i % cols) * (w + GAP),
    y: GAP + Math.floor(i / cols) * (h + GAP),
    w, h,
  }));
}

export function winLabel(win: WinState): string {
  if (win.kind === "browser") return win.label ?? "browser";
  return win.cwd.split(/[/\\]/).filter(Boolean).pop() ?? "~";
}