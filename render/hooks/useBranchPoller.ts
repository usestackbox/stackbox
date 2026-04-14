// hooks/useBranchPoller.ts
// Polls the current git branch for the active runbox every 5 seconds.
// Extracted from App.tsx.

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef } from "react";
import type { Runbox } from "../types/runbox";

interface Options {
  runboxes: Runbox[];
  activeId: string | null;
  cwdMap: Record<string, string>;
  onBranch: (id: string, branch: string) => void;
}

export function useBranchPoller({ runboxes, activeId, cwdMap, onBranch }: Options) {
  // Use a ref for onBranch so the interval never needs to restart when the
  // caller re-creates the callback inline (e.g. an arrow function in JSX).
  // Without this, refresh is a new function every render → useEffect
  // re-fires every render → interval is cleared and restarted constantly.
  const onBranchRef = useRef(onBranch);
  useEffect(() => { onBranchRef.current = onBranch; });

  const refresh = useCallback(() => {
    if (!activeId) return;
    const rb = runboxes.find((r) => r.id === activeId);
    if (!rb) return;
    const cwd = cwdMap[activeId] || rb.cwd;
    invoke<string>("git_current_branch", { cwd })
      .then((b) => {
        if (b) onBranchRef.current(activeId, b);
      })
      .catch(() => {});
  // Intentionally omit onBranch from deps — using onBranchRef instead.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, cwdMap, runboxes]);

  useEffect(() => {
    refresh();
    const tid = setInterval(refresh, 5_000);
    return () => clearInterval(tid);
  }, [refresh]);
}
