// render/features/settings/UpdatesTab.tsx
import { C, MONO, SANS } from "../../design";
import { Section, Row, Toggle } from "./GeneralTab";
import type { useSettings } from "./useSettings";
import type { UseUpdaterReturn } from "../updater";
import { invoke } from "@tauri-apps/api/core";
import { useState, useEffect } from "react";

type Ctx = ReturnType<typeof useSettings>;

export function UpdatesTab({ ctx, updater }: { ctx: Ctx; updater: UseUpdaterReturn }) {
  const { settings, save } = ctx;
  const { state, checkNow, install } = updater;
  const [appVersion, setAppVersion] = useState("…");

  useEffect(() => {
    invoke<string>("get_app_version").then(setAppVersion).catch(() => {});
  }, []);

  const statusText = () => {
    switch (state.phase) {
      case "checking":     return "Checking…";
      case "available":    return `v${state.version} available`;
      case "downloading":  return `Downloading… ${state.percent}%`;
      case "ready":        return "Ready to install";
      case "error":        return `Error: ${state.message}`;
      default:             return "Up to date";
    }
  };

  const statusColor = () => {
    if (state.phase === "available") return C.blue;
    if (state.phase === "error")     return C.red;
    if (state.phase === "ready")     return C.green;
    return C.t3;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <Section title="Current Version">
        <Row label="Installed">
          <span style={{ fontSize: 13, fontFamily: MONO, color: C.t2 }}>v{appVersion}</span>
        </Row>
        <Row label="Status">
          <span style={{ fontSize: 13, color: statusColor() }}>{statusText()}</span>
        </Row>
        <div style={{ padding: "10px 14px", display: "flex", gap: 8 }}>
          <button
            onClick={checkNow}
            disabled={state.phase === "checking" || state.phase === "downloading"}
            style={{
              padding: "5px 14px", fontSize: 12, fontFamily: SANS,
              background: C.bg4, color: C.t1,
              border: `1px solid ${C.border}`, borderRadius: 6,
              cursor: state.phase === "checking" ? "default" : "pointer",
              opacity: state.phase === "checking" ? 0.5 : 1,
            }}
          >
            Check Now
          </button>
          {state.phase === "available" && (
            <button
              onClick={install}
              style={{
                padding: "5px 14px", fontSize: 12, fontFamily: SANS,
                background: C.blue, color: "#000", fontWeight: 600,
                border: "none", borderRadius: 6, cursor: "pointer",
              }}
            >
              Install v{state.version}
            </button>
          )}
        </div>
      </Section>

      <Section title="Preferences">
        <Row label="Automatically check for updates">
          <Toggle
            checked={settings.autoUpdate}
            onChange={v => save({ autoUpdate: v })}
          />
        </Row>
      </Section>
    </div>
  );
}
