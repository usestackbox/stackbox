// lib/time.ts
// Single source of truth for all time formatting.
// Pure functions — no React, no side effects.

/** Relative time string from a unix-ms timestamp. */
export function reltime(ms: number): string {
  if (!ms) return "";
  const d = Date.now() - ms;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

/** Relative time from an ISO date string (for git commits). */
export function reldate(iso: string): string {
  try {
    const d = Date.now() - new Date(iso).getTime();
    if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
    if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`;
    return `${Math.floor(d / 86_400_000)}d`;
  } catch {
    return "";
  }
}
