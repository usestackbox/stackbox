// features/memory/MemoryPanel.tsx
import { useCallback, useState } from "react";
import { C, MONO, SANS } from "../../design";
import { AddLockedForm } from "./AddLockedForm";
import { AddPreferredForm } from "./AddPreferredForm";
import { ContextPreview } from "./ContextPreview";
import { HealthBar } from "./HealthBar";
import { MemCard } from "./MemCard";
import { LEVEL_META, effectiveLevel } from "./memorytypes";
import type { MemTab } from "./memorytypes";
import { useMemory, useMemoryTab } from "./useMemory";

interface Props {
  workspaceId: string;
  workspaceName: string;
  onClose: () => void;
}

const SPIN = "@keyframes spin { to { transform: rotate(360deg); } }";

export function MemoryPanel({ workspaceId, workspaceName, onClose }: Props) {
  const {
    memories,
    loading,
    error,
    dbReady,
    locked,
    preferred,
    temporary,
    session,
    handleDelete,
    handlePin,
    handleEdit,
    loadAll,
    retry,
  } = useMemory(workspaceId);

  const { tab, setTab, search, setSearch } = useMemoryTab();
  const [toast, setToast] = useState<{ msg: string; color: string } | null>(null);

  const showToast = useCallback((msg: string, color = C.green) => {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const TABS: { id: MemTab; icon: string; label: string; count?: number; color?: string }[] = [
    { id: "LOCKED", icon: "🔒", label: "Locked", count: locked.length, color: C.amber },
    { id: "PREFERRED", icon: "◎", label: "Preferred", count: preferred.length, color: C.blue },
    { id: "TEMPORARY", icon: "⏳", label: "Temporary", count: temporary.length, color: C.t2 },
    { id: "SESSION", icon: "⌛", label: "Sessions", count: session.length, color: C.teal },
    { id: "all", icon: "≡", label: "All", count: memories.filter((m) => !m.resolved).length },
    { id: "context", icon: "↺", label: "Context", color: C.teal },
  ];

  const tabMap: Record<MemTab, typeof memories> = {
    LOCKED: locked,
    PREFERRED: preferred,
    TEMPORARY: temporary,
    SESSION: session,
    all: memories.filter((m) => !m.resolved),
    context: [],
  };

  const visible =
    tab === "context"
      ? []
      : (tabMap[tab] ?? []).filter(
          (m) =>
            !search.trim() ||
            [m.content, m.tags, m.key, m.agent_id]
              .join(" ")
              .toLowerCase()
              .includes(search.toLowerCase())
        );

  // Not ready yet — init screen
  if (!dbReady)
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          background: C.bg1,
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: "0 24px",
        }}
      >
        {!error ? (
          <>
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: "50%",
                border: `2px solid ${C.border}`,
                borderTopColor: C.t1,
                animation: "spin .7s linear infinite",
              }}
            />
            <span style={{ fontSize: 12, color: C.t2, fontFamily: SANS }}>
              Initialising memory…
            </span>
          </>
        ) : (
          <>
            <span
              style={{
                fontSize: 11,
                color: C.t2,
                fontFamily: SANS,
                textAlign: "center",
                lineHeight: 1.6,
              }}
            >
              {error}
            </span>
            <button
              onClick={retry}
              style={{
                padding: "6px 14px",
                borderRadius: 8,
                border: `1px solid ${C.border}`,
                background: C.bg2,
                color: C.t1,
                fontSize: 11,
                fontFamily: SANS,
                cursor: "pointer",
              }}
            >
              Retry
            </button>
          </>
        )}
        <style>{SPIN}</style>
      </div>
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg1 }}>
      {/* Header */}
      <div
        style={{
          padding: "12px 14px 11px",
          flexShrink: 0,
          borderBottom: `1px solid ${C.border}`,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: C.t0,
            flex: 1,
            fontFamily: SANS,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {workspaceName}
        </span>
        {loading && (
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              border: `2px solid ${C.border}`,
              borderTopColor: C.t1,
              animation: "spin .7s linear infinite",
              flexShrink: 0,
            }}
          />
        )}
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: C.t2,
            cursor: "pointer",
            padding: "4px 6px",
            borderRadius: 8,
            fontSize: 14,
          }}
          onMouseEnter={(e) => {
            const el = e.currentTarget as HTMLElement;
            el.style.background = C.bg3;
            el.style.color = C.t0;
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget as HTMLElement;
            el.style.background = "transparent";
            el.style.color = C.t2;
          }}
        >
          ✕
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div
          style={{
            margin: "6px 10px 0",
            padding: "8px 11px",
            background: `${toast.color}18`,
            border: `1px solid ${toast.color}44`,
            borderRadius: 8,
            fontSize: 11,
            color: toast.color,
            fontFamily: SANS,
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexShrink: 0,
          }}
        >
          <span style={{ flex: 1, lineHeight: 1.4 }}>{toast.msg}</span>
          <button
            onClick={() => setToast(null)}
            style={{
              background: "none",
              border: "none",
              color: toast.color,
              cursor: "pointer",
              fontSize: 14,
              padding: 0,
            }}
          >
            ×
          </button>
        </div>
      )}

      <HealthBar memories={memories} />

      {/* Tab bar */}
      <div style={{ padding: "8px 10px 0", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 3 }}>
          {TABS.map(({ id, icon, label, count, color }) => {
            const on = tab === id;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                style={{
                  padding: "6px 2px",
                  borderRadius: 7,
                  border: "none",
                  background: on ? C.bg4 : "transparent",
                  color: on ? C.t0 : C.t2,
                  fontSize: 10,
                  fontFamily: MONO,
                  cursor: "pointer",
                  transition: "all .1s",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 1,
                }}
              >
                <span>
                  {icon} {label}
                </span>
                {count !== undefined && count > 0 && (
                  <span style={{ fontSize: 9, color: on ? (color ?? C.t1) : C.t3 }}>{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab description */}
      {LEVEL_META[tab] && tab !== "context" && (
        <div
          style={{
            padding: "5px 12px",
            flexShrink: 0,
            fontSize: 10,
            color: C.t3,
            fontFamily: SANS,
            borderBottom: `1px solid ${C.border}`,
          }}
        >
          {LEVEL_META[tab].desc}
        </div>
      )}

      {/* Body */}
      {tab === "context" ? (
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <ContextPreview workspaceId={workspaceId} />
        </div>
      ) : (
        <>
          {/* Search */}
          <div
            style={{ padding: "8px 10px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}
          >
            <div style={{ position: "relative" }}>
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke={C.t2}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  position: "absolute",
                  left: 9,
                  top: "50%",
                  transform: "translateY(-50%)",
                  pointerEvents: "none",
                }}
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  background: C.bg2,
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  color: C.t0,
                  fontSize: 11,
                  padding: "7px 28px 7px 28px",
                  outline: "none",
                  fontFamily: MONO,
                }}
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  style={{
                    position: "absolute",
                    right: 7,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: C.t2,
                    fontSize: 13,
                    padding: 0,
                  }}
                >
                  ×
                </button>
              )}
            </div>
          </div>

          {/* Memory list */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "10px 10px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 7,
            }}
          >
            {tab === "LOCKED" && (
              <AddLockedForm
                workspaceId={workspaceId}
                onAdded={() => {
                  loadAll();
                  showToast("🔒 Locked rule added");
                }}
              />
            )}
            {tab === "PREFERRED" && (
              <AddPreferredForm
                workspaceId={workspaceId}
                onAdded={() => {
                  loadAll();
                  showToast("◎ Fact saved");
                }}
              />
            )}

            {tab === "TEMPORARY" && (
              <div
                style={{
                  padding: "8px 12px",
                  background: C.tealDim,
                  border: `1px solid ${C.tealBorder}`,
                  borderRadius: 9,
                  fontSize: 10,
                  color: C.t3,
                  fontFamily: SANS,
                  lineHeight: 1.5,
                }}
              >
                Agents write TEMPORARY facts during tasks. They auto-expire when the session ends.
                Read-only from the panel.
              </div>
            )}
            {tab === "SESSION" && (
              <div
                style={{
                  padding: "8px 12px",
                  background: C.tealDim,
                  border: `1px solid ${C.tealBorder}`,
                  borderRadius: 9,
                  fontSize: 10,
                  color: C.t3,
                  fontFamily: SANS,
                  lineHeight: 1.5,
                }}
              >
                End-of-session summaries written by agents. Last 3 per agent kept. All agents see
                each other's summaries.
              </div>
            )}

            {loading && (
              <div style={{ padding: "32px 0", display: "flex", justifyContent: "center" }}>
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    border: `2px solid ${C.border}`,
                    borderTopColor: C.t1,
                    animation: "spin .7s linear infinite",
                  }}
                />
              </div>
            )}
            {!loading && error && (
              <div
                style={{
                  padding: "12px 14px",
                  background: C.redBg,
                  border: `1px solid ${C.red}2d`,
                  borderRadius: 10,
                  fontSize: 12,
                  color: C.red,
                  fontFamily: SANS,
                }}
              >
                {error}
              </div>
            )}
            {!loading && !error && visible.length === 0 && (
              <div
                style={{
                  padding: "40px 0",
                  textAlign: "center",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 22, opacity: 0.3 }}>{LEVEL_META[tab]?.icon ?? "○"}</span>
                <span style={{ fontSize: 12, color: C.t2, fontFamily: SANS }}>
                  {search
                    ? "No memories match."
                    : `No ${LEVEL_META[tab]?.label ?? ""} memories yet.`}
                </span>
              </div>
            )}
            {!loading &&
              !error &&
              visible.map((mem) => (
                <MemCard
                  key={mem.id}
                  mem={mem}
                  onDelete={handleDelete}
                  onPin={handlePin}
                  onEdit={handleEdit}
                  isLocked={effectiveLevel(mem) === "LOCKED"}
                />
              ))}
          </div>
        </>
      )}
      <style>{SPIN}</style>
    </div>
  );
}
