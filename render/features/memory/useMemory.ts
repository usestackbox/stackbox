import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
// features/memory/useMemory.ts
import { useCallback, useEffect, useState } from "react";
import type { MemTab, Memory } from "./memorytypes";
import { effectiveLevel } from "./memorytypes";

export function useMemory(workspaceId: string) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dbReady, setDbReady] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  // Wait for DB to be ready, retrying on "not initialised"
  useEffect(() => {
    let cancelled = false;
    const DELAYS = [300, 600, 1000, 1500, 2000, 2500, 3000, 3000, 3000, 3000];

    const readyUnsub = listen<void>("memory-ready", () => {
      if (!cancelled) setDbReady(true);
    });
    const errorUnsub = listen<string>("memory-error", ({ payload }) => {
      if (!cancelled) {
        setError(`Memory error: ${payload}`);
        setLoading(false);
      }
    });

    let attempt = 0;
    (async () => {
      while (!cancelled) {
        try {
          await invoke("memory_list", { runboxId: workspaceId });
          if (!cancelled) setDbReady(true);
          return;
        } catch (e) {
          const msg = String(e).toLowerCase();
          if (msg.includes("not initialised") && attempt < DELAYS.length) {
            await new Promise((r) => setTimeout(r, DELAYS[attempt++]));
          } else if (!msg.includes("not initialised")) {
            if (!cancelled) {
              setError(String(e));
              setLoading(false);
            }
            return;
          } else {
            if (!cancelled) {
              setError("Memory took too long. Click Retry.");
              setLoading(false);
            }
            return;
          }
        }
      }
    })();

    return () => {
      cancelled = true;
      readyUnsub.then((f) => f());
      errorUnsub.then((f) => f());
    };
  }, [workspaceId, retryKey]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mine, global] = await Promise.all([
        invoke<Memory[]>("memory_list", { runboxId: workspaceId }),
        invoke<Memory[]>("memory_list", { runboxId: "__global__" }),
      ]);
      setMemories([...mine, ...global]);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (dbReady) loadAll();
  }, [dbReady, loadAll]);

  useEffect(() => {
    if (!dbReady) return;
    const u = listen<{ runbox_id: string }>("memory-added", ({ payload }) => {
      if (payload.runbox_id === workspaceId || payload.runbox_id === "__global__") loadAll();
    });
    return () => {
      u.then((fn) => fn());
    };
  }, [dbReady, workspaceId, loadAll]);

  const handleDelete = useCallback(async (id: string) => {
    await invoke("memory_delete", { id });
    setMemories((p) => p.filter((m) => m.id !== id));
  }, []);

  const handlePin = useCallback(async (id: string, pinned: boolean) => {
    await invoke("memory_pin", { id, pinned });
    setMemories((p) => p.map((m) => (m.id === id ? { ...m, pinned } : m)));
  }, []);

  const handleEdit = useCallback(async (id: string, content: string) => {
    await invoke("memory_update", { id, content });
    setMemories((p) => p.map((m) => (m.id === id ? { ...m, content } : m)));
  }, []);

  const retry = useCallback(() => {
    setError(null);
    setDbReady(false);
    setLoading(true);
    setRetryKey((k) => k + 1);
  }, []);

  const byLevel = (l: string) => memories.filter((m) => effectiveLevel(m) === l && !m.resolved);

  return {
    memories,
    loading,
    error,
    dbReady,
    locked: byLevel("LOCKED"),
    preferred: byLevel("PREFERRED"),
    temporary: byLevel("TEMPORARY"),
    session: byLevel("SESSION"),
    handleDelete,
    handlePin,
    handleEdit,
    loadAll,
    retry,
  };
}

export function useMemoryTab() {
  const [tab, setTab] = useState<MemTab>("LOCKED");
  const [search, setSearch] = useState("");
  return { tab, setTab, search, setSearch };
}