import { invoke } from "@tauri-apps/api/core";
// render/features/onboarding/StepDockerCheck.tsx
import { useEffect, useState } from "react";
import { C, MONO, SANS } from "../../design";

type Status = "checking" | "ok" | "missing";

export function StepDockerCheck({ onNext }: { onNext: () => void }) {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    check();
  }, []);

  const check = async () => {
    setStatus("checking");
    try {
      const available = await invoke<boolean>("docker_available");
      setStatus(available ? "ok" : "missing");
    } catch {
      setStatus("missing");
    }
  };

  const openDockerInstall = () =>
    invoke("open_external_url", { url: "https://docs.docker.com/get-docker/" }).catch(() => {});

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h2 style={{ margin: "0 0 6px", fontSize: 20, color: C.t1 }}>Docker (Optional)</h2>
        <p style={{ margin: 0, fontSize: 13, color: C.t3, lineHeight: 1.6 }}>
          Docker is used to sandbox agent processes. It's optional — agents can run directly on your
          machine without it.
        </p>
      </div>

      {/* Status */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 14px",
          background: C.bg2,
          border: `1px solid ${C.borderSubtle}`,
          borderRadius: 8,
        }}
      >
        <div>
          <div style={{ fontSize: 13, color: C.t1, marginBottom: 3 }}>Docker Desktop</div>
          <div style={{ fontSize: 11, color: C.t3 }}>daemon availability on localhost</div>
        </div>
        <span
          style={{
            fontSize: 12,
            fontFamily: MONO,
            color: status === "ok" ? C.green : status === "missing" ? C.amber : C.t3,
          }}
        >
          {status === "checking" ? "…" : status === "ok" ? "✓ running" : "✗ not found"}
        </span>
      </div>

      {status === "missing" && (
        <div
          style={{
            padding: "12px 14px",
            background: C.amberBg,
            border: `1px solid ${C.amberBorder}`,
            borderRadius: 8,
            fontSize: 12,
            color: C.amber,
            lineHeight: 1.7,
          }}
        >
          Docker wasn't detected. You can still use Stackbox without it — or install it now for
          sandboxed agents.
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 8 }}>
        {status === "missing" && (
          <>
            <button onClick={openDockerInstall} style={ghostBtn}>
              Install Docker ↗
            </button>
            <button onClick={check} style={ghostBtn}>
              Retry
            </button>
          </>
        )}
        <button onClick={onNext} style={primaryBtn}>
          {status === "ok" ? "Continue →" : "Skip for now →"}
        </button>
      </div>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  flex: 1,
  padding: "9px 0",
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 7,
  fontSize: 13,
  fontWeight: 600,
  fontFamily: SANS,
  cursor: "pointer",
};
const ghostBtn: React.CSSProperties = {
  padding: "9px 16px",
  background: "transparent",
  color: C.t2,
  border: `1px solid ${C.border}`,
  borderRadius: 7,
  fontSize: 13,
  fontFamily: SANS,
  cursor: "pointer",
};
