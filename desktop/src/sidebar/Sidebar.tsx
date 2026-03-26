// src/sidebar/Sidebar.tsx
import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
  onCreate:  (name: string, cwd: string, docker: boolean) => void;
  onRename:  (id: string, name: string) => void;
  onDelete:  (id: string) => void;
}

interface GitStats {
  insertions: number;
  deletions:  number;
  files:      number;
}

// ── Available icons ───────────────────────────────────────────────────────────
const ICON_GROUPS = [
  { label: "Dev",     icons: ["⚡","🔥","🚀","💻","🖥️","⌨️","🖱️","🔧","🔨","⚙️","🛠️","🔩","💡","🔌","📡"] },
  { label: "Files",   icons: ["📁","📂","🗂️","📄","📝","📋","📊","📈","📉","🗃️","🗄️","💾","💿","📦","🗑️"] },
  { label: "Nature",  icons: ["🌿","🌱","🌲","🌳","🍀","🌻","🌸","🌊","⛰️","🌙","⭐","☀️","❄️","🌈","🔮"] },
  { label: "Objects", icons: ["🎯","🎲","🧩","🔑","🔐","🏆","🎖️","🧲","💎","⚗️","🧪","🔬","🎸","🎨","✏️"] },
  { label: "Symbols", icons: ["✅","❌","⚠️","💬","💭","❓","❗","🔴","🟠","🟡","🟢","🔵","🟣","⚫","⚪"] },
];

// ── Git stats hook ────────────────────────────────────────────────────────────
function useGitStats(runboxes: Runbox[], cwdMap: Record<string, string>) {
  const [stats, setStats] = useState<Record<string, GitStats>>({});
  useEffect(() => {
    runboxes.forEach(async rb => {
      const cwd = cwdMap[rb.id] ?? rb.cwd;
      try {
        const files = await invoke<any[]>("git_diff_live", { cwd, runboxId: rb.id });
        const ins = files.reduce((s: number, f: any) => s + (f.insertions ?? 0), 0);
        const del = files.reduce((s: number, f: any) => s + (f.deletions  ?? 0), 0);
        if (ins + del > 0) setStats(prev => ({ ...prev, [rb.id]: { insertions: ins, deletions: del, files: files.length } }));
      } catch { /**/ }
    });
  }, [runboxes.map(r => r.id).join(",")]);

  useEffect(() => {
    const unsub = listen<any[]>("git:live-diff", ({ payload }) => {
      if (!payload?.length) return;
      runboxes.forEach(rb => {
        const ins = payload.reduce((s: number, f: any) => s + (f.insertions ?? 0), 0);
        const del = payload.reduce((s: number, f: any) => s + (f.deletions  ?? 0), 0);
        setStats(prev => ({ ...prev, [rb.id]: { insertions: ins, deletions: del, files: payload.length } }));
      });
    });
    return () => { unsub.then(f => f()); };
  }, [runboxes.map(r => r.id).join(",")]);

  return stats;
}

// ── Docker status hook ────────────────────────────────────────────────────────
function useDockerStatus(runboxes: Runbox[]) {
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      for (const rb of runboxes) {
        try {
          const s = await invoke<string>("docker_status", { runboxId: rb.id });
          const parsed = JSON.parse(s) as string;
          if (alive) setStatuses(prev => ({ ...prev, [rb.id]: parsed }));
        } catch { /**/ }
      }
    };
    poll();
    const t = setInterval(poll, 8000);
    return () => { alive = false; clearInterval(t); };
  }, [runboxes.map(r => r.id).join(",")]);
  return statuses;
}

// ── Git badge ─────────────────────────────────────────────────────────────────
function GitBadge({ stats }: { stats: GitStats }) {
  if (stats.insertions === 0 && stats.deletions === 0) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5, paddingLeft: 15 }}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
        <path d="M18 9a9 9 0 0 1-9 9"/>
      </svg>
      {stats.insertions > 0 && <span style={{ fontSize: 11, fontFamily: MONO, color: "#4ade80", fontWeight: 600 }}>+{stats.insertions}</span>}
      {stats.deletions  > 0 && <span style={{ fontSize: 11, fontFamily: MONO, color: "#f87171", fontWeight: 600 }}>-{stats.deletions}</span>}
    </div>
  );
}

// ── Icon Picker ───────────────────────────────────────────────────────────────
function IconPicker({ anchorX, anchorY, onSelect, onClose }: {
  anchorX: number; anchorY: number;
  onSelect: (icon: string) => void;
  onClose:  () => void;
}) {
  const ref        = useRef<HTMLDivElement>(null);
  const searchRef  = useRef<HTMLInputElement>(null);
  const [search,      setSearch]      = useState("");
  const [activeGroup, setActiveGroup] = useState(0);

  useEffect(() => { setTimeout(() => searchRef.current?.focus(), 30); }, []);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  const filteredIcons = search.trim()
    ? ICON_GROUPS.flatMap(g => g.icons).filter(ic => ic.includes(search))
    : ICON_GROUPS[activeGroup].icons;

  const W = 260, H = 320;
  const left = Math.min(anchorX, window.innerWidth  - W - 8);
  const top  = Math.min(anchorY, window.innerHeight - H - 8);

  return (
    <div ref={ref} style={{ position: "fixed", left, top, width: W, height: H, background: "#1a1a1e", border: "1px solid rgba(255,255,255,.12)", borderRadius: 14, boxShadow: "0 20px 60px rgba(0,0,0,.7)", display: "flex", flexDirection: "column", zIndex: 99999, overflow: "hidden" }}
      onClick={e => e.stopPropagation()}>
      <div style={{ padding: "10px 10px 6px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 9, padding: "5px 10px" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="2.5" strokeLinecap="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search icons…"
            style={{ background: "none", border: "none", outline: "none", color: "#fff", fontSize: 12, fontFamily: SANS, flex: 1, caretColor: "#7c6dfa" }} />
        </div>
      </div>
      {!search && (
        <div style={{ display: "flex", gap: 2, padding: "0 10px 6px", flexShrink: 0, overflowX: "auto" }}>
          {ICON_GROUPS.map((g, i) => (
            <button key={g.label} onClick={() => setActiveGroup(i)}
              style={{ border: "none", cursor: "pointer", borderRadius: 7, padding: "3px 9px", fontSize: 10, fontFamily: MONO, fontWeight: 700, letterSpacing: ".08em", whiteSpace: "nowrap", background: activeGroup === i ? "rgba(124,109,250,.25)" : "transparent", color: activeGroup === i ? "#a89dff" : "rgba(255,255,255,.35)", transition: "all .12s" }}>
              {g.label}
            </button>
          ))}
        </div>
      )}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 10px 10px", display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 4, alignContent: "start" }}>
        {filteredIcons.map((icon, i) => (
          <button key={i} onClick={() => { onSelect(icon); onClose(); }} title={icon}
            style={{ border: "none", cursor: "pointer", borderRadius: 8, fontSize: 20, lineHeight: 1, padding: "6px 0", background: "transparent", transition: "background .1s, transform .1s", display: "flex", alignItems: "center", justifyContent: "center" }}
            onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = "rgba(255,255,255,.09)"; el.style.transform = "scale(1.15)"; }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.transform = "scale(1)"; }}>
            {icon}
          </button>
        ))}
        {filteredIcons.length === 0 && (
          <div style={{ gridColumn: "1 / -1", padding: "20px 0", textAlign: "center", color: "rgba(255,255,255,.25)", fontSize: 11, fontFamily: SANS }}>No icons found</div>
        )}
      </div>
    </div>
  );
}

// ── Context Menu ──────────────────────────────────────────────────────────────
function ContextMenu({ x, y, rbId, rbName, onDelete, onChangeIcon, onClose }: {
  x: number; y: number; rbId: string; rbName: string;
  onDelete: () => void; onChangeIcon: () => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => { const t = setTimeout(() => setVisible(true), 10); return () => clearTimeout(t); }, []);
  useEffect(() => {
    const h   = (e: MouseEvent)    => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", esc); };
  }, [onClose]);

  const W    = 200;
  const left = Math.min(x, window.innerWidth  - W - 12);
  const top  = Math.min(y, window.innerHeight - 140);

  const IcoPalette = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/>
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/>
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>
    </svg>
  );
  const IcoTrash = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
      <path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
    </svg>
  );

  const items = [
    { label: "Change icon",   Icon: IcoPalette, danger: false, action: () => { onChangeIcon(); onClose(); } },
    { label: "Delete runbox", Icon: IcoTrash,   danger: true,  action: () => { onDelete();     onClose(); } },
  ];

  return (
    <div ref={ref} onClick={e => e.stopPropagation()} style={{
      position: "fixed", left, top, width: W,
      background: "rgba(18,18,22,0.96)", backdropFilter: "blur(20px)",
      border: "1px solid rgba(255,255,255,.09)", borderRadius: 14,
      boxShadow: "0 12px 28px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.06)",
      zIndex: 99998, overflow: "hidden", padding: "5px",
      opacity: visible ? 1 : 0,
      transform: visible ? "scale(1) translateY(0)" : "scale(0.95) translateY(-4px)",
      transformOrigin: "top left",
      transition: "opacity .15s ease, transform .15s cubic-bezier(.16,1,.3,1)",
    }}>
      <div style={{ padding: "6px 10px 5px", fontSize: 10, fontFamily: MONO, fontWeight: 700, letterSpacing: ".1em", color: "rgba(255,255,255,.2)", userSelect: "none" }}>
        {rbName.toUpperCase()}
      </div>
      <div style={{ height: 1, background: "rgba(255,255,255,.06)", margin: "0 0 4px" }} />
      {items.map((item, i) => (
        <button key={i} onClick={item.action}
          style={{ width: "100%", border: "none", cursor: "pointer", background: "transparent", borderRadius: 9, display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", textAlign: "left", color: item.danger ? "rgba(251,100,100,.9)" : "rgba(255,255,255,.75)", fontSize: 13, fontFamily: SANS, transition: "background .08s, color .08s" }}
          onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = item.danger ? "rgba(251,100,100,.1)" : "rgba(255,255,255,.06)"; el.style.color = item.danger ? "rgba(255,110,110,1)" : "rgba(255,255,255,.95)"; }}
          onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.color = item.danger ? "rgba(251,100,100,.9)" : "rgba(255,255,255,.75)"; }}>
          <span style={{ opacity: item.danger ? 0.85 : 0.55, display: "flex", alignItems: "center", flexShrink: 0 }}><item.Icon /></span>
          {item.label}
        </button>
      ))}
    </div>
  );
}

// ── Main Sidebar ──────────────────────────────────────────────────────────────
export function Sidebar({
  runboxes, activeId, cwdMap, collapsed,
  onToggle, onSelect, onCreate, onRename, onDelete,
}: SidebarProps) {
  const [showModal,  setShowModal]  = useState(false);
  const [renaming,   setRenaming]   = useState<string | null>(null);
  const [renameVal,  setRenameVal]  = useState("");
  const [icons,      setIcons]      = useState<Record<string, string>>({});
  const [ctxMenu,    setCtxMenu]    = useState<{ x: number; y: number; id: string } | null>(null);
  const [iconPicker, setIconPicker] = useState<{ x: number; y: number; id: string } | null>(null);
  const renameRef    = useRef<HTMLInputElement>(null);
  const gitStats     = useGitStats(runboxes, cwdMap);
  const dockerStatus = useDockerStatus(runboxes);

  useEffect(() => { if (renaming) setTimeout(() => renameRef.current?.select(), 30); }, [renaming]);

  const submitRename = (id: string) => {
    if (renameVal.trim()) onRename(id, renameVal.trim());
    setRenaming(null);
  };

  const handleContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault(); e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, id });
  };

  const handleSetIcon = (id: string, icon: string) => setIcons(prev => ({ ...prev, [id]: icon }));

  const W = collapsed ? 52 : 220;

  return (
    <>
      {showModal && (
        <CreateRunboxModal
          onSubmit={(n, c, d) => { onCreate(n, c, d); setShowModal(false); }}
          onClose={() => setShowModal(false)}
        />
      )}

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x} y={ctxMenu.y}
          rbId={ctxMenu.id}
          rbName={runboxes.find(r => r.id === ctxMenu.id)?.name ?? ""}
          onDelete={() => {
            const rb = runboxes.find(r => r.id === ctxMenu.id);
            if (rb && confirm(`Delete "${rb.name}"?`)) onDelete(ctxMenu.id);
          }}
          onChangeIcon={() => setIconPicker({ x: ctxMenu.x, y: ctxMenu.y, id: ctxMenu.id })}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {iconPicker && (
        <IconPicker
          anchorX={iconPicker.x} anchorY={iconPicker.y}
          onSelect={icon => handleSetIcon(iconPicker.id, icon)}
          onClose={() => setIconPicker(null)}
        />
      )}

      <div style={{ width: W, flexShrink: 0, background: C.bg1, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", transition: "width .18s cubic-bezier(.4,0,.2,1)", overflow: "hidden" }}>

        {/* Header */}
        <div style={{
          height: 48, flexShrink: 0,
          display: "flex", alignItems: "center",
          padding: collapsed ? "0 8px" : "0 10px 0 14px",
          justifyContent: collapsed ? "center" : "space-between",
          borderBottom: `1px solid ${C.border}`, gap: 4,
        }}>
          {!collapsed && (
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".14em", color: C.t0, fontFamily: MONO, userSelect: "none", flex: 1 }}>
              STACKBOX
            </span>
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
              style={{ width: "100%", height: 34, borderRadius: 10, background: "transparent", border: `1px solid ${C.border}`, color: C.t2, fontSize: 18, fontWeight: 300, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all .12s" }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = C.bg3; el.style.borderColor = C.borderMd; el.style.color = C.t0; }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.borderColor = C.border; el.style.color = C.t2; }}>
              +
            </button>
          ) : (
            <button onClick={() => setShowModal(true)}
              style={{ width: "100%", height: 34, borderRadius: 10, background: "transparent", border: `1px solid ${C.border}`, color: C.t1, fontSize: 12, fontFamily: SANS, cursor: "pointer", transition: "all .12s", display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = C.bg3; el.style.borderColor = C.borderMd; el.style.color = C.t0; }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.borderColor = C.border; el.style.color = C.t1; }}>
              <span style={{ fontSize: 16, fontWeight: 300, lineHeight: 1 }}>+</span>
              New runbox
            </button>
          )}
        </div>

        {/* Runboxes label */}
        {!collapsed && runboxes.length > 0 && (
          <div style={{ padding: "6px 10px 5px", flexShrink: 0 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 9, fontWeight: 700, letterSpacing: ".13em", fontFamily: MONO, color: "rgba(255,255,255,.55)", background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.09)", borderRadius: 5, padding: "2px 7px 2px 6px" }}>
              <span style={{ width: 4, height: 4, borderRadius: "50%", background: "rgba(255,255,255,.4)", display: "inline-block", flexShrink: 0 }} />
              RUNBOXES
            </span>
          </div>
        )}

        {/* Runbox list */}
        <div style={{ flex: 1, overflowY: "auto", padding: collapsed ? "4px 8px" : "4px 10px 10px" }}>
          {runboxes.map(rb => {
            const isOn   = activeId === rb.id;
            const gs     = gitStats[rb.id];
            const rbIcon = icons[rb.id] ?? null;
            const docker = dockerStatus[rb.id];

            if (collapsed) return (
              <div key={rb.id} title={rb.name}
                onClick={() => onSelect(rb.id)}
                onContextMenu={e => handleContextMenu(e, rb.id)}
                style={{ width: 36, height: 36, borderRadius: 10, margin: "3px auto", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: rbIcon ? 18 : 12, fontWeight: 700, fontFamily: SANS, transition: "all .12s", background: isOn ? C.bg4 : "transparent", border: `1px solid ${isOn ? C.borderMd : "transparent"}`, color: isOn ? C.t0 : C.t2, position: "relative" }}
                onMouseEnter={e => { if (!isOn) { const el = e.currentTarget as HTMLElement; el.style.background = C.bg3; el.style.color = C.t1; } }}
                onMouseLeave={e => { if (!isOn) { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.color = C.t2; } }}>
                {rbIcon ?? rb.name.charAt(0).toUpperCase()}
                {gs && (gs.insertions + gs.deletions) > 0 && (
                  <span style={{ position: "absolute", top: 4, right: 4, width: 5, height: 5, borderRadius: "50%", background: "#4ade80" }} />
                )}
                {docker === "running" && (
                  <span style={{ position: "absolute", bottom: 4, right: 4, width: 5, height: 5, borderRadius: "50%", background: "#00e5ff", boxShadow: "0 0 4px #00e5ff" }} />
                )}
              </div>
            );

            return (
              <div key={rb.id}
                onClick={() => onSelect(rb.id)}
                onDoubleClick={() => { setRenaming(rb.id); setRenameVal(rb.name); }}
                onContextMenu={e => handleContextMenu(e, rb.id)}
                style={{ marginBottom: 3, cursor: "pointer", borderRadius: 10, background: isOn ? C.bg3 : "transparent", border: `1px solid ${isOn ? C.borderMd : "transparent"}`, transition: "all .1s", padding: "6px 10px 8px" }}
                onMouseEnter={e => { if (!isOn) (e.currentTarget as HTMLElement).style.background = C.bg2; }}
                onMouseLeave={e => { if (!isOn) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>

                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  {rbIcon ? (
                    <span style={{ fontSize: 16, lineHeight: 1, flexShrink: 0, userSelect: "none" }}>{rbIcon}</span>
                  ) : (
                    <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: isOn ? C.t0 : C.t3, boxShadow: isOn ? "0 0 6px rgba(255,255,255,.4)" : "none", transition: "all .2s" }} />
                  )}

                  <div style={{ flex: 1, minWidth: 0 }}>
                    {renaming === rb.id ? (
                      <input ref={renameRef} value={renameVal}
                        onChange={e => setRenameVal(e.target.value)}
                        onBlur={() => submitRename(rb.id)}
                        onKeyDown={e => { if (e.key === "Enter") submitRename(rb.id); if (e.key === "Escape") setRenaming(null); }}
                        onClick={e => e.stopPropagation()}
                        style={{ background: C.bg5, border: `1px solid ${C.borderHi}`, borderRadius: 6, color: C.t0, fontSize: 12, padding: "2px 7px", width: "100%", outline: "none", fontFamily: MONO }} />
                    ) : (
                      <span style={{ fontSize: 13, fontFamily: SANS, fontWeight: isOn ? 600 : 400, color: isOn ? C.t0 : C.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>
                        {rb.name}
                      </span>
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

                {gs && (gs.insertions + gs.deletions) > 0 && <GitBadge stats={gs} />}

                {docker === "running" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 4, paddingLeft: 15 }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#00e5ff", boxShadow: "0 0 4px #00e5ff", display: "inline-block", flexShrink: 0 }} />
                    <span style={{ fontSize: 10, fontFamily: MONO, color: "#00e5ff", opacity: .7 }}>docker</span>
                  </div>
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
            Double-click to rename · Right-click for options
          </div>
        )}
      </div>
    </>
  );
}