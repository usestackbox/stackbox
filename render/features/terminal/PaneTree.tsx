// features/terminal/PaneTree.tsx
import { PaneSplit } from "./PaneSplit";
import { PaneLeaf }  from "./PaneLeaf";
import type { PaneNode } from "../../types";

interface PaneTreeProps {
  node:          PaneNode;
  activePane:    string;
  onActivate:    (id: string) => void;
  onClose:       (id: string) => void;
  onSplitH:      (id: string) => void;
  onSplitV:      (id: string) => void;
  onSlotMount:   (id: string, el: HTMLDivElement) => void;
  onSlotUnmount: (id: string) => void;
  flex?:         number;
}

export function PaneTree({ node, flex = 1, ...rest }: PaneTreeProps) {
  if (node.type === "split") {
    return <PaneSplit node={node} flex={flex} {...rest} />;
  }
  return <PaneLeaf node={node} flex={flex} {...rest} />;
}