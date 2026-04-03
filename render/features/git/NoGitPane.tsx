import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { C, MONO, SANS } from "../../design";

interface Props {
  cwd:        string;
  onClose:    () => void;
  onInitDone: () => void;
}

export function NoGitPane({ cwd, onClose, onInitDone }: Props) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const b = await invoke<string>("git_current_branch", { cwd });
        if (b?.trim().length > 0) { clearInterval(t); onInitDone(); return; }
      } catch { /* not yet */ }
      try {
        const wts = await invoke<any[]>("git_worktree_list", { cwd });
        if (Array.isArray(wts) && wts.length > 0) { clearInterval(t); onInitDone(); return; }
      } catch { /* not yet */ }
    }, 2000);
    return () => clearInterval(t);
  }, [cwd, onInitDone]);

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText("git init"); } catch { /* */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg1 }}>
      <div style={{ height: 48, padding: "0 14px", flexShrink: 0, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.t0, flex: 1, fontFamily: SANS }}>Source Control</span>
        <div title="Auto-detecting git repo…" style={{ width: 6, height: 6, borderRadius: "50%", background: C.t3, animation: "gitpulse 2s ease-in-out infinite", marginRight: 4 }} />
        <button onClick={onClose} style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", color: C.t2, fontSize: 14, borderRadius: 8, cursor: "pointer" }}>✕</button>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 24 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.t1, fontFamily: SANS }}>No Git repository</span>
        <span style={{ fontSize: 11, color: C.t3, fontFamily: SANS, textAlign: "center", lineHeight: 1.7 }}>
          Run this in the terminal — the panel will<br/>
          <strong style={{ color: C.t2 }}>update automatically</strong> once detected.
        </span>

        <div style={{ width: "100%", boxSizing: "border-box" as const, background: C.bg0, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, fontFamily: MONO, color: C.t0, flex: 1 }}>git init</span>
          <button onClick={handleCopy}
            style={{ flexShrink: 0, padding: "4px 12px", background: copied ? C.green + "22" : "transparent", border: `1px solid ${copied ? C.green : C.borderMd}`, borderRadius: 6, color: copied ? C.green : C.t1, fontSize: 10, fontFamily: SANS, cursor: "pointer", transition: "all .15s", whiteSpace: "nowrap" as const }}>
            {copied ? "✓ Copied" : "Copy"}
          </button>
        </div>

        <div style={{ width: "100%", boxSizing: "border-box" as const }}>
          <div style={{ fontSize: 9, fontFamily: MONO, color: C.t3, letterSpacing: ".08em", marginBottom: 4 }}>IN FOLDER</div>
          <span style={{ fontSize: 10, fontFamily: MONO, color: C.t2, background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 10px", wordBreak: "break-all" as const, display: "block" }}>{cwd}</span>
        </div>

        <div style={{ width: "100%", background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
          {["1. Click Copy above", "2. Open the terminal (w1 tab)", "3. Paste & press Enter", "4. This panel updates automatically ✓"].map((step, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: i === 3 ? C.green : C.t3, flexShrink: 0 }} />
              <span style={{ fontSize: 11, fontFamily: SANS, color: i === 3 ? C.green : C.t2 }}>{step}</span>
            </div>
          ))}
        </div>
      </div>
      <style>{`@keyframes gitpulse { 0%,100% { opacity:.3; } 50% { opacity:1; } }`}</style>
    </div>
  );
}