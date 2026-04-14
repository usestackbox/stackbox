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

const HOUR_MS   = 60 * 60 * 1000;
const SETTINGS_KEY = "calus:settings";

/** Read the autoUpdate preference without taking a dependency on useSettings. */
function isAutoUpdateEnabled(): boolean {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return true; // default on
    const cfg = JSON.parse(raw);
    return cfg.autoUpdate !== false;
  } catch {
    return true;
  }
}

export function useUpdater(): UseUpdaterReturn {
  const [state, setState] = useState<UpdaterState>({ phase: "idle" });
  const stateRef    = useRef<UpdaterState>({ phase: "idle" });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Track total bytes to calculate percent
  const totalBytesRef  = useRef<number>(0);
  const loadedBytesRef = useRef<number>(0);

  // Keep stateRef in sync so callbacks can read the live phase without
  // capturing a stale closure value.
  useEffect(() => { stateRef.current = state; }, [state]);

  const check = useCallback(async () => {
    // Never interrupt an active download or a completed/pending restart —
    // the hourly interval could otherwise fire mid-download and reset the UI.
    const cur = stateRef.current.phase;
    if (cur === "downloading" || cur === "ready") return;
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
    // Bug 3 fix: reset counters before each attempt so a retry after an error
    // doesn't start the progress bar at a stale high percentage.
    loadedBytesRef.current = 0;
    totalBytesRef.current  = 0;
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

  // Boot check + hourly re-check — both gated behind the autoUpdate preference.
  // Manual checkNow() calls always go through regardless of this setting.
  useEffect(() => {
    if (!isAutoUpdateEnabled()) return; // user opted out — skip automatic checks
    // Slight delay on boot so the app UI is fully rendered first
    const boot = setTimeout(() => check(), 3000);
    intervalRef.current = setInterval(() => {
      if (isAutoUpdateEnabled()) check(); // re-read pref on each tick
    }, HOUR_MS);
    return () => {
      clearTimeout(boot);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [check]);

  return { state, checkNow: check, install, dismiss };
}
