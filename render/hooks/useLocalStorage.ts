// render/hooks/useLocalStorage.ts
// Type-safe localStorage hook with SSR guard and cross-tab sync.

import { useState, useEffect, useCallback } from "react";

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * useState backed by localStorage.
 * Automatically syncs across tabs via the `storage` event.
 */
export function useLocalStorage<T>(
  key: string,
  defaultValue: T,
): [T, (value: T | ((prev: T) => T)) => void, () => void] {
  const [state, setState] = useState<T>(() => {
    // SSR guard — localStorage is not available server-side.
    if (typeof window === "undefined") return defaultValue;
    return readStorage(key, defaultValue);
  });

  const set = useCallback(
    (value: T | ((prev: T) => T)) => {
      setState((prev) => {
        const next = typeof value === "function"
          ? (value as (prev: T) => T)(prev)
          : value;
        try {
          window.localStorage.setItem(key, JSON.stringify(next));
        } catch {
          // Quota exceeded or private browsing — fail silently.
        }
        return next;
      });
    },
    [key],
  );

  const remove = useCallback(() => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
    setState(defaultValue);
  }, [key, defaultValue]);

  // Sync across tabs.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key) return;
      if (e.newValue === null) {
        setState(defaultValue);
      } else {
        try {
          setState(JSON.parse(e.newValue) as T);
        } catch {
          setState(defaultValue);
        }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key, defaultValue]);

  return [state, set, remove];
}
