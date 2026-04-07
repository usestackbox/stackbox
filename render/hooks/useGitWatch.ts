// hooks/useGitWatch.ts
// Starts/stops the Tauri git file watcher and subscribes to live-diff events.
// Extracted so both FileChangeList and GitPanel share the same logic.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import type { LiveDiffFile } from "../types/events";

interface Options {
  cwd: string;
  runboxId: string;
  onDiff: (files: LiveDiffFile[]) => void;
}

export function useGitWatch({ cwd, runboxId, onDiff }: Options) {
  // Start / stop watcher
  useEffect(() => {
    if (!cwd) return;
    invoke("git_watch_start", { cwd, runboxId }).catch(() => {});
    return () => {
      invoke("git_watch_stop", { cwd }).catch(() => {});
    };
  }, [cwd, runboxId]);

  // Subscribe to live diff events
  useEffect(() => {
    const unsub = listen<LiveDiffFile[]>("git:live-diff", ({ payload }) => {
      onDiff(payload);
    });
    return () => {
      unsub.then((fn) => fn());
    };
  }, [onDiff]);
}
