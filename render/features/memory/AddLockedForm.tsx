import { invoke } from "@tauri-apps/api/core";
// features/memory/AddLockedForm.tsx
import { useEffect, useRef, useState } from "react";
import { C, MONO, SANS } from "../../design";

interface Props {
  workspaceId: string;
  onAdded: () => void;
}

export function AddLockedForm({ workspaceId, onAdded }: Props) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => taRef.current?.focus(), 30);
  }, [open]);

  const submit = async () => {
    if (!content.trim()) return;
    setLoading(true);
    try {
      await invoke("memory_add_locked", {
        runboxId: workspaceId,
        sessionId: `panel-${workspaceId}`,
        content: content.trim(),
      });
      setContent("");
      setOpen(false);
      onAdded();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  if (!open)
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          width: "100%",
          padding: "9px 14px",
          borderRadius: 9,
          background: "transparent",
          border: `1px dashed ${C.amber}4d`,
          color: C.amber,
          fontSize: 11,
          fontFamily: SANS,
          cursor: "pointer",
          transition: "all .15s",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget as HTMLElement;
          el.style.background = C.amberBg;
          el.style.borderColor = `${C.amber}80`;
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget as HTMLElement;
          el.style.background = "transparent";
          el.style.borderColor = `${C.amber}4d`;
        }}
      >
        🔒 Add locked rule
      </button>
    );

  return (
    <div
      style={{
        background: C.amberBg,
        border: `1px solid ${C.amber}40`,
        borderRadius: 11,
        padding: 13,
        display: "flex",
        flexDirection: "column",
        gap: 9,
      }}
    >
      <div style={{ fontSize: 10, fontFamily: MONO, color: C.amber, letterSpacing: ".06em" }}>
        🔒 NEW LOCKED RULE
      </div>
      <textarea
        ref={taRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={
          "UI is black/white only — client requirement\nnever touch login-app/app.js\nno new npm dependencies"
        }
        rows={3}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            setContent("");
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
        style={{
          background: C.bg0,
          border: `1px solid ${C.amber}4d`,
          borderRadius: 8,
          color: C.t0,
          fontSize: 12.5,
          padding: "9px 11px",
          resize: "vertical",
          fontFamily: MONO,
          outline: "none",
          lineHeight: 1.65,
          width: "100%",
          boxSizing: "border-box",
        }}
      />
      <div style={{ display: "flex", gap: 7 }}>
        <button
          onClick={() => {
            setOpen(false);
            setContent("");
          }}
          style={{
            padding: "7px 13px",
            background: "transparent",
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            color: C.t2,
            fontSize: 11,
            fontFamily: SANS,
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={loading || !content.trim()}
          style={{
            flex: 1,
            padding: "7px 0",
            borderRadius: 8,
            border: "none",
            background: content.trim() && !loading ? C.amber : C.bg4,
            color: content.trim() && !loading ? C.bg0 : C.t2,
            fontSize: 12,
            fontWeight: 600,
            fontFamily: SANS,
            cursor: content.trim() && !loading ? "pointer" : "default",
            transition: "all .15s",
          }}
        >
          {loading ? "Saving…" : "🔒 Lock it"}
        </button>
      </div>
    </div>
  );
}
