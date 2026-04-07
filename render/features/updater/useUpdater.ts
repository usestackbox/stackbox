import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
// render/features/updater/useUpdater.ts
import { useCallback, useEffect, useRef, useState } from "react";

export type UpdaterState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "available"; version: string; date?: string; notes?: string }
  | { phase: "downloading"; percent: number }
  | { phase: "ready" }
  | { phase: "error"; message: string };

export interface UseUpdaterReturn {
  state: UpdaterState;
  checkNow: () => Promise<void>;
  install: () => Promise<void>;
  dismiss: () => void;
}

const HOUR_MS = 60 * 60 * 1000;

export function useUpdater(): UseUpdaterReturn {
  const [state, setState] = useState<UpdaterState>({ phase: "idle" });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Track total bytes to calculate percent
  const totalBytesRef = useRef<number>(0);
  const loadedBytesRef = useRef<number>(0);

  const check = useCallback(async () => {
    setState({ phase: "checking" });
    try {
      const info = await invoke<{ version: string; date?: string; body?: string } | null>(
        "check_update"
      );
      if (info) {
        setState({
          phase: "available",
          version: info.version,
          date: info.date,
          notes: info.body,
        });
      } else {
        setState({ phase: "idle" });
      }
    } catch (e) {
      setState({ phase: "error", message: String(e) });
    }
  }, []);

  const install = useCallback(async () => {
    setState({ phase: "downloading", percent: 0 });
    try {
      await invoke("install_update");
      // App will restart — this state is briefly visible
      setState({ phase: "ready" });
    } catch (e) {
      setState({ phase: "error", message: String(e) });
    }
  }, []);

  const dismiss = useCallback(() => {
    setState({ phase: "idle" });
  }, []);

  // Listen to download progress events from Rust
  useEffect(() => {
    const unsub = listen<{ chunkLength: number; contentLength: number | null }>(
      "update-download-progress",
      ({ payload }) => {
        if (payload.contentLength) {
          totalBytesRef.current = payload.contentLength;
        }
        loadedBytesRef.current += payload.chunkLength;
        const percent =
          totalBytesRef.current > 0
            ? Math.min(99, Math.round((loadedBytesRef.current / totalBytesRef.current) * 100))
            : 0;
        setState({ phase: "downloading", percent });
      }
    );
    return () => {
      unsub.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const unsub = listen("update-download-finished", () => {
      setState({ phase: "ready" });
    });
    return () => {
      unsub.then((fn) => fn());
    };
  }, []);

  // Boot check + hourly re-check
  useEffect(() => {
    // Slight delay on boot so the app UI is fully rendered first
    const boot = setTimeout(() => check(), 3000);
    intervalRef.current = setInterval(() => check(), HOUR_MS);
    return () => {
      clearTimeout(boot);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [check]);

  return { state, checkNow: check, install, dismiss };
}
