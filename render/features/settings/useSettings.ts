// render/features/settings/useSettings.ts
import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface AppSettings {
  theme:          "dark" | "light" | "system";
  fontSize:       number;
  autoUpdate:     boolean;
  launchAtLogin:  boolean;
  logLevel:       "error" | "warn" | "info" | "debug" | "trace";
  sidebarWidth:   number;
  mcpServers:     McpServerConfig[];
}

export interface McpServerConfig {
  id:      string;
  name:    string;
  url:     string;
  enabled: boolean;
}

const LS_KEY = "stackbox:settings";

const DEFAULTS: AppSettings = {
  theme:         "dark",
  fontSize:      13,
  autoUpdate:    true,
  launchAtLogin: false,
  logLevel:      "info",
  sidebarWidth:  260,
  mcpServers:    [],
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
  const [saving, setSaving]          = useState(false);
  const [error,  setError]           = useState<string | null>(null);

  // On mount, load from Rust config (source of truth)
  useEffect(() => {
    invoke<AppSettings>("config_read")
      .then(cfg => {
        setSettingsState(s => ({ ...s, ...cfg }));
        localStorage.setItem(LS_KEY, JSON.stringify({ ...settings, ...cfg }));
      })
      .catch(() => {/* offline / first run: keep localStorage values */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = useCallback(async (patch: Partial<AppSettings>) => {
    const next = { ...settings, ...patch };
    setSettingsState(next);
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
  }, [settings]);

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
