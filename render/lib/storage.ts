// lib/storage.ts
// Runbox persistence helpers — localStorage wrappers.

import { STORAGE_KEY } from "../design/tokens";
import type { Runbox } from "../types/runbox";

export function loadRunboxes(): Runbox[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function saveRunboxes(rbs: Runbox[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rbs));
  } catch {
    /* storage unavailable */
  }
}
