import { invoke } from "@tauri-apps/api/core";
// features/memory/ContextPreview.tsx
import { useCallback, useEffect, useState } from "react";
import { C, MONO, SANS } from "../../design";

interface Props {
  workspaceId: string;
}

export function ContextPreview({ workspaceId }: Props) {
  const [context, setContext] = useState("");
  const [task, setTask] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (t: string) => {
      setLoading(true);
      try {
        setContext(
          (await invoke<string>("memory_get_context", {
            runboxId: workspaceId,
            task: t || null,
          })) || "No context yet."
        );
      } catch {
        setContext("Failed to load context.");
      } finally {
        setLoading(false);
      }
    },
    [workspaceId]
  );

  useEffect(() => {
    load("");
  }, [load]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        height: "100%",
        padding: "8px 10px 0",
      }}
    >
      <div style={{ fontSize: 9, fontFamily: MONO, letterSpacing: ".10em", color: C.t3 }}>
        WHAT AGENTS RECEIVE — memory_context(task=…)
      </div>

      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        <input
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="task (optional — improves ranking)"
          onKeyDown={(e) => e.key === "Enter" && load(task)}
          style={{
            flex: 1,
            background: C.bg2,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            color: C.t0,
            fontSize: 11,
            padding: "7px 10px",
            outline: "none",
            fontFamily: MONO,
          }}
        />
        <button
          onClick={() => load(task)}
          disabled={loading}
          style={{
            padding: "7px 12px",
            borderRadius: 8,
            border: `1px solid ${C.border}`,
            background: C.bg3,
            color: loading ? C.t2 : C.t0,
            fontSize: 11,
            fontFamily: SANS,
            cursor: loading ? "default" : "pointer",
          }}
        >
          {loading ? "…" : "↺"}
        </button>
      </div>

      <div style={{ flex: 1, overflow: "auto", paddingBottom: 16 }}>
        <pre
          style={{
            margin: 0,
            fontSize: 11.5,
            fontFamily: MONO,
            color: C.t1,
            lineHeight: 1.7,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            background: C.bg2,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: "12px 14px",
          }}
        >
          {context}
        </pre>
      </div>
    </div>
  );
}
