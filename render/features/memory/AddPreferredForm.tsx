// features/memory/AddPreferredForm.tsx
import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { C, MONO, SANS } from "../../design";

interface Props { workspaceId: string; onAdded: () => void }

export function AddPreferredForm({ workspaceId, onAdded }: Props) {
  const [open,    setOpen]    = useState(false);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (open) setTimeout(() => taRef.current?.focus(), 30); }, [open]);

  const submit = async () => {
    if (!content.trim()) return;
    setLoading(true);
    try {
      await invoke("memory_remember", {
        runboxId:  workspaceId,
        sessionId: `panel-${workspaceId}`,
        agentId:   `human:panel-${workspaceId}`,
        agentName: "human",
        content:   content.trim(),
        level:     "PREFERRED",
      });
      setContent(""); setOpen(false); onAdded();
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  if (!open) return (
    <button onClick={() => setOpen(true)}
      style={{ width: "100%", padding: "9px 14px", borderRadius: 9, background: "transparent", border: `1px dashed ${C.border}`, color: C.t2, fontSize: 11, fontFamily: SANS, cursor: "pointer", transition: "all .15s", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
      onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = C.bg2; el.style.borderColor = C.borderMd; el.style.color = C.t0; }}
      onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.borderColor = C.border; el.style.color = C.t2; }}>
      <span style={{ fontSize: 16, fontWeight: 300 }}>+</span> Add fact
    </button>
  );

  return (
    <div style={{ background: C.blueDim, border: `1px solid ${C.blue}40`, borderRadius: 11, padding: 13, display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ fontSize: 10, fontFamily: MONO, color: C.blue, letterSpacing: ".06em" }}>◎ NEW PREFERRED FACT</div>
      <div style={{ fontSize: 10, color: C.t3, fontFamily: MONO }}>Key=value for env: port=3456, node=v18. One atomic fact per save.</div>
      <textarea ref={taRef} value={content} onChange={e => setContent(e.target.value)}
        placeholder={"port=3456\npython not available — use node/npm\napi base url=https://api.example.com/v2"}
        rows={3}
        onKeyDown={e => { if (e.key === "Escape") { setOpen(false); setContent(""); } if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}
        style={{ background: C.bg0, border: `1px solid ${C.blue}4d`, borderRadius: 8, color: C.t0, fontSize: 12.5, padding: "9px 11px", resize: "vertical", fontFamily: MONO, outline: "none", lineHeight: 1.65, width: "100%", boxSizing: "border-box" }} />
      <div style={{ display: "flex", gap: 7 }}>
        <button onClick={() => { setOpen(false); setContent(""); }} style={{ padding: "7px 13px", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.t2, fontSize: 11, fontFamily: SANS, cursor: "pointer" }}>Cancel</button>
        <button onClick={submit} disabled={loading || !content.trim()}
          style={{ flex: 1, padding: "7px 0", borderRadius: 8, border: "none", background: content.trim() && !loading ? C.blue : C.bg4, color: content.trim() && !loading ? C.tealBright : C.t2, fontSize: 12, fontWeight: 600, fontFamily: SANS, cursor: content.trim() && !loading ? "pointer" : "default", transition: "all .15s" }}>
          {loading ? "Saving…" : "◎ Save fact"}
        </button>
      </div>
    </div>
  );
}