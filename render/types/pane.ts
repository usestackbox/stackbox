// types/pane.ts
export type SplitDir = "h" | "v";

export interface TermNode {
  type: "leaf";
  id: string;
}
export interface SplitNode {
  type: "split";
  dir: SplitDir;
  a: PaneNode;
  b: PaneNode;
}
export type PaneNode = TermNode | SplitNode;
