import { useState, useRef, useEffect } from "react";
import { C, MONO, SANS, tbtn } from "../shared/constants";
import { IcoSidebar } from "../shared/icons";
import { CreateRunboxModal } from "./CreateRunboxModal";
import type { Runbox } from "../shared/ types";

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

export function Sidebar({ runboxes, activeId, cwdMap, collapsed, onToggle, onSelect, onCreate, onRename, onDelete }: SidebarProps) {
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

  return (
    <>
      {showModal && (
        <CreateRunboxModal
          onSubmit={(n, c) => { onCreate(n, c); setShowModal(false); }}
          onClose={() => setShowModal(false)}
        />
      )}

      <div style={{ width: collapsed ? 48 : 218, flexShrink: 0, background: C.bg1, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", transition: "width .15s cubic-bezier(.4,0,.2,1)", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ padding: collapsed ? "12px 0" : "12px 12px 10px", borderBottom: `1px solid ${C.border}`, display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: collapsed ? 0 : 10, width: "100%", padding: collapsed ? "0" : "0 4px", justifyContent: collapsed ? "center" : "flex-start" }}>
            {!collapsed && <span style={{ fontSize: 11, fontWeight: 700, color: C.t0, flex: 1, letterSpacing: ".12em", textTransform: "uppercase", paddingLeft: 4, fontFamily: MONO }}>STACKBOX</span>}
            <button onClick={onToggle} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              style={{ ...tbtn, color: collapsed ? C.t0 : C.t2, padding: 6 }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.t0}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = collapsed ? C.t0 : C.t2}>
              <IcoSidebar on={!collapsed} />
            </button>
          </div>
          {!collapsed && (
            <button onClick={() => setShowModal(true)}
              style={{ display: "flex", alignItems: "center", gap: 7, width: "100%", padding: "7px 10px", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.t1, fontSize: 12, fontWeight: 600, fontFamily: SANS, cursor: "pointer", transition: "all .12s" }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = C.bg3; el.style.borderColor = C.borderMd; el.style.color = C.t0; }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.borderColor = C.border; el.style.color = C.t1; }}>
              <span style={{ fontSize: 17, lineHeight: 1, fontWeight: 300 }}>+</span>New runbox
            </button>
          )}
        </div>

        {/* Collapsed icon strip */}
        {collapsed && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "8px 0", overflowY: "auto" }}>
            <button onClick={() => setShowModal(true)} title="New runbox"
              style={{ width: 32, height: 32, borderRadius: 8, background: "transparent", border: `1px solid ${C.border}`, color: C.t2, fontSize: 18, fontWeight: 300, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 4, transition: "all .12s", flexShrink: 0 }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = C.bg3; el.style.borderColor = C.borderMd; el.style.color = C.t1; }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.borderColor = C.border; el.style.color = C.t2; }}>+</button>
            {runboxes.map(rb => {
              const isOn = activeId === rb.id;
              return (
                <div key={rb.id} title={rb.name} onClick={() => onSelect(rb.id)}
                  style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, fontFamily: SANS, transition: "all .12s", background: isOn ? C.tealDim : C.bg2, border: `1px solid ${isOn ? C.tealBorder : C.border}`, color: isOn ? C.tealText : C.t1 }}
                  onMouseEnter={e => { if (!isOn) { const el = e.currentTarget as HTMLElement; el.style.background = C.bg3; el.style.borderColor = C.borderMd; } }}
                  onMouseLeave={e => { if (!isOn) { const el = e.currentTarget as HTMLElement; el.style.background = C.bg2; el.style.borderColor = C.border; } }}>
                  {rb.name.charAt(0).toUpperCase()}
                </div>
              );
            })}
          </div>
        )}

        {/* Expanded list */}
        {!collapsed && (
          <>
            {runboxes.length > 0 && (
              <div style={{ padding: "10px 14px 4px", fontSize: 9, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: C.t2, fontFamily: SANS }}>Runboxes</div>
            )}
            <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px 8px" }}>
              {runboxes.length === 0 && (
                <div style={{ padding: "20px 8px", fontSize: 11, color: C.t2, fontFamily: SANS, lineHeight: 1.7 }}>No runboxes yet.</div>
              )}
              {runboxes.map(rb => {
                const isOn    = activeId === rb.id;
                const liveCwd = cwdMap[rb.id] || rb.cwd;
                return (
                  <div key={rb.id} onClick={() => onSelect(rb.id)}
                    onDoubleClick={() => { setRenaming(rb.id); setRenameVal(rb.name); }}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 9px 7px 12px", marginBottom: 1, cursor: "pointer", background: isOn ? "rgba(255,255,255,.04)" : "transparent", borderLeft: `2px solid ${isOn ? C.t0 : "transparent"}`, borderTop: "none", borderRight: "none", borderBottom: "none", borderRadius: 0, transition: "all .1s" }}
                    onMouseEnter={e => { if (!isOn) { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,.03)"; (e.currentTarget as HTMLElement).style.borderLeftColor = C.t3; } }}
                    onMouseLeave={e => { if (!isOn) { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.borderLeftColor = "transparent"; } }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {renaming === rb.id ? (
                        <input ref={renameRef} value={renameVal} onChange={e => setRenameVal(e.target.value)}
                          onBlur={() => submitRename(rb.id)}
                          onKeyDown={e => { if (e.key === "Enter") submitRename(rb.id); if (e.key === "Escape") setRenaming(null); }}
                          onClick={e => e.stopPropagation()}
                          style={{ background: C.bg4, border: `1px solid ${C.borderHi}`, borderRadius: 5, color: C.t0, fontSize: 12, padding: "2px 6px", width: "100%", outline: "none", fontFamily: MONO }} />
                      ) : (
                        <>
                          <div style={{ fontSize: 13, fontWeight: isOn ? 600 : 400, color: isOn ? C.t0 : C.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: SANS, marginBottom: 2 }}>{rb.name}</div>
                          <div style={{ fontSize: 10, color: C.t3, fontFamily: MONO, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{liveCwd}</div>
                        </>
                      )}
                    </div>
                    {isOn && (
                      <button onClick={e => { e.stopPropagation(); if (confirm(`Delete "${rb.name}"?`)) onDelete(rb.id); }}
                        style={{ ...tbtn, fontSize: 14, flexShrink: 0 }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.redBright}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.t3}>×</button>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ padding: "8px 14px", borderTop: `1px solid ${C.border}`, fontSize: 10, color: C.t3, fontFamily: SANS }}>Double-click to rename</div>
          </>
        )}
      </div>
    </>
  );
}