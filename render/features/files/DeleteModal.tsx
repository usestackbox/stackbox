// features/files/DeleteModal.tsx
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { MONO } from "../../design";

interface FsEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

interface Props {
  entry: FsEntry;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteModal({ entry, onConfirm, onCancel }: Props) {
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    btnRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,.55)",
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: "#252526",
          border: "1px solid #454545",
          borderRadius: 8,
          padding: "20px 24px",
          minWidth: 340,
          maxWidth: 440,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          boxShadow: "0 12px 40px rgba(0,0,0,.7)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "rgba(239,68,68,.15)",
              border: "1px solid rgba(239,68,68,.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#f87171"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14H6L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4h6v2" />
            </svg>
          </div>
          <span style={{ fontSize: 14, color: "#cccccc", fontWeight: 600 }}>
            Delete {entry.is_dir ? "Folder" : "File"}
          </span>
        </div>
        <div style={{ fontSize: 13, color: "#999", lineHeight: 1.6 }}>
          Are you sure you want to delete{" "}
          <span style={{ color: "#e6edf3", fontFamily: MONO, fontWeight: 500 }}>
            "{entry.name}"
          </span>
          ?
          {entry.is_dir && (
            <div style={{ marginTop: 6, color: "#f48771", fontSize: 12 }}>
              ⚠ This will permanently delete the folder and all its contents.
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 2 }}>
          <button
            onClick={onCancel}
            style={{
              background: "transparent",
              border: "1px solid #454545",
              borderRadius: 5,
              color: "#cccccc",
              fontSize: 12,
              padding: "6px 18px",
              cursor: "pointer",
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,.07)")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLElement).style.background = "transparent")
            }
          >
            Cancel
          </button>
          <button
            ref={btnRef}
            onClick={onConfirm}
            style={{
              background: "rgba(239,68,68,.18)",
              border: "1px solid rgba(239,68,68,.4)",
              borderRadius: 5,
              color: "#f87171",
              fontSize: 12,
              fontWeight: 600,
              padding: "6px 18px",
              cursor: "pointer",
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,.32)")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,.18)")
            }
          >
            Delete
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
