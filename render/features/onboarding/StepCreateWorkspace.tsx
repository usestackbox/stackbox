// render/features/onboarding/StepCreateWorkspace.tsx
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { C, FS, MONO, SANS } from "../../design";

interface Props {
  onFinish: (name: string, cwd: string) => void;
}

export function StepCreateWorkspace({ onFinish }: Props) {
  const [name, setName] = useState("");
  const [cwd,  setCwd]  = useState("~/");
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => nameRef.current?.focus(), 60); }, []);

  const submit = () => {
    if (busy) return;
    setBusy(true);
    try { onFinish(name.trim() || "my-workspace", cwd.trim() || "~/"); }
    finally { setBusy(false); }
  };

  const browse = async () => {
    const dir = await invoke<string | null>("open_directory_dialog").catch(() => null);
    if (dir) setCwd(dir);
  };

  const onKeyDown = (e: React.KeyboardEvent) => { if (e.key === "Enter") submit(); };

  const inputStyle: React.CSSProperties = {
    background: C.bg1,
    border: `1px solid ${C.border}`,
    borderRadius: C.r2,
    color: C.t0,
    fontSize: FS.sm,
    padding: "9px 11px",
    outline: "none",
    fontFamily: MONO,
    width: "100%",
    boxSizing: "border-box",
    transition: "border-color .15s",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <div style={{ fontSize: FS.h3, fontWeight: 700, color: C.t0, fontFamily: SANS, letterSpacing: "-.02em", marginBottom: 6 }}>
          Create your first workspace
        </div>
        <p style={{ margin: 0, fontSize: FS.sm, color: C.t3, lineHeight: 1.6, fontFamily: SANS }}>
          A workspace maps to a directory. Each one gets its own agents, worktrees, and memory.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Name */}
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <label style={{ fontSize: FS.xxs, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: C.t2, fontFamily: SANS }}>
            Name
          </label>
          <input
            ref={nameRef}
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="my-workspace"
            style={inputStyle}
            onFocus={e => (e.currentTarget.style.borderColor = C.borderHi)}
            onBlur={e  => (e.currentTarget.style.borderColor = C.border)}
          />
        </div>

        {/* Directory */}
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <label style={{ fontSize: FS.xxs, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: C.t2, fontFamily: SANS }}>
            Directory
          </label>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={cwd}
              onChange={e => setCwd(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="~/projects/my-app"
              style={{ ...inputStyle, flex: 1 }}
              onFocus={e => (e.currentTarget.style.borderColor = C.borderHi)}
              onBlur={e  => (e.currentTarget.style.borderColor = C.border)}
            />
            <button
              onClick={browse}
              title="Browse for folder"
              style={{
                height: 38, padding: "0 11px",
                background: C.bg3,
                border: `1px solid ${C.border}`,
                borderRadius: C.r2,
                color: C.t2,
                cursor: "pointer",
                display: "flex", alignItems: "center", gap: 5,
                fontSize: FS.xs, fontFamily: SANS,
                flexShrink: 0,
                transition: "background .12s, border-color .12s, color .12s",
              }}
              onMouseEnter={e => {
                const el = e.currentTarget as HTMLElement;
                el.style.background = C.bg4;
                el.style.borderColor = C.borderMd;
                el.style.color = C.t1;
              }}
              onMouseLeave={e => {
                const el = e.currentTarget as HTMLElement;
                el.style.background = C.bg3;
                el.style.borderColor = C.border;
                el.style.color = C.t2;
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              Browse
            </button>
          </div>
        </div>
      </div>

      <button
        onClick={submit}
        disabled={busy}
        style={{
          width: "100%", padding: "10px 0",
          background: busy ? C.bg4 : C.violetBg,
          color: busy ? C.t3 : C.violet,
          border: `1px solid ${busy ? C.border : C.violetBorder}`,
          borderRadius: C.r2,
          fontSize: FS.sm, fontWeight: 600, fontFamily: SANS,
          cursor: busy ? "default" : "pointer",
          transition: "all .15s",
        }}
        onMouseEnter={e => {
          if (!busy) {
            const el = e.currentTarget as HTMLElement;
            el.style.background = C.violetBorder;
            el.style.color = C.violetBright;
          }
        }}
        onMouseLeave={e => {
          if (!busy) {
            const el = e.currentTarget as HTMLElement;
            el.style.background = C.violetBg;
            el.style.color = C.violet;
          }
        }}
      >
        {busy ? "Creating…" : "Create workspace →"}
      </button>
    </div>
  );
}