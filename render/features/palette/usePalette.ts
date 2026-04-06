// render/features/palette/usePalette.ts
// State machine for the command palette.

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  PaletteAction,
  getActions,
  subscribeActions,
} from "./paletteActions";
import { useKeyboard } from "../../hooks/useKeyboard";

/** Naive fuzzy match: every char of `needle` appears in `haystack` in order. */
function fuzzy(haystack: string, needle: string): boolean {
  if (!needle) return true;
  let hi = 0;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  for (let ni = 0; ni < n.length; ni++) {
    const idx = h.indexOf(n[ni], hi);
    if (idx === -1) return false;
    hi = idx + 1;
  }
  return true;
}

/** Score a result: exact label prefix > label match > keyword match. */
function score(action: PaletteAction, q: string): number {
  if (!q) return 0;
  const ql = q.toLowerCase();
  const ll = action.label.toLowerCase();
  if (ll.startsWith(ql)) return 3;
  if (ll.includes(ql)) return 2;
  if (action.keywords?.some((k) => k.toLowerCase().includes(ql))) return 1;
  return 0;
}

export function usePalette() {
  const [open,    setOpen]    = useState(false);
  const [query,   setQuery]   = useState("");
  // Force re-render when registry changes.
  const [tick, setTick] = useState(0);

  const openPalette  = useCallback(() => { setOpen(true); setQuery(""); }, []);
  const closePalette = useCallback(() => setOpen(false), []);

  // React to registry updates.
  useEffect(() => subscribeActions(() => setTick((t) => t + 1)), []);

  // Global shortcut.
  useKeyboard({ "mod+k": openPalette });

  // Escape to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); closePalette(); }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [open, closePalette]);

  const results = useMemo(() => {
    void tick; // track registry changes
    const all = getActions();
    if (!query.trim()) return all;

    return all
      .filter((a) => {
        const searchable = [a.label, a.description ?? "", ...(a.keywords ?? [])].join(" ");
        return fuzzy(searchable, query.trim());
      })
      .map((a) => ({ action: a, _score: score(a, query.trim()) }))
      .sort((a, b) => b._score - a._score)
      .map(({ action }) => action);
  }, [query, tick]);

  const run = useCallback(
    (action: PaletteAction) => {
      closePalette();
      // Small delay so the palette unmounts before the action runs
      // (avoids focus conflicts with opened modals).
      setTimeout(() => action.handler(), 60);
    },
    [closePalette],
  );

  return { open, query, setQuery, results, openPalette, closePalette, run };
}
