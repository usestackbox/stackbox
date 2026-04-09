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
    keywords: ["create", "runbox", "new"],
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
    shortcut: "tab+shift+→",
    category: "terminal",
    keywords: ["focus", "switch", "tab", "next"],
    handler: emit("sb:next-terminal"),
  },
  {
    id: "terminal.prev",
    label: "Previous Terminal",
    icon: "←",
    shortcut: "tab+shift+←",
    category: "terminal",
    keywords: ["focus", "switch", "tab", "prev", "back"],
    handler: emit("sb:prev-terminal"),
  },
  {
    id: "terminal.split_right",
    label: "Split Terminal Right",
    icon: "⊞",
    shortcut: "mod+d",
    category: "terminal",
    keywords: ["split", "vertical", "pane", "right"],
    handler: emit("sb:split-right"),
  },
  {
    id: "terminal.split_down",
    label: "Split Terminal Down",
    icon: "⊟",
    shortcut: "mod+s",
    category: "terminal",
    keywords: ["split", "horizontal", "pane", "down"],
    handler: emit("sb:split-down"),
  },
  {
    id: "terminal.minimize",
    label: "Minimize Pane",
    icon: "⬇",
    shortcut: "mod+m",
    category: "terminal",
    keywords: ["minimize", "hide", "pane"],
    handler: emit("sb:minimize-terminal"),
  },
  {
    id: "terminal.maximize",
    label: "Maximize Pane",
    icon: "⬆",
    shortcut: "mod+enter",
    category: "terminal",
    keywords: ["maximize", "fullscreen", "pane", "expand"],
    handler: emit("sb:maximize-terminal"),
  },

  // ── Pane focus navigation: mod+arrows ─────────────────────────────────────
  {
    id: "terminal.focus_up",
    label: "Focus Pane Above",
    icon: "↑",
    shortcut: "mod+↑",
    category: "terminal",
    keywords: ["pane", "focus", "navigate", "up"],
    handler: emit("sb:focus-pane-up"),
  },
  {
    id: "terminal.focus_down",
    label: "Focus Pane Below",
    icon: "↓",
    shortcut: "mod+↓",
    category: "terminal",
    keywords: ["pane", "focus", "navigate", "down"],
    handler: emit("sb:focus-pane-down"),
  },
  {
    id: "terminal.focus_left",
    label: "Focus Pane Left",
    icon: "←",
    shortcut: "mod+←",
    category: "terminal",
    keywords: ["pane", "focus", "navigate", "left"],
    handler: emit("sb:focus-pane-left"),
  },
  {
    id: "terminal.focus_right",
    label: "Focus Pane Right",
    icon: "→",
    shortcut: "mod+→",
    category: "terminal",
    keywords: ["pane", "focus", "navigate", "right"],
    handler: emit("sb:focus-pane-right"),
  },

  // ── Files ─────────────────────────────────────────────────────────────────
  {
    id: "file.search",
    label: "Search Files",
    icon: "🔍",
    shortcut: "mod+f",
    category: "file",
    keywords: ["find", "grep", "search"],
    handler: emit("sb:file-search-focus"),
  },
]);