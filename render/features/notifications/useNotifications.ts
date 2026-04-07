// render/features/notifications/useNotifications.ts
// Global notification queue — push, dismiss, clear.
// Backed by a module-level store so any component can push
// without prop-drilling or context.

import { useCallback, useEffect, useState } from "react";

export type NotifLevel = "info" | "success" | "warning" | "error";

export interface Notification {
  id: string;
  level: NotifLevel;
  title: string;
  message?: string;
  /** ms before auto-dismiss. 0 = never. Default 4000. */
  duration?: number;
  /** Timestamp when created. */
  ts: number;
  read: boolean;
}

type Listener = (notifications: Notification[]) => void;

// ── Module-level store ────────────────────────────────────────────────────────
let store: Notification[] = [];
const listeners = new Set<Listener>();

function emit() {
  const copy = [...store];
  for (const fn of listeners) fn(copy);
}

let idSeq = 0;

/** Push a new notification. Returns the generated id. */
export function pushNotification(opts: Omit<Notification, "id" | "ts" | "read">): string {
  const id = `notif-${Date.now()}-${++idSeq}`;
  store = [
    { ...opts, id, ts: Date.now(), read: false, duration: opts.duration ?? 4000 },
    ...store,
  ].slice(0, 100); // cap history at 100
  emit();
  return id;
}

export function dismissNotification(id: string) {
  store = store.filter((n) => n.id !== id);
  emit();
}

export function markAllRead() {
  store = store.map((n) => ({ ...n, read: true }));
  emit();
}

export function clearAll() {
  store = [];
  emit();
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>(store);

  useEffect(() => {
    const handler = (next: Notification[]) => setNotifications(next);
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);

  const push = useCallback(
    (opts: Omit<Notification, "id" | "ts" | "read">) => pushNotification(opts),
    []
  );
  const dismiss = useCallback((id: string) => dismissNotification(id), []);
  const markRead = useCallback(() => markAllRead(), []);
  const clear = useCallback(() => clearAll(), []);
  const unread = notifications.filter((n) => !n.read).length;

  return { notifications, push, dismiss, markRead, clear, unread };
}
