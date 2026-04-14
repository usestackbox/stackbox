import { invoke } from "@tauri-apps/api/core";
// render/features/settings/useSettings.ts
import { useCallback, useEffect, useState } from "react";

export interface AppSettings {
  theme: "dark" | "light" | "system";
  fontSize: number;
  autoUpdate: boolean;
  launchAtLogin: boolean;
  logLevel: "error" | "warn" | "info" | "debug" | "trace";
  sidebarWidth: number;
}


const LS_KEY = "calus:settings";

const DEFAULTS: AppSettings = {
  theme: "dark",
  fontSize: 13,
  autoUpdate: true,
  launchAtLogin: false,
  logLevel: "info",
  sidebarWidth: 260,
};

function fromLocalStorage(): AppSettings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

export function useSettings() {
  const [settings, setSettingsState] = useState<AppSettings>(fromLocalStorage);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On mount, load from Rust config (source of truth)
  useEffect(() => {
    invoke<AppSettings>("config_read")
      .then((cfg) => {
        setSettingsState((s) => ({ ...s, ...cfg }));
        localStorage.setItem(LS_KEY, JSON.stringify({ ...settings, ...cfg }));
      })
      .catch(() => {
        /* offline / first run: keep localStorage values */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = useCallback(
    async (patch: Partial<AppSettings>) => {
      // Use functional setState so we always merge against the latest value —
      // avoids dropped updates if save() is called multiple times in quick
      // succession before the previous render completes.
      let next: AppSettings = DEFAULTS;
      setSettingsState((prev) => {
        next = { ...prev, ...patch };
        return next;
      });
      // next is set synchronously above inside the updater
      localStorage.setItem(LS_KEY, JSON.stringify(next));
      setSaving(true);
      setError(null);
      try {
        await invoke("config_write", { config: next });
      } catch (e) {
        setError(String(e));
      } finally {
        setSaving(false);
      }
    },
    [] // no deps needed — we read state via functional updater
  );

  const reset = useCallback(async () => {
    setSaving(true);
    try {
      const cfg = await invoke<AppSettings>("config_reset");
      setSettingsState(cfg);
      localStorage.setItem(LS_KEY, JSON.stringify(cfg));
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, []);

  return { settings, save, reset, saving, error };
}
