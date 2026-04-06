// render/features/palette/paletteActions.ts
// Central registry of every action that appears in the command palette.
// Actions can be static or dynamically generated (e.g. per workspace).

export type ActionId = string;

export interface PaletteAction {
  id:          ActionId;
  label:       string;
  description?: string;
  icon?:        string;       // emoji or short glyph
  shortcut?:    string;       // e.g. "mod+shift+p"
  category:    "workspace" | "git" | "file" | "settings" | "nav" | "tools";
  handler:     () => void | Promise<void>;
  /** Keywords beyond label that fuzzy-match should consider. */
  keywords?:   string[];
  /** Hidden from list but still searchable. */
  hidden?:     boolean;
}

// The registry is populated at runtime — features push actions via
// registerActions() and clean up via the returned disposer.
const registry = new Map<ActionId, PaletteAction>();
const listeners = new Set<() => void>();

export function registerActions(actions: PaletteAction[]): () => void {
  for (const a of actions) registry.set(a.id, a);
  listeners.forEach((fn) => fn());
  return () => {
    for (const a of actions) registry.delete(a.id);
    listeners.forEach((fn) => fn());
  };
}

export function subscribeActions(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getActions(): PaletteAction[] {
  return Array.from(registry.values()).filter((a) => !a.hidden);
}

// ── Built-in actions ─────────────────────────────────────────────────────────
// Registered on module load; features add more via registerActions().

registerActions([
  {
    id:       "settings.open",
    label:    "Open Settings",
    icon:     "⚙️",
    shortcut: "mod+,",
    category: "settings",
    keywords: ["preferences", "config"],
    handler:  () => {
      // Settings modal is opened via a global event so we don't need a direct ref.
      window.dispatchEvent(new CustomEvent("sb:open-settings"));
    },
  },
  {
    id:       "settings.general",
    label:    "Settings: General",
    icon:     "⚙️",
    category: "settings",
    handler:  () => {
      window.dispatchEvent(new CustomEvent("sb:open-settings", { detail: { tab: "general" } }));
    },
  },
  {
    id:       "settings.appearance",
    label:    "Settings: Appearance",
    icon:     "🎨",
    category: "settings",
    keywords: ["theme", "font", "colors"],
    handler:  () => {
      window.dispatchEvent(new CustomEvent("sb:open-settings", { detail: { tab: "appearance" } }));
    },
  },
  {
    id:       "settings.keybinds",
    label:    "Settings: Keyboard Shortcuts",
    icon:     "⌨️",
    category: "settings",
    keywords: ["keybinds", "hotkeys", "shortcuts"],
    handler:  () => {
      window.dispatchEvent(new CustomEvent("sb:open-settings", { detail: { tab: "keybinds" } }));
    },
  },
  {
    id:       "settings.mcp",
    label:    "Settings: MCP Servers",
    icon:     "🔌",
    category: "settings",
    keywords: ["mcp", "servers", "tools"],
    handler:  () => {
      window.dispatchEvent(new CustomEvent("sb:open-settings", { detail: { tab: "mcp" } }));
    },
  },
  {
    id:       "settings.updates",
    label:    "Check for Updates",
    icon:     "⬆️",
    category: "settings",
    keywords: ["update", "upgrade", "version"],
    handler:  () => {
      window.dispatchEvent(new CustomEvent("sb:check-updates"));
    },
  },
  {
    id:       "git.commit",
    label:    "Git: Commit Staged Changes",
    icon:     "✓",
    category: "git",
    keywords: ["commit", "save", "snapshot"],
    handler:  () => window.dispatchEvent(new CustomEvent("sb:git-commit")),
  },
  {
    id:       "git.pull",
    label:    "Git: Pull",
    icon:     "⬇",
    category: "git",
    handler:  () => window.dispatchEvent(new CustomEvent("sb:git-pull")),
  },
  {
    id:       "git.push",
    label:    "Git: Push",
    icon:     "⬆",
    category: "git",
    handler:  () => window.dispatchEvent(new CustomEvent("sb:git-push")),
  },
  {
    id:       "workspace.new",
    label:    "New Workspace",
    icon:     "＋",
    category: "workspace",
    shortcut: "mod+n",
    handler:  () => window.dispatchEvent(new CustomEvent("sb:new-workspace")),
  },
  {
    id:       "terminal.new",
    label:    "New Terminal",
    icon:     ">_",
    category: "tools",
    shortcut: "mod+`",
    handler:  () => window.dispatchEvent(new CustomEvent("sb:new-terminal")),
  },
  {
    id:       "file.search",
    label:    "Search Files",
    icon:     "🔍",
    category: "file",
    shortcut: "mod+shift+f",
    keywords: ["find", "grep", "search"],
    handler:  () => window.dispatchEvent(new CustomEvent("sb:focus-file-search")),
  },
]);
