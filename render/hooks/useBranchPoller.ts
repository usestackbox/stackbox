// hooks/useBranchPoller.ts
// Polls the current git branch for the active runbox every 5 seconds.
// Extracted from App.tsx.

import { useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Runbox } from "../types/runbox";

interface Options {
  runboxes:  Runbox[];
  activeId:  string | null;
  cwdMap:    Record<string, string>;
  onBranch:  (id: string, branch: string) => void;
}
  
export function useBranchPoller({ runboxes, activeId, cwdMap, onBranch }: Options) {
  const refresh = useCallback(() => {
    if (!activeId) return;
    const rb = runboxes.find(r => r.id === activeId);
    if (!rb) return;
    const cwd = cwdMap[activeId] || rb.cwd;
    invoke<string>("git_current_branch", { cwd })
      .then(b => { if (b) onBranch(activeId, b); })
      .catch(() => {});
  }, [activeId, cwdMap, runboxes, onBranch]);

  useEffect(() => {
    refresh();
    const tid = setInterval(refresh, 5_000);
    return () => clearInterval(tid);
  }, [refresh]);
}
