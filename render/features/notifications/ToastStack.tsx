import { createPortal } from "react-dom";
import { Toast } from "./Toast";
import { useNotifications } from "./useNotifications";

const MAX_VISIBLE = 5;

export function ToastStack() {
  const { notifications } = useNotifications();

  // Only show toasts that have a non-zero duration (i.e. auto-dismiss ones).
  // Persistent notifications live in the NotificationCenter history.
  const toasts = notifications.filter((n) => n.duration !== 0).slice(0, MAX_VISIBLE);

  if (toasts.length === 0) return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        top: 16,
        right: 16,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        zIndex: 950,
        pointerEvents: "none",
      }}
    >
      {toasts.map((notif) => (
        <Toast key={notif.id} notif={notif} />
      ))}
    </div>,
    document.body
  );
}
