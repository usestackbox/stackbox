import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { C, MONO, SANS, tbtn } from "../shared/constants";

function StatefulInput({ inputRef, ...props }: React.InputHTMLAttributes<HTMLInputElement> & {
  inputRef?: React.RefObject<HTMLInputElement>;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <input ref={inputRef} {...props}
      style={{ background: C.bg0, border: `1px solid ${focused ? C.borderHi : C.border}`, borderRadius: 8, color: C.t0, fontSize: 12, padding: "9px 11px", outline: "none", fontFamily: MONO, width: "100%", boxSizing: "border-box" as const, transition: "border-color .15s", ...(props.style ?? {}) }}
      onFocus={e => { setFocused(true); props.onFocus?.(e); }}
      onBlur={e  => { setFocused(false); props.onBlur?.(e); }}
    />
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: C.t2, fontFamily: SANS }}>{label}</span>
        {hint && <span style={{ fontSize: 10, color: C.t2, fontFamily: SANS }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

interface Props {
  onSubmit: (name: string, cwd: string) => void;
  onClose:  () => void;
}

export function CreateRunboxModal({ onSubmit, onClose }: Props) {
  const [name,     setName]     = useState("");
  const [cwd,      setCwd]      = useState("~/");
  const [creating, setCreating] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => nameRef.current?.focus(), 40); }, []);

  const submit = async () => {
    if (creating) return;
    setCreating(true);
    try { onSubmit(name.trim() || "untitled", cwd.trim() || "~/"); }
    finally { setCreating(false); }
  };

  const kd = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") submit();
    if (e.key === "Escape") onClose();
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.62)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: 420, background: C.bg2, border: `1px solid ${C.borderMd}`, borderRadius: 14, boxShadow: "0 32px 80px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.05)", animation: "sbFadeUp .16s cubic-bezier(.2,1,.4,1)", overflow: "hidden" }}>
        <div style={{ padding: "13px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.t0, fontFamily: SANS }}>New runbox</span>
          <button onClick={onClose} style={{ ...tbtn, fontSize: 17 }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.t0}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.t2}>×</button>
        </div>
        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Name">
            <StatefulInput inputRef={nameRef} value={name} onChange={e => setName(e.target.value)} onKeyDown={kd} placeholder="my-feature" />
          </Field>
          <Field label="Directory">
            <div style={{ display: "flex", gap: 6 }}>
              <StatefulInput value={cwd} onChange={e => setCwd(e.target.value)} onKeyDown={kd} placeholder="~/my-project" style={{ flex: 1 } as any} />
              <button type="button" title="Browse folder"
                onClick={async () => { try { const d = await invoke<string | null>("open_directory_dialog"); if (d) setCwd(d); } catch {} }}
                style={{ width: 36, height: 36, flexShrink: 0, background: C.bg3, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: C.t2, transition: "all .15s" }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = C.borderHi; el.style.color = C.t0; el.style.background = C.bg4; }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = C.border; el.style.color = C.t2; el.style.background = C.bg3; }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
              </button>
            </div>
          </Field>
          <button onClick={submit} disabled={creating}
            style={{ marginTop: 4, padding: "10px 0", background: creating ? C.bg4 : C.t0, border: "none", borderRadius: 9, color: creating ? C.t2 : C.bg0, fontSize: 13, fontWeight: 700, cursor: creating ? "default" : "pointer", fontFamily: SANS, transition: "opacity .15s" }}
            onMouseEnter={e => { if (!creating) (e.currentTarget as HTMLElement).style.opacity = ".87"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}>
            {creating ? "Creating…" : "Launch →"}
          </button>
        </div>
      </div>
    </div>
  );
}