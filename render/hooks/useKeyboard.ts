// render/hooks/useKeyboard.ts
// Global keyboard shortcut registry.
// Usage:
//   useKeyboard({ "mod+k": () => openPalette() });
// "mod" resolves to Cmd on Mac, Ctrl on Windows/Linux.

import { useEffect, useRef } from "react";

type Handler = (e: KeyboardEvent) => void;

export type KeyMap = Record<string, Handler>;

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPod|iPad/.test(navigator.platform);

/** Normalise a key combo string into a canonical form. */
function normalise(combo: string): string {
  return combo
    .toLowerCase()
    .split("+")
    .map((k) => {
      if (k === "mod") return isMac ? "meta" : "ctrl";
      return k;
    })
    .sort() // sort so "shift+mod+k" === "mod+shift+k"
    .join("+");
}

/** Derive a canonical string from a KeyboardEvent. */
function eventKey(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("ctrl");
  if (e.altKey) parts.push("alt");
  if (e.metaKey) parts.push("meta");
  if (e.shiftKey) parts.push("shift");
  parts.push(e.key.toLowerCase());
  return parts.sort().join("+");
}

/**
 * Register keyboard shortcuts for the lifetime of the component.
 * Shortcuts are scoped to non-input elements unless `allowInInput` is set.
 */
export function useKeyboard(
  keymap: KeyMap,
  { allowInInput = false }: { allowInInput?: boolean } = {}
) {
  // Keep a ref so we don't need to re-register on every render.
  const mapRef = useRef<KeyMap>(keymap);
  useEffect(() => {
    mapRef.current = keymap;
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!allowInInput) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if ((e.target as HTMLElement)?.isContentEditable) return;
      }

      const combo = eventKey(e);
      for (const [raw, fn] of Object.entries(mapRef.current)) {
        if (normalise(raw) === combo) {
          e.preventDefault();
          fn(e);
          return;
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [allowInInput]);
}

/**
 * Format a shortcut combo for display (⌘K, Ctrl+K, etc.).
 */
export function fmtShortcut(combo: string): string {
  return combo
    .split("+")
    .map((k) => {
      switch (k.toLowerCase()) {
        case "mod":
          return isMac ? "⌘" : "Ctrl";
        case "shift":
          return isMac ? "⇧" : "Shift";
        case "alt":
          return isMac ? "⌥" : "Alt";
        case "ctrl":
          return isMac ? "⌃" : "Ctrl";
        case "meta":
          return "⌘";
        default:
          return k.toUpperCase();
      }
    })
    .join(isMac ? "" : "+");
}
