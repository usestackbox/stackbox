// render/hooks/useOnline.ts
// Tracks navigator.onLine, reacting to online/offline browser events.
// Used by the updater and webhook features to gate network requests.

import { useEffect, useState } from "react";

export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  return online;
}
