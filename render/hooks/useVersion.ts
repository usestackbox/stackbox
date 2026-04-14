// render/hooks/useVersion.ts
// Fetches the app version and platform from the Tauri `get_app_version` command once on mount.
// get_app_version returns { version: string, platform: string } from commands/updater.rs

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

interface VersionInfo {
  version:  string;
  platform: string;
  loading:  boolean;
  error:    string | null;
}

export function useVersion(): VersionInfo {
  const [state, setState] = useState<VersionInfo>({
    version:  "",
    platform: "",
    loading:  true,
    error:    null,
  });

  useEffect(() => {
    let cancelled = false;
    invoke<{ version: string; platform: string }>("get_app_version")
      .then((info) => {
        if (!cancelled) setState({ ...info, loading: false, error: null });
      })
      .catch((e) => {
        if (!cancelled)
          setState({ version: "0.0.0", platform: "unknown", loading: false, error: String(e) });
      });
    return () => { cancelled = true; };
  }, []);

  return state;
}
