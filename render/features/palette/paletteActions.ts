// render/features/palette/paletteActions.ts

export type ActionId = string;

export interface PaletteAction {
  id: ActionId;
  label: string;
  description?: string;
  icon?: string;
  shortcut?: string;
  category: "workspace" | "terminal" | "file";
  handler: () => void | Promise<void>;
  keywords?: string[];
}

const registry = new Map<ActionId, PaletteAction>();
const listeners = new Set<() => void>();

export function registerActions(actions: PaletteAction[]): () => void {
  for (const a of actions) registry.set(a.id, a);
  listeners.forEach(fn => fn());
  return () => {
    for (const a of actions) registry.delete(a.id);
    listeners.forEach(fn => fn());
  };
}

export function subscribeActions(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getActions(): PaletteAction[] {
  return Array.from(registry.values());
}

const emit = (event: string) => () => {
  window.dispatchEvent(new CustomEvent(event));
};

registerActions([
  // ── Workspace ─────────────────────────────────────────────────────────────
  {
    id: "workspace.new",
    label: "New Workspace",
    icon: "＋",
    shortcut: "mod+n",
    category: "workspace",
    keywords: ["create", "runbox"],
    handler: emit("sb:new-workspace"),
  },

  // ── Terminal ──────────────────────────────────────────────────────────────
  {
    id: "terminal.new",
    label: "New Terminal",
    icon: ">_",
    shortcut: "mod+t",
    category: "terminal",
    keywords: ["shell", "tab", "open"],
    handler: emit("sb:new-terminal"),
  },
  {
    id: "terminal.close",
    label: "Close Terminal",
    icon: "✕",
    shortcut: "mod+w",
    category: "terminal",
    keywords: ["close", "tab"],
    handler: emit("sb:close-terminal"),
  },
  {
    id: "terminal.next",
    label: "Next Terminal",
    icon: "→",
    shortcut: "mod+shift+→",
    category: "terminal",
    keywords: ["focus", "switch", "tab", "next"],
    handler: emit("sb:next-terminal"),
  },
  {
    id: "terminal.prev",
    label: "Previous Terminal",
    icon: "←",
    shortcut: "mod+shift+←",
    category: "terminal",
    keywords: ["focus", "switch", "tab", "prev", "back"],
    handler: emit("sb:prev-terminal"),
  },
  {
    id: "terminal.split_down",
    label: "Split Terminal Down",
    icon: "⊟",
    shortcut: "mod+↓",
    category: "terminal",
    keywords: ["split", "horizontal", "pane"],
    handler: emit("sb:split-down"),
  },
  {
    id: "terminal.split_right",
    label: "Split Terminal Right",
    icon: "⊞",
    shortcut: "mod+→",
    category: "terminal",
    keywords: ["split", "vertical", "pane"],
    handler: emit("sb:split-right"),
  },

  // ── Files ─────────────────────────────────────────────────────────────────
  {
    id: "file.search",
    label: "Search Files",
    icon: "🔍",
    shortcut: "mod+f",
    category: "file",
    keywords: ["find", "grep", "search"],
    handler: emit("sb:focus-file-search"),
  },
]);