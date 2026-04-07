// render/features/notifications/NotificationCenter.tsx
// Bell icon + dropdown showing notification history.
// Place in the top-bar or wherever the app chrome lives.

import { useRef, useState } from "react";
import { C, FS, SANS, SP } from "../../design/tokens";
import { useClickOutside } from "../../hooks/useClickOutside";
import { useNotifications } from "./useNotifications";
import type { NotifLevel, Notification } from "./useNotifications";

const LEVEL_COLOR: Record<NotifLevel, string> = {
  info: C.blue,
  success: C.green,
  warning: C.amber,
  error: C.red,
};

const LEVEL_ICON: Record<NotifLevel, string> = {
  info: "ℹ",
  success: "✓",
  warning: "⚠",
  error: "✕",
};

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function NotifRow({ n, onDismiss }: { n: Notification; onDismiss: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        gap: SP[2],
        padding: `${SP[2]}px ${SP[3]}px`,
        borderBottom: `1px solid ${C.border}`,
        opacity: n.read ? 0.55 : 1,
      }}
    >
      <span
        style={{
          fontSize: 13,
          color: LEVEL_COLOR[n.level],
          flexShrink: 0,
          marginTop: 1,
          fontWeight: 700,
        }}
      >
        {LEVEL_ICON[n.level]}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: FS.sm,
            color: C.t0,
            fontWeight: n.read ? 400 : 500,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {n.title}
        </div>
        {n.message && (
          <div
            style={{
              fontSize: FS.xs,
              color: C.t1,
              marginTop: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {n.message}
          </div>
        )}
        <div style={{ fontSize: FS.xs, color: C.t3, marginTop: 2 }}>{timeAgo(n.ts)}</div>
      </div>

      <button
        onClick={onDismiss}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: C.t3,
          fontSize: 14,
          lineHeight: 1,
          padding: 0,
          flexShrink: 0,
          alignSelf: "flex-start",
        }}
      >
        ×
      </button>
    </div>
  );
}

export function NotificationCenter() {
  const { notifications, unread, dismiss, markRead, clear } = useNotifications();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useClickOutside(wrapRef, () => setOpen(false), { enabled: open });

  const toggle = () => {
    if (!open) markRead();
    setOpen((o) => !o);
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", fontFamily: SANS }}>
      {/* Bell button */}
      <button
        onClick={toggle}
        title="Notifications"
        style={{
          position: "relative",
          background: open ? C.bg5 : "none",
          border: `1px solid ${open ? C.borderMd : "transparent"}`,
          borderRadius: C.r2,
          cursor: "pointer",
          color: C.t1,
          padding: `${SP[1]}px ${SP[2]}px`,
          display: "flex",
          alignItems: "center",
          lineHeight: 1,
          fontSize: 16,
          transition: "background 100ms",
        }}
      >
        🔔
        {unread > 0 && (
          <span
            style={{
              position: "absolute",
              top: -2,
              right: -2,
              minWidth: 16,
              height: 16,
              borderRadius: C.r5,
              background: C.red,
              color: "#fff",
              fontSize: 9,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              paddingInline: 3,
              lineHeight: 1,
            }}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            width: 340,
            background: C.bg3,
            border: `1px solid ${C.borderMd}`,
            borderRadius: C.r3,
            boxShadow: C.shadowLg,
            zIndex: 800,
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: `${SP[3]}px ${SP[4]}px`,
              borderBottom: `1px solid ${C.border}`,
            }}
          >
            <span style={{ fontSize: FS.sm, color: C.t0, fontWeight: 600 }}>Notifications</span>
            {notifications.length > 0 && (
              <button
                onClick={() => {
                  clear();
                }}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: C.t2,
                  fontSize: FS.xs,
                  padding: 0,
                }}
              >
                Clear all
              </button>
            )}
          </div>

          {/* List */}
          <div style={{ maxHeight: 360, overflowY: "auto" }}>
            {notifications.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  color: C.t2,
                  fontSize: FS.sm,
                  padding: `${SP[8]}px 0`,
                }}
              >
                No notifications
              </div>
            ) : (
              notifications.map((n) => (
                <NotifRow key={n.id} n={n} onDismiss={() => dismiss(n.id)} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
