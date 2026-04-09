// features/terminal/paneUtils.ts
// Pure tree-mutation helpers for the pane split system.
// No React — safe to import anywhere.
import type { PaneNode, TermNode } from "../../types";

export const newLeaf = (): TermNode => ({ type: "leaf", id: crypto.randomUUID() });

/** Remove a leaf by id; collapses parent splits automatically. */
export function removeLeaf(node: PaneNode, id: string): PaneNode | null {
  if (node.type === "leaf") return node.id === id ? null : node;
  const a = removeLeaf(node.a, id);
  const b = removeLeaf(node.b, id);
  if (!a && !b) return null;
  if (!a) return b!;
  if (!b) return a;
  return { ...node, a, b };
}

/** Split a leaf in two, inserting `added` as the new sibling. */
export function splitLeaf(node: PaneNode, id: string, dir: "h" | "v", added: TermNode): PaneNode {
  if (node.type === "leaf") {
    return node.id !== id ? node : { type: "split", dir, a: node, b: added };
  }
  return {
    ...node,
    a: splitLeaf(node.a, id, dir, added),
    b: splitLeaf(node.b, id, dir, added),
  };
}

/** Flatten a tree into an ordered list of leaf ids. */
export function collectIds(node: PaneNode): string[] {
  if (node.type === "leaf") return [node.id];
  return [...collectIds(node.a), ...collectIds(node.b)];
}