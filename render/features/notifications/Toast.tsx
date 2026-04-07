// render/features/notifications/Toast.tsx
// Single toast — info / success / warning / error variants.

import { useEffect, useState } from "react";
import { C, FS, SANS, SP } from "../../design/tokens";
import type { NotifLevel, Notification } from "./useNotifications";
import { dismissNotification } from "./useNotifications";

interface Props {
  notif: Notification;
}

const LEVEL_STYLE: Record<
  NotifLevel,
  {
    bg: string;
    border: string;
    icon: string;
    color: string;
  }
> = {
  info: { bg: C.blueBg, border: C.blueBorder, icon: "ℹ", color: C.blue },
  success: { bg: C.greenBg, border: C.greenBorder, icon: "✓", color: C.green },
  warning: { bg: C.amberBg, border: C.amberBorder, icon: "⚠", color: C.amber },
  error: { bg: C.redBg, border: C.redBorder, icon: "✕", color: C.red },
};

export function Toast({ notif }: Props) {
  const [visible, setVisible] = useState(false);

  // Slide in
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Auto-dismiss
  useEffect(() => {
    if (!notif.duration) return;
    const id = setTimeout(() => {
      setVisible(false);
      setTimeout(() => dismissNotification(notif.id), 250);
    }, notif.duration);
    return () => clearTimeout(id);
  }, [notif.id, notif.duration]);

  const style = LEVEL_STYLE[notif.level];

  return (
    <div
      style={{
        fontFamily: SANS,
        display: "flex",
        alignItems: "flex-start",
        gap: SP[3],
        padding: `${SP[3]}px ${SP[4]}px`,
        background: style.bg,
        border: `1px solid ${style.border}`,
        borderRadius: C.r3,
        boxShadow: C.shadowMd,
        minWidth: 280,
        maxWidth: 380,
        pointerEvents: "all",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateX(0)" : "translateX(24px)",
        transition: "opacity 200ms ease, transform 200ms ease",
      }}
    >
      {/* Level icon */}
      <span
        style={{
          fontSize: 15,
          color: style.color,
          flexShrink: 0,
          marginTop: 1,
          fontWeight: 700,
        }}
      >
        {style.icon}
      </span>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: FS.sm, color: C.t0, fontWeight: 500 }}>{notif.title}</div>
        {notif.message && (
          <div style={{ fontSize: FS.xs, color: C.t1, marginTop: 2 }}>{notif.message}</div>
        )}
      </div>

      {/* Dismiss button */}
      <button
        onClick={() => {
          setVisible(false);
          setTimeout(() => dismissNotification(notif.id), 250);
        }}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: C.t2,
          fontSize: 16,
          lineHeight: 1,
          padding: 0,
          flexShrink: 0,
          marginTop: 1,
        }}
        title="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
