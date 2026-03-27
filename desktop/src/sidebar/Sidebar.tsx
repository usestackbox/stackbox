// src/sidebar/Sidebar.tsx
import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { MONO, SANS } from "../shared/constants";
import { CreateRunboxModal } from "./CreateRunboxModal";
import type { Runbox } from "../shared/types";
import FileTreePanel from "../panels/FileTreePanel";

// ── Teal-dark palette ─────────────────────────────────────────────────────────
const P = {
  c0: "#2a3a44",   // active item bg
  c2: "#243039",   // hover bg
  c4: "#1a2228",   // badge bg
  c5: "#20292f",   // panel bg
  c6: "#1a2228",   // header/footer bg
  c7: "#101518",   // input bg

  border:   "rgba(255,255,255,.07)",
  borderMd: "rgba(255,255,255,.11)",
  borderHi: "rgba(255,255,255,.18)",

  t0: "rgba(255,255,255,.92)",
  t1: "rgba(255,255,255,.62)",
  t2: "rgba(255,255,255,.38)",
  t3: "rgba(255,255,255,.22)",
  t4: "rgba(255,255,255,.11)",

  red: "#f87171",
};

interface SidebarProps {
  runboxes:          Runbox[];
  activeId:          string | null;
  cwdMap:            Record<string, string>;
  collapsed:         boolean;
  onToggle:          () => void;
  onSelect:          (id: string) => void;
  onCreate:          (name: string, cwd: string, docker: boolean) => void;
  onRename:          (id: string, name: string) => void;
  onDelete:          (id: string) => void;
  fileTreeOpen?:     boolean;
  onFileTreeToggle?: () => void;
  onOpenFile?:       (path: string) => void;
}

interface GitStats { insertions: number; deletions: number; files: number; }

const ICON_GROUPS = [
  { label: "Dev",     icons: ["⚡","🔥","🚀","💻","🖥️","⌨️","🖱️","🔧","🔨","⚙️","🛠️","🔩","💡","🔌","📡"] },
  { label: "Files",   icons: ["📁","📂","🗂️","📄","📝","📋","📊","📈","📉","🗃️","🗄️","💾","💿","📦","🗑️"] },
  { label: "Nature",  icons: ["🌿","🌱","🌲","🌳","🍀","🌻","🌸","🌊","⛰️","🌙","⭐","☀️","❄️","🌈","🔮"] },
  { label: "Objects", icons: ["🎯","🎲","🧩","🔑","🔐","🏆","🎖️","🧲","💎","⚗️","🧪","🔬","🎸","🎨","✏️"] },
  { label: "Symbols", icons: ["✅","❌","⚠️","💬","💭","❓","❗","🔴","🟠","🟡","🟢","🔵","🟣","⚫","⚪"] },
];

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

function useDockerStatus(runboxes: Runbox[]) {
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      for (const rb of runboxes) {
        try {
          const parsed = JSON.parse(await invoke<string>("docker_status", { runboxId: rb.id })) as string;
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

// ── Icon Picker ───────────────────────────────────────────────────────────────
function IconPicker({ anchorX, anchorY, onSelect, onClose }: {
  anchorX: number; anchorY: number;
  onSelect: (icon: string) => void; onClose: () => void;
}) {
  const ref       = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch]           = useState("");
  const [activeGroup, setActiveGroup] = useState(0);

  useEffect(() => { setTimeout(() => searchRef.current?.focus(), 30); }, []);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  const filtered = search.trim()
    ? ICON_GROUPS.flatMap(g => g.icons).filter(ic => ic.includes(search))
    : ICON_GROUPS[activeGroup].icons;

  const W = 260, H = 320;
  const left = Math.min(anchorX, window.innerWidth  - W - 8);
  const top  = Math.min(anchorY, window.innerHeight - H - 8);

  return (
    <div ref={ref} onClick={e => e.stopPropagation()}
      style={{ position: "fixed", left, top, width: W, height: H, background: P.c6, border: `1px solid ${P.borderMd}`, borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,.7)", display: "flex", flexDirection: "column", zIndex: 99999, overflow: "hidden" }}>
      <div style={{ padding: "10px 10px 6px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: P.c7, border: `1px solid ${P.border}`, borderRadius: 8, padding: "5px 10px" }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={P.t3} strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search icons…"
            style={{ background: "none", border: "none", outline: "none", color: P.t0, fontSize: 12, fontFamily: SANS, flex: 1 }} />
        </div>
      </div>
      {!search && (
        <div style={{ display: "flex", gap: 2, padding: "0 10px 6px", flexShrink: 0, overflowX: "auto" }}>
          {ICON_GROUPS.map((g, i) => (
            <button key={g.label} onClick={() => setActiveGroup(i)}
              style={{ border: "none", cursor: "pointer", borderRadius: 6, padding: "3px 9px", fontSize: 10, fontFamily: MONO, fontWeight: 700, letterSpacing: ".08em", whiteSpace: "nowrap", background: activeGroup === i ? P.c0 : "transparent", color: activeGroup === i ? P.t0 : P.t3, transition: "all .12s" }}>
              {g.label}
            </button>
          ))}
        </div>
      )}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 10px 10px", display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 4, alignContent: "start" }}>
        {filtered.map((icon, i) => (
          <button key={i} onClick={() => { onSelect(icon); onClose(); }}
            style={{ border: "none", cursor: "pointer", borderRadius: 8, fontSize: 20, lineHeight: 1, padding: "6px 0", background: "transparent", transition: "background .1s, transform .1s", display: "flex", alignItems: "center", justifyContent: "center" }}
            onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = P.c2; el.style.transform = "scale(1.15)"; }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.transform = "scale(1)"; }}>
            {icon}
          </button>
        ))}
        {filtered.length === 0 && <div style={{ gridColumn: "1/-1", padding: "20px 0", textAlign: "center", color: P.t3, fontSize: 11, fontFamily: SANS }}>No icons found</div>}
      </div>
    </div>
  );
}

// ── Context Menu ──────────────────────────────────────────────────────────────
function ContextMenu({ x, y, rbName, onDelete, onChangeIcon, onClose }: {
  x: number; y: number; rbName: string;
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

  const left = Math.min(x, window.innerWidth  - 200 - 12);
  const top  = Math.min(y, window.innerHeight - 130);

  const items = [
    {
      label: "Change icon", danger: false,
      action: () => { onChangeIcon(); onClose(); },
      icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>,
    },
    {
      label: "Delete runbox", danger: true,
      action: () => { onDelete(); onClose(); },
      icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>,
    },
  ];

  return (
    <div ref={ref} onClick={e => e.stopPropagation()} style={{ position: "fixed", left, top, width: 200, background: P.c6, border: `1px solid ${P.border}`, borderRadius: 12, boxShadow: "0 16px 48px rgba(0,0,0,.7)", zIndex: 99998, overflow: "hidden", padding: "5px", opacity: visible ? 1 : 0, transform: visible ? "scale(1) translateY(0)" : "scale(.95) translateY(-4px)", transformOrigin: "top left", transition: "opacity .15s ease, transform .15s cubic-bezier(.16,1,.3,1)" }}>
      <div style={{ padding: "5px 10px", fontSize: 9, fontFamily: MONO, fontWeight: 700, letterSpacing: ".12em", color: P.t3, userSelect: "none" }}>
        {rbName.toUpperCase()}
      </div>
      <div style={{ height: 1, background: P.border, margin: "0 0 4px" }} />
      {items.map((item, i) => (
        <button key={i} onClick={item.action}
          style={{ width: "100%", border: "none", cursor: "pointer", background: "transparent", borderRadius: 8, display: "flex", alignItems: "center", gap: 9, padding: "7px 10px", textAlign: "left", color: item.danger ? "rgba(248,113,113,.85)" : P.t1, fontSize: 12, fontFamily: SANS, transition: "background .08s, color .08s" }}
          onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = item.danger ? "rgba(248,113,113,.10)" : P.c2; el.style.color = item.danger ? P.red : P.t0; }}
          onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.color = item.danger ? "rgba(248,113,113,.85)" : P.t1; }}>
          <span style={{ opacity: .55, display: "flex", alignItems: "center", flexShrink: 0 }}>{item.icon}</span>
          {item.label}
        </button>
      ))}
    </div>
  );
}

// ── Runbox row ────────────────────────────────────────────────────────────────
function RunboxRow({ rb, isOn, gitStats, dockerStatus, customIcon, onSelect, onRename, onDelete, onContextMenu }: {
  rb: Runbox; isOn: boolean; gitStats?: GitStats; dockerStatus?: string;
  customIcon?: string;
  onSelect: () => void; onRename: (name: string) => void;
  onDelete: () => void; onContextMenu: (e: React.MouseEvent) => void;
}) {
  const [renaming,  setRenaming]  = useState(false);
  const [renameVal, setRenameVal] = useState(rb.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setRenameVal(rb.name); }, [rb.name]);
  useEffect(() => { if (renaming) setTimeout(() => inputRef.current?.select(), 20); }, [renaming]);

  const submitRename = () => {
    if (renameVal.trim() && renameVal.trim() !== rb.name) onRename(renameVal.trim());
    setRenaming(false);
  };

  const hasGit  = gitStats && (gitStats.insertions + gitStats.deletions) > 0;
  const dirName = rb.cwd.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? rb.cwd;

  return (
    <div
      onClick={onSelect}
      onDoubleClick={() => { setRenaming(true); setRenameVal(rb.name); }}
      onContextMenu={onContextMenu}
      style={{
        borderRadius: 10, marginBottom: 4, cursor: "pointer",
        background: isOn ? P.c0 : "transparent",
        border: `1px solid ${isOn ? P.borderMd : "transparent"}`,
        padding: "10px 12px",
        transition: "all .12s", userSelect: "none",
      }}
      onMouseEnter={e => { if (!isOn) (e.currentTarget as HTMLElement).style.background = P.c2; }}
      onMouseLeave={e => { if (!isOn) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>

      {/* Top row: icon + name + delete */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {customIcon ? (
          <span style={{ fontSize: 14, lineHeight: 1, flexShrink: 0 }}>{customIcon}</span>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke={isOn ? "#4ade80" : P.t2}
            strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
            style={{ flexShrink: 0 }}>
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          {renaming ? (
            <input ref={inputRef} value={renameVal}
              onChange={e => setRenameVal(e.target.value)}
              onBlur={submitRename}
              onKeyDown={e => {
                if (e.key === "Enter")  { e.preventDefault(); submitRename(); }
                if (e.key === "Escape") { setRenaming(false); setRenameVal(rb.name); }
              }}
              onClick={e => e.stopPropagation()}
              style={{ background: P.c7, border: `1px solid ${P.borderHi}`, borderRadius: 6, color: P.t0, fontSize: 12, padding: "2px 7px", width: "100%", outline: "none", fontFamily: MONO }} />
          ) : (
            <span style={{ fontSize: 13, fontFamily: SANS, fontWeight: isOn ? 600 : 500, color: isOn ? "#ffffff" : P.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>
              {rb.name}
            </span>
          )}
        </div>

        {isOn && !renaming && (
          <button
            onClick={e => { e.stopPropagation(); if (confirm(`Delete "${rb.name}"?`)) onDelete(); }}
            style={{ background: "transparent", border: "none", cursor: "pointer", color: P.t3, fontSize: 15, lineHeight: 1, flexShrink: 0, padding: "0 2px", borderRadius: 4, transition: "color .1s", display: "flex", alignItems: "center" }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = P.red}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = P.t3}>
            ×
          </button>
        )}
      </div>

      {/* Bottom row: dir + git + docker */}
      {!renaming && (
        <div style={{ paddingLeft: 21, marginTop: 6, display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ fontSize: 10, fontFamily: MONO, color: P.t3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}>
            {dirName}
          </span>

          {hasGit && (
            <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={P.t3} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
                <path d="M18 9a9 9 0 0 1-9 9"/>
              </svg>
              {gitStats!.insertions > 0 && (
                <span style={{ fontSize: 10, fontFamily: MONO, color: "#4ade80", fontWeight: 600 }}>+{gitStats!.insertions}</span>
              )}
              {gitStats!.deletions > 0 && (
                <span style={{ fontSize: 10, fontFamily: MONO, color: "#f87171", fontWeight: 600 }}>-{gitStats!.deletions}</span>
              )}
            </div>
          )}

          {dockerStatus === "running" && (
            <div style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0, padding: "1px 5px", borderRadius: 5, background: "rgba(56,189,248,.08)", border: "1px solid rgba(56,189,248,.18)" }}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="8" width="4" height="3" rx=".5"/><rect x="7" y="8" width="4" height="3" rx=".5"/>
                <rect x="12" y="8" width="4" height="3" rx=".5"/><rect x="7" y="4" width="4" height="3" rx=".5"/>
                <rect x="12" y="4" width="4" height="3" rx=".5"/>
                <path d="M2 13s1 2.5 8 2.5 12-2.5 12-2.5"/>
              </svg>
              <span style={{ fontSize: 9, fontFamily: MONO, color: "#38bdf8" }}>docker</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Sidebar ──────────────────────────────────────────────────────────────
const TOOLBAR_H = 42;
const PANEL_W   = 220;

export function Sidebar({
  runboxes, activeId, cwdMap, collapsed,
  onToggle, onSelect, onCreate, onRename, onDelete,
  fileTreeOpen, onFileTreeToggle, onOpenFile,
}: SidebarProps) {
  const [showModal,  setShowModal]  = useState(false);
  const [icons,      setIcons]      = useState<Record<string, string>>({});
  const [ctxMenu,    setCtxMenu]    = useState<{ x: number; y: number; id: string } | null>(null);
  const [iconPicker, setIconPicker] = useState<{ x: number; y: number; id: string } | null>(null);
  const gitStats     = useGitStats(runboxes, cwdMap);
  const dockerStatus = useDockerStatus(runboxes);

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
          rbName={runboxes.find(r => r.id === ctxMenu.id)?.name ?? ""}
          onDelete={() => { const rb = runboxes.find(r => r.id === ctxMenu.id); if (rb && confirm(`Delete "${rb.name}"?`)) onDelete(ctxMenu.id); }}
          onChangeIcon={() => setIconPicker({ x: ctxMenu.x, y: ctxMenu.y, id: ctxMenu.id })}
          onClose={() => setCtxMenu(null)}
        />
      )}
      {iconPicker && (
        <IconPicker
          anchorX={iconPicker.x} anchorY={iconPicker.y}
          onSelect={icon => setIcons(prev => ({ ...prev, [iconPicker.id]: icon }))}
          onClose={() => setIconPicker(null)}
        />
      )}

      {/* ── Floating panel ── */}
      <div style={{
        position: "fixed", left: 8, top: TOOLBAR_H + 8, bottom: 8, width: PANEL_W,
        background: P.c5, border: `1px solid ${P.border}`, borderRadius: 10,
        display: "flex", flexDirection: "column",
        transform: collapsed ? `translateX(-${PANEL_W + 24}px)` : "translateX(0)",
        opacity: collapsed ? 0 : 1,
        transition: "transform .18s cubic-bezier(.4,0,.2,1), opacity .15s ease",
        zIndex: 200,
        boxShadow: collapsed ? "none" : "0 8px 40px rgba(0,0,0,.65), 0 2px 8px rgba(0,0,0,.4)",
        pointerEvents: collapsed ? "none" : "all",
        overflow: "hidden",
      }}>

        {fileTreeOpen ? (
          /* ── File tree view ── */
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* File tree header with back button */}
            
            <FileTreePanel
              cwd={runboxes.find(r => r.id === activeId)?.cwd ?? "~"}
              onClose={() => onFileTreeToggle?.()}
              onOpenFile={(path) => onOpenFile?.(path)}
            />
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={{ height: 42, padding: "0 10px 0 14px", flexShrink: 0, borderBottom: `1px solid ${P.border}`, display: "flex", alignItems: "center", gap: 8, background: P.c6 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={P.t2} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
              </svg>
              <span style={{ flex: 1, fontSize: 11, fontWeight: 700, letterSpacing: ".09em", fontFamily: MONO, color: P.t2, userSelect: "none" }}>WORKSPACE</span>
              {runboxes.length > 0 && (
                <span style={{ fontSize: 9, fontFamily: MONO, fontWeight: 700, color: P.t3, background: P.c4, border: `1px solid ${P.border}`, borderRadius: 5, padding: "1px 6px" }}>
                  {runboxes.length}
                </span>
              )}
              <button onClick={() => setShowModal(true)} title="New runbox"
                style={{ background: "transparent", border: "none", cursor: "pointer", color: P.t2, borderRadius: 6, width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", padding: 0, transition: "background .1s, color .1s", flexShrink: 0 }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = P.c2; el.style.color = P.t0; }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.color = P.t2; }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </button>
            </div>

            {/* Rows */}
            <div style={{ flex: 1, overflowY: "auto", padding: "6px 8px 10px" }}>
              {runboxes.map(rb => (
                <RunboxRow
                  key={rb.id}
                  rb={rb}
                  isOn={activeId === rb.id}
                  gitStats={gitStats[rb.id]}
                  dockerStatus={dockerStatus[rb.id]}
                  customIcon={icons[rb.id]}
                  onSelect={() => onSelect(rb.id)}
                  onRename={name => onRename(rb.id, name)}
                  onDelete={() => onDelete(rb.id)}
                  onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, id: rb.id }); }}
                />
              ))}

              {runboxes.length === 0 && (
                <div style={{ padding: "32px 8px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={P.t4} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                  <span style={{ fontSize: 11, color: P.t3, fontFamily: SANS, textAlign: "center", lineHeight: 1.6 }}>No runboxes yet</span>
                  <button onClick={() => setShowModal(true)}
                    style={{ padding: "7px 16px", borderRadius: 8, background: "transparent", border: `1px solid ${P.borderMd}`, color: P.t1, fontSize: 11, fontFamily: SANS, cursor: "pointer", transition: "all .12s" }}
                    onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = P.c2; el.style.color = P.t0; }}
                    onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.color = P.t1; }}>
                    + New runbox
                  </button>
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: "6px 12px", borderTop: `1px solid ${P.border}`, fontSize: 10, color: P.t4, fontFamily: MONO, background: P.c6, flexShrink: 0, letterSpacing: ".04em" }}>
              Double-click to rename · Right-click for options
            </div>
          </>
        )}
      </div>
    </>
  );
}