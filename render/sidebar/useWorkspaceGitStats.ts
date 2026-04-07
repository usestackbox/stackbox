import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
// sidebar/useWorkspaceGitStats.ts
import { useCallback, useEffect, useState } from "react";
import type { Runbox } from "../types";

export interface GitStats {
  insertions: number;
  deletions: number;
  files: number;
}

/**
 * Poll git diff stats for every workspace.
 *
 * @param worktreeMap  Ephemeral map of runbox id → active worktree path.
 *                     When present, diff is computed against the worktree
 *                     (the agent's isolated branch) rather than the main
 *                     workspace directory.
 */
export function useWorkspaceGitStats(
  workspaces: Runbox[],
  cwdMap: Record<string, string>,
  worktreeMap: Record<string, string> = {}
): Record<string, GitStats> {
  const [stats, setStats] = useState<Record<string, GitStats>>({});

  const wsKey = workspaces.map((r) => r.id).join(",");
  const cwdKey = JSON.stringify(cwdMap);
  const worktreeKey = JSON.stringify(worktreeMap);

  const fetchAll = useCallback(() => {
    workspaces.forEach(async (ws) => {
      // Prefer worktree path so the sidebar shows the agent-branch diff, not
      // the main workspace diff.
      const cwd = worktreeMap[ws.id] ?? cwdMap[ws.id] ?? ws.cwd;
      try {
        const files = await invoke<any[]>("git_diff_live", { cwd, runboxId: ws.id });
        const ins = files.reduce((s: number, f: any) => s + (f.insertions ?? 0), 0);
        const del = files.reduce((s: number, f: any) => s + (f.deletions ?? 0), 0);
        if (ins > 0 || del > 0 || files.length > 0) {
          setStats((prev) => ({
            ...prev,
            [ws.id]: { insertions: ins, deletions: del, files: files.length },
          }));
        }
      } catch {
        /**/
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsKey, cwdKey, worktreeKey]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    const unsub = listen<any[]>("git:live-diff", fetchAll);
    return () => {
      unsub.then((f) => f());
    };
  }, [fetchAll]);

  return stats;
}
