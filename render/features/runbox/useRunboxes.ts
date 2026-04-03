// features/runbox/useRunboxes.ts
// All runbox CRUD state + persistence. Extracted from App.tsx.

import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { loadRunboxes, saveRunboxes } from "../../lib/storage";
import type { Runbox } from "../../types/runbox";

export function useRunboxes() {
  const [runboxes, setRunboxes] = useState<Runbox[]>(() => loadRunboxes());
  const [activeId, setActiveId] = useState<string | null>(() => loadRunboxes()[0]?.id ?? null);

  // Persist whenever runboxes change
  useEffect(() => { saveRunboxes(runboxes); }, [runboxes]);

  const safeId = runboxes.find(r => r.id === activeId)?.id ?? runboxes[0]?.id ?? null;

  const create = useCallback(async (name: string, cwd: string) => {
    const id = crypto.randomUUID();
    invoke("git_ensure", { cwd, runboxId: id }).catch(() => {});
    setRunboxes(p => [...p, { id, name, cwd }]);
    setActiveId(id);
  }, []);

  const rename = useCallback((id: string, name: string) => {
    setRunboxes(p => p.map(r => r.id === id ? { ...r, name } : r));
  }, []);

  const remove = useCallback((id: string) => {
    invoke("memory_delete_for_runbox", { runboxId: id }).catch(() => {});
    setRunboxes(p => {
      const next = p.filter(r => r.id !== id);
      setActiveId(a => a === id ? (next[0]?.id ?? null) : a);
      return next;
    });
  }, []);

  return { runboxes, activeId, safeId, setActiveId, create, rename, remove };
}
