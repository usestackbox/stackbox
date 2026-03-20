// src/sidebar/Sidebar.tsx
import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { C, MONO, SANS, tbtn } from "../shared/constants";
import { IcoSidebar } from "../shared/icons";
import { CreateRunboxModal } from "./CreateRunboxModal";
import type { Runbox } from "../shared/types";

interface SidebarProps {
  runboxes:  Runbox[];
  activeId:  string | null;
  cwdMap:    Record<string, string>;
  collapsed: boolean;
  onToggle:  () => void;
  onSelect:  (id: string) => void;
  onCreate:  (name: string, cwd: string) => void;
  onRename:  (id: string, name: string) => void;
  onDelete:  (id: string) => void;
}

export function Sidebar({
  runboxes, activeId, cwdMap, collapsed,
  onToggle, onSelect, onCreate, onRename, onDelete,
}: SidebarProps) {
  const [showModal, setShowModal] = useState(false);
  const [renaming,  setRenaming]  = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) setTimeout(() => renameRef.current?.select(), 30);
  }, [renaming]);

  const submitRename = (id: string) => {
    if (renameVal.trim()) onRename(id, renameVal.trim());
    setRenaming(null);
  };

  const W = collapsed ? 52 : 220;

  return (
    <>
      {showModal && (
        <CreateRunboxModal
          onSubmit={(n, c) => { onCreate(n, c); setShowModal(false); }}
          onClose={() => setShowModal(false)}
        />
      )}

      <div style={{
        width: W, flexShrink: 0,
        background: C.bg1,
        borderRight: `1px solid ${C.border}`,
        display: "flex", flexDirection: "column",
        transition: "width .18s cubic-bezier(.4,0,.2,1)",
        overflow: "hidden",
      }}>

        {/* Header */}
        <div style={{
          height: 48, flexShrink: 0,
          display: "flex", alignItems: "center",
          padding: collapsed ? "0 10px" : "0 14px",
          justifyContent: collapsed ? "center" : "space-between",
          borderBottom: `1px solid ${C.border}`,
        }}>
          {!collapsed && (
            <span style={{
              fontSize: 11, fontWeight: 700, letterSpacing: ".14em",
              color: C.t0, fontFamily: MONO, userSelect: "none",
            }}>STACKBOX</span>
          )}
          <button onClick={onToggle}
            style={{ ...tbtn, color: C.t2, padding: 6, borderRadius: 8 }}
            onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.color = C.t0; el.style.background = C.bg3; }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.color = C.t2; el.style.background = "transparent"; }}>
            <IcoSidebar on={!collapsed} />
          </button>
        </div>

        {/* New runbox button */}
        <div style={{ padding: collapsed ? "10px 8px" : "10px 10px", flexShrink: 0 }}>
          {collapsed ? (
            <button onClick={() => setShowModal(true)} title="New runbox"
              style={{
                width: "100%", height: 34, borderRadius: 10,
                background: "transparent", border: `1px solid ${C.border}`,
                color: C.t2, fontSize: 18, fontWeight: 300, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all .12s",
              }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = C.bg3; el.style.borderColor = C.borderMd; el.style.color = C.t0; }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.borderColor = C.border; el.style.color = C.t2; }}>
              +
            </button>
          ) : (
            <button onClick={() => setShowModal(true)}
              style={{
                width: "100%", height: 34, borderRadius: 10,
                background: "transparent", border: `1px solid ${C.border}`,
                color: C.t1, fontSize: 12, fontFamily: SANS,
                cursor: "pointer", transition: "all .12s",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
              }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = C.bg3; el.style.borderColor = C.borderMd; el.style.color = C.t0; }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.borderColor = C.border; el.style.color = C.t1; }}>
              <span style={{ fontSize: 16, fontWeight: 300, lineHeight: 1 }}>+</span>
              New runbox
            </button>
          )}
        </div>

        {/* Runbox list */}
        {!collapsed && runboxes.length > 0 && (
          <div style={{ padding: "2px 10px 4px", fontSize: 9, fontWeight: 700, letterSpacing: ".12em", color: C.t3, fontFamily: MONO, flexShrink: 0 }}>
            RUNBOXES
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto", padding: collapsed ? "4px 8px" : "4px 10px 10px" }}>
          {runboxes.map(rb => {
            const isOn = activeId === rb.id;
            if (collapsed) return (
              <div key={rb.id} title={rb.name} onClick={() => onSelect(rb.id)}
                style={{
                  width: 36, height: 36, borderRadius: 10, margin: "3px auto",
                  cursor: "pointer", display: "flex", alignItems: "center",
                  justifyContent: "center", fontSize: 12, fontWeight: 700,
                  fontFamily: SANS, transition: "all .12s",
                  background: isOn ? C.bg4 : "transparent",
                  border: `1px solid ${isOn ? C.borderMd : "transparent"}`,
                  color: isOn ? C.t0 : C.t2,
                }}
                onMouseEnter={e => { if (!isOn) { const el = e.currentTarget as HTMLElement; el.style.background = C.bg3; el.style.color = C.t1; } }}
                onMouseLeave={e => { if (!isOn) { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.color = C.t2; } }}>
                {rb.name.charAt(0).toUpperCase()}
              </div>
            );

            return (
              <div key={rb.id}
                onClick={() => onSelect(rb.id)}
                onDoubleClick={() => { setRenaming(rb.id); setRenameVal(rb.name); }}
                style={{
                  display: "flex", alignItems: "center", gap: 9,
                  padding: "7px 10px", marginBottom: 2,
                  cursor: "pointer", borderRadius: 10,
                  background: isOn ? C.bg3 : "transparent",
                  border: `1px solid ${isOn ? C.borderMd : "transparent"}`,
                  transition: "all .1s",
                }}
                onMouseEnter={e => { if (!isOn) (e.currentTarget as HTMLElement).style.background = C.bg2; }}
                onMouseLeave={e => { if (!isOn) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>

                {/* Status dot */}
                <span style={{
                  width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                  background: isOn ? C.t0 : C.t3,
                  boxShadow: isOn ? "0 0 6px rgba(255,255,255,.4)" : "none",
                  transition: "all .2s",
                }} />

                <div style={{ flex: 1, minWidth: 0 }}>
                  {renaming === rb.id ? (
                    <input ref={renameRef} value={renameVal}
                      onChange={e => setRenameVal(e.target.value)}
                      onBlur={() => submitRename(rb.id)}
                      onKeyDown={e => { if (e.key === "Enter") submitRename(rb.id); if (e.key === "Escape") setRenaming(null); }}
                      onClick={e => e.stopPropagation()}
                      style={{
                        background: C.bg5, border: `1px solid ${C.borderHi}`,
                        borderRadius: 6, color: C.t0, fontSize: 12,
                        padding: "2px 7px", width: "100%", outline: "none", fontFamily: MONO,
                      }} />
                  ) : (
                    <span style={{
                      fontSize: 13, fontFamily: SANS,
                      fontWeight: isOn ? 600 : 400,
                      color: isOn ? C.t0 : C.t1,
                      whiteSpace: "nowrap", overflow: "hidden",
                      textOverflow: "ellipsis", display: "block",
                    }}>{rb.name}</span>
                  )}
                </div>

                {isOn && !renaming && (
                  <button
                    onClick={e => { e.stopPropagation(); if (confirm(`Delete "${rb.name}"?`)) onDelete(rb.id); }}
                    style={{ ...tbtn, fontSize: 13, flexShrink: 0, opacity: 0, borderRadius: 6 }}
                    onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.opacity = "1"; el.style.color = C.red; }}
                    onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.opacity = "0"; el.style.color = C.t2; }}>
                    ×
                  </button>
                )}
              </div>
            );
          })}

          {!collapsed && runboxes.length === 0 && (
            <div style={{ padding: "20px 4px", fontSize: 11, color: C.t3, fontFamily: SANS, lineHeight: 1.7 }}>
              No runboxes yet.
            </div>
          )}
        </div>

        {!collapsed && (
          <div style={{ padding: "8px 14px", borderTop: `1px solid ${C.border}`, fontSize: 10, color: C.t3, fontFamily: SANS }}>
            Double-click to rename
          </div>
        )}
      </div>
    </>
  );
}