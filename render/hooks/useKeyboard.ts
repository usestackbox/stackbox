// render/hooks/useKeyboard.ts
// Global keyboard shortcut registry.
// Usage:
//   useKeyboard({ "mod+k": () => openPalette() });
// "mod" resolves to Cmd on Mac, Ctrl on Windows/Linux.
//
// ── WHY capture:true ────────────────────────────────────────────────────────
// xterm renders into a hidden <textarea class="xterm-helper-textarea">.  When
// that textarea is focused it calls stopPropagation() on every keydown, so a
// bubble-phase listener on window never sees any key presses while a terminal
// is active.  Registering in the capture phase (top-down) means we intercept
// before xterm gets the event, which is exactly what we want for global app
// shortcuts.  We still let normal <input>/<textarea> elements (palette search,
// modals, etc.) keep their keystrokes by bailing out early for those.
// ────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from "react";

type Handler = (e: KeyboardEvent) => void;

export type KeyMap = Record<string, Handler>;

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPod|iPad/.test(navigator.platform);

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
  if (e.ctrlKey)  parts.push("ctrl");
  if (e.altKey)   parts.push("alt");
  if (e.metaKey)  parts.push("meta");
  if (e.shiftKey) parts.push("shift");
  parts.push(e.key.toLowerCase());
  return parts.sort().join("+");
}

/**
 * Returns true when the event target is a "real" user-editable element that
 * should keep its own keystrokes (palette search input, modal fields, etc.).
 * xterm's hidden textarea is NOT in this category — we want to intercept
 * global shortcuts even while the terminal has focus.
 */
function isTypingTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;

  // xterm helper — allow global shortcuts through
  if (el.classList.contains("xterm-helper-textarea")) return false;

  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;

  return false;
}

/**
 * Register keyboard shortcuts for the lifetime of the component.
 * Uses capture phase so shortcuts fire before xterm swallows keydown events.
 */
export function useKeyboard(
  keymap: KeyMap,
  { allowInInput = false }: { allowInInput?: boolean } = {}
) {
  // Keep a ref so the listener closure always sees the latest handlers
  // without needing to re-register on every render.
  const mapRef = useRef<KeyMap>(keymap);
  useEffect(() => {
    mapRef.current = keymap;
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!allowInInput && isTypingTarget(e)) return;

      const combo = eventKey(e);
      for (const [raw, fn] of Object.entries(mapRef.current)) {
        if (normalise(raw) === combo) {
          e.preventDefault();
          e.stopPropagation(); // prevent xterm from also acting on the key
          fn(e);
          return;
        }
      }
    };

    // capture:true — fires BEFORE xterm's textarea keydown handler
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
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
        case "mod":   return isMac ? "⌘" : "Ctrl";
        case "shift": return isMac ? "⇧" : "Shift";
        case "alt":   return isMac ? "⌥" : "Alt";
        case "ctrl":  return isMac ? "⌃" : "Ctrl";
        case "meta":  return "⌘";
        default:      return k.toUpperCase();
      }
    })
    .join(isMac ? "" : "+");
}