import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { C, MONO, SANS } from "../shared/constants";
import { IcoOpenEditor } from "../shared/icons";

export function OpenInEditorButton({ path }: { path: string }) {
  const [opening,      setOpening]      = useState(false);
  const [showMenu,     setShowMenu]     = useState(false);
  const [openedEditor, setOpenedEditor] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMenu) return;
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
    };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [showMenu]);

  const openIn = async (editor: "vscode" | "cursor") => {
    setOpening(true); setShowMenu(false); setOpenedEditor(editor === "vscode" ? "VS Code" : "Cursor");
    try { await invoke("open_in_editor", { path, editor }); } catch {}
    setTimeout(() => { setOpening(false); setOpenedEditor(null); }, 1800);
  };

  return (
    <div ref={menuRef} style={{ position: "relative" }}>
      <button
        onClick={e => { e.stopPropagation(); setShowMenu(v => !v); }}
        title="Open in external editor"
        style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 8px", background: C.bg3, border: `1px solid ${C.border}`, borderRadius: 6, cursor: "pointer", color: opening ? C.tealText : C.t1, fontSize: 11, fontFamily: SANS, fontWeight: 500, transition: "all .12s", whiteSpace: "nowrap" }}
        onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = C.borderMd; el.style.color = C.t0; el.style.background = C.bg4; }}
        onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = C.border; el.style.color = opening ? C.tealText : C.t1; el.style.background = C.bg3; }}>
        <IcoOpenEditor />
        {opening ? `Opening in ${openedEditor}…` : "Open in Editor"}
        <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {showMenu && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, background: C.bg2, border: `1px solid ${C.borderMd}`, borderRadius: 9, overflow: "hidden", boxShadow: "0 8px 28px rgba(0,0,0,.55)", minWidth: 170, zIndex: 300, animation: "sbFadeUp .12s cubic-bezier(.2,1,.4,1)" }}>
          <div style={{ padding: "8px 12px 6px", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: C.t2, fontFamily: SANS, marginBottom: 3 }}>Folder</div>
            <div style={{ fontSize: 10, color: C.t1, fontFamily: MONO, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{path}</div>
          </div>
          {([{ id: "vscode" as const, label: "VS Code", hint: "code" }, { id: "cursor" as const, label: "Cursor", hint: "cursor" }]).map(opt => (
            <button key={opt.id} onClick={e => { e.stopPropagation(); openIn(opt.id); }}
              style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 12px", background: "none", border: "none", cursor: "pointer", color: C.t1, fontSize: 12, fontFamily: SANS, textAlign: "left", transition: "all .1s" }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = C.bg3; el.style.color = C.t0; }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "none"; el.style.color = C.t1; }}>
              <span style={{ flex: 1 }}>{opt.label}</span>
              <span style={{ fontSize: 10, color: C.t2, fontFamily: MONO }}>{opt.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}