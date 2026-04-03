// sidebar/CreateWorkspaceModal.tsx
import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { C, FS, MONO, SANS } from "../design";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: FS.xs, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: C.t2, fontFamily: SANS }}>
        {label}
      </span>
      {children}
    </div>
  );
}

function StyledInput({ inputRef, ...props }: React.InputHTMLAttributes<HTMLInputElement> & {
  inputRef?: React.RefObject<HTMLInputElement>;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      ref={inputRef}
      {...props}
      style={{
        background: C.bg0, border: `1px solid ${focused ? C.borderHi : C.border}`,
        borderRadius: C.r2, color: C.t0, fontSize: FS.md,
        padding: "9px 11px", outline: "none", fontFamily: MONO,
        width: "100%", boxSizing: "border-box", transition: "border-color .15s",
        ...(props.style ?? {}),
      }}
      onFocus={e => { setFocused(true); props.onFocus?.(e); }}
      onBlur={e  => { setFocused(false); props.onBlur?.(e); }}
    />
  );
}

interface Props {
  onSubmit: (name: string, cwd: string) => void;
  onClose:  () => void;
}

export function CreateWorkspaceModal({ onSubmit, onClose }: Props) {
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
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,.62)", backdropFilter: "blur(3px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 420, background: C.bg2, border: `1px solid ${C.borderMd}`,
          borderRadius: C.r5, boxShadow: `0 32px 80px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.05)`,
          animation: "sbFadeUp .16s cubic-bezier(.2,1,.4,1)", overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{ padding: "13px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: FS.base, fontWeight: 600, color: C.t0, fontFamily: SANS }}>New workspace</span>
          <button
            onClick={onClose}
            style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 17, color: C.t2, lineHeight: 1, padding: 2 }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.t0}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.t2}
          >×</button>
        </div>

        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Name">
            <StyledInput inputRef={nameRef} value={name} onChange={e => setName(e.target.value)} onKeyDown={kd} placeholder="my-feature" />
          </Field>

          <Field label="Directory">
            <div style={{ display: "flex", gap: 6 }}>
              <StyledInput value={cwd} onChange={e => setCwd(e.target.value)} onKeyDown={kd} placeholder="~/my-project" style={{ flex: 1 } as any} />
              <button
                type="button"
                title="Browse folder"
                onClick={async () => { try { const d = await invoke<string | null>("open_directory_dialog"); if (d) setCwd(d); } catch {} }}
                style={{
                  width: 36, height: 36, flexShrink: 0, background: C.bg3,
                  border: `1px solid ${C.border}`, borderRadius: C.r2,
                  cursor: "pointer", display: "flex", alignItems: "center",
                  justifyContent: "center", color: C.t2, transition: "all .15s",
                }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = C.borderHi; el.style.color = C.t0; el.style.background = C.bg4; }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = C.border; el.style.color = C.t2; el.style.background = C.bg3; }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
              </button>
            </div>
          </Field>

          <button
            onClick={submit}
            disabled={creating}
            style={{
              marginTop: 4, padding: "10px 0",
              background: creating ? C.bg4 : C.t0,
              border: "none", borderRadius: C.r2,
              color: creating ? C.t2 : C.bg0,
              fontSize: FS.base, fontWeight: 700,
              cursor: creating ? "default" : "pointer",
              fontFamily: SANS, transition: "opacity .15s",
            }}
            onMouseEnter={e => { if (!creating) (e.currentTarget as HTMLElement).style.opacity = ".87"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
          >
            {creating ? "Creating…" : "Launch →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Legacy alias so App.tsx import still works during migration
export { CreateWorkspaceModal as CreateRunboxModal };
