// features/memory/MemCard.tsx
import { useEffect, useRef, useState } from "react";
import { C, MONO, SANS } from "../../design";
import { LEVEL_META, agentStyle, effectiveLevel, reltime } from "./memoryTypes";
import type { Memory } from "./memoryTypes";

const tbtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: C.t2,
  cursor: "pointer",
  padding: "3px 8px",
  borderRadius: 6,
  fontSize: 11,
  display: "flex",
  alignItems: "center",
  gap: 3,
  fontFamily: SANS,
  transition: "all .1s",
};

function LevelBadge({ level }: { level: string }) {
  const m = LEVEL_META[level];
  if (!m) return null;
  return (
    <span
      style={{
        fontSize: 9,
        fontFamily: MONO,
        padding: "2px 7px",
        borderRadius: 5,
        color: m.color,
        background: m.bg,
        border: `1px solid ${m.color}33`,
        letterSpacing: ".04em",
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
      }}
    >
      {m.icon} {m.label.toUpperCase()}
    </span>
  );
}

interface Props {
  mem: Memory;
  onDelete: (id: string) => void;
  onPin: (id: string, p: boolean) => void;
  onEdit: (id: string, c: string) => Promise<void>;
  isLocked: boolean;
}

export function MemCard({ mem, onDelete, onPin, onEdit, isLocked }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(mem.content);
  const [saving, setSaving] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setEditContent(mem.content);
  }, [mem.content]);
  useEffect(() => {
    if (editing) setTimeout(() => taRef.current?.focus(), 20);
  }, [editing]);

  const level = effectiveLevel(mem);
  const meta = LEVEL_META[level] ?? LEVEL_META.PREFERRED;
  const isLong = mem.content.length > 280;
  const as_ = agentStyle(mem.agent_type || mem.agent_name || "human");

  const saveEdit = async () => {
    setSaving(true);
    try {
      await onEdit(mem.id, editContent.trim());
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const borderLeft =
    level === "LOCKED"
      ? `3px solid ${C.amber}80`
      : level === "TEMPORARY"
        ? `3px solid ${C.t2}66`
        : undefined;

  const agentLabel = mem.agent_id ? mem.agent_id.split(":")[0] : mem.agent_type || mem.agent_name;

  return (
    <div
      style={{
        background: meta.bg,
        border: `1px solid ${meta.color}22`,
        borderLeft,
        borderRadius: 10,
        padding: "11px 13px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
        <LevelBadge level={level} />
        {mem.key && mem.key.length > 0 && level === "PREFERRED" && (
          <span
            style={{
              fontSize: 9,
              fontFamily: MONO,
              color: C.t3,
              background: C.bg4,
              border: `1px solid ${C.border}`,
              borderRadius: 5,
              padding: "2px 6px",
            }}
          >
            key:{mem.key}
          </span>
        )}
        {mem.resolved && (
          <span
            style={{
              fontSize: 9,
              fontFamily: MONO,
              color: C.green,
              background: C.greenBg,
              border: `1px solid ${C.green}40`,
              borderRadius: 5,
              padding: "2px 7px",
            }}
          >
            ✓ resolved
          </span>
        )}
        {mem.pinned && <span style={{ fontSize: 10 }}>📌</span>}
        <span style={{ flex: 1 }} />
        {agentLabel && (
          <span
            style={{
              fontSize: 9,
              fontFamily: MONO,
              fontWeight: 600,
              color: as_.fg,
              background: as_.bg,
              border: `1px solid ${as_.fg}44`,
              borderRadius: 5,
              padding: "2px 6px",
            }}
          >
            {agentLabel}
          </span>
        )}
        <span style={{ fontSize: 10, fontFamily: MONO, color: C.t3 }}>
          {reltime(mem.timestamp)}
        </span>
      </div>

      {/* Content */}
      {editing ? (
        <textarea
          ref={taRef}
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          rows={Math.max(3, editContent.split("\n").length + 1)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setEditing(false);
              setEditContent(mem.content);
            }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveEdit();
          }}
          style={{
            background: C.bg0,
            border: `1px solid ${C.borderHi}`,
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
      ) : (
        <p
          style={{
            margin: 0,
            fontSize: 12.5,
            color: C.t1,
            lineHeight: 1.65,
            fontFamily: MONO,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: isLong && !expanded ? 200 : "none",
            overflow: "hidden",
          }}
        >
          {mem.content}
        </p>
      )}
      {!editing && isLong && (
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{ ...tbtn, padding: 0, fontSize: 10, color: C.blue, alignSelf: "flex-start" }}
        >
          {expanded ? "↑ less" : "↓ more"}
        </button>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
        {editing ? (
          <>
            <button
              onClick={saveEdit}
              disabled={saving}
              style={{
                ...tbtn,
                background: C.bg4,
                border: `1px solid ${C.borderMd}`,
                color: saving ? C.t2 : C.t0,
              }}
            >
              {saving ? "Saving…" : "✓ Save"}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setEditContent(mem.content);
              }}
              style={{ ...tbtn, color: C.t2 }}
            >
              Cancel
            </button>
          </>
        ) : (
          !isLocked && (
            <>
              <button
                onClick={() => setEditing(true)}
                style={{ ...tbtn, color: C.t2 }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = C.t0)}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = C.t2)}
              >
                Edit
              </button>
              <button
                onClick={() => onPin(mem.id, !mem.pinned)}
                style={{ ...tbtn, color: C.t2 }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = C.t0)}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = C.t2)}
              >
                {mem.pinned ? "Unpin" : "Pin"}
              </button>
            </>
          )
        )}
        <span style={{ flex: 1 }} />
        <button
          onClick={() => onDelete(mem.id)}
          style={{ ...tbtn, color: C.t3 }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = C.red)}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = C.t3)}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
