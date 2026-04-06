// render/features/updater/UpdateModal.tsx
import { C, SANS, MONO } from "../../design";
import type { UseUpdaterReturn } from "./useUpdater";

interface Props {
  updater:  UseUpdaterReturn;
  currentVersion: string;
  onClose:  () => void;
}

export function UpdateModal({ updater, currentVersion, onClose }: Props) {
  const { state, checkNow, install } = updater;

  return (
    <div
      onClick={onClose}
      style={{
        position:        "fixed",
        inset:           0,
        background:      "rgba(0,0,0,.72)",
        display:         "flex",
        alignItems:      "center",
        justifyContent:  "center",
        zIndex:          10000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width:        460,
          background:   C.bg3,
          border:       `1px solid ${C.border}`,
          borderRadius: 10,
          boxShadow:    C.shadowLg,
          fontFamily:   SANS,
          overflow:     "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          padding:        "18px 20px 14px",
          borderBottom:   `1px solid ${C.borderSubtle}`,
          display:        "flex",
          alignItems:     "center",
          justifyContent: "space-between",
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: C.t1 }}>Software Update</span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: C.t3, cursor: "pointer", fontSize: 18, lineHeight: 1 }}
          >×</button>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 20px 8px" }}>
          {/* Version row */}
          <div style={{ display: "flex", gap: 32, marginBottom: 20 }}>
            <VersionPill label="Current" version={currentVersion} muted />
            {state.phase === "available" && (
              <>
                <span style={{ color: C.t3, alignSelf: "center", fontSize: 14 }}>→</span>
                <VersionPill label="New" version={state.version} accent />
              </>
            )}
          </div>

          {/* Changelog */}
          {state.phase === "available" && state.notes && (
            <div style={{
              background:   C.bg2,
              border:       `1px solid ${C.borderSubtle}`,
              borderRadius: 6,
              padding:      "10px 12px",
              maxHeight:    180,
              overflowY:    "auto",
              marginBottom: 16,
            }}>
              <p style={{ margin: "0 0 6px", fontSize: 11, color: C.t3, textTransform: "uppercase", letterSpacing: ".06em" }}>
                What's new
              </p>
              <pre style={{
                margin:     0,
                fontSize:   12,
                color:      C.t2,
                fontFamily: MONO,
                whiteSpace: "pre-wrap",
                lineHeight: 1.6,
              }}>
                {state.notes}
              </pre>
            </div>
          )}

          {/* Progress */}
          {state.phase === "downloading" && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: C.t2 }}>Downloading update…</span>
                <span style={{ fontSize: 12, color: C.t3, fontFamily: MONO }}>{state.percent}%</span>
              </div>
              <div style={{ height: 4, background: C.bg2, borderRadius: 2, overflow: "hidden" }}>
                <div style={{
                  height:     "100%",
                  width:      `${state.percent}%`,
                  background: C.blue,
                  transition: "width .3s",
                }} />
              </div>
            </div>
          )}

          {state.phase === "ready" && (
            <p style={{ fontSize: 13, color: C.green, textAlign: "center", margin: "0 0 16px" }}>
              ✓ Update downloaded — restarting…
            </p>
          )}

          {state.phase === "checking" && (
            <p style={{ fontSize: 13, color: C.t3, textAlign: "center", margin: "0 0 16px" }}>
              Checking for updates…
            </p>
          )}

          {state.phase === "idle" && (
            <p style={{ fontSize: 13, color: C.t3, textAlign: "center", margin: "0 0 16px" }}>
              Stackbox {currentVersion} is up to date.
            </p>
          )}

          {state.phase === "error" && (
            <p style={{ fontSize: 12, color: C.red, margin: "0 0 16px" }}>
              Error: {state.message}
            </p>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding:      "12px 20px 18px",
          display:      "flex",
          justifyContent: "flex-end",
          gap:          8,
        }}>
          {state.phase === "available" && (
            <button
              onClick={install}
              style={{
                padding:      "6px 16px",
                background:   C.blue,
                color:        "#000",
                border:       "none",
                borderRadius: 6,
                fontSize:     12,
                fontWeight:   600,
                fontFamily:   SANS,
                cursor:       "pointer",
              }}
            >
              Install &amp; Restart
            </button>
          )}
          {(state.phase === "idle" || state.phase === "error") && (
            <button
              onClick={checkNow}
              style={{
                padding:      "6px 14px",
                background:   C.bg4,
                color:        C.t1,
                border:       `1px solid ${C.border}`,
                borderRadius: 6,
                fontSize:     12,
                fontFamily:   SANS,
                cursor:       "pointer",
              }}
            >
              Check Now
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              padding:      "6px 14px",
              background:   "transparent",
              color:        C.t3,
              border:       `1px solid ${C.border}`,
              borderRadius: 6,
              fontSize:     12,
              fontFamily:   SANS,
              cursor:       "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function VersionPill({ label, version, muted, accent }: {
  label: string; version: string; muted?: boolean; accent?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 10, color: C.t3, textTransform: "uppercase", letterSpacing: ".06em" }}>
        {label}
      </span>
      <span style={{
        fontSize:   14,
        fontFamily: MONO,
        fontWeight: 700,
        color:      accent ? C.blue : muted ? C.t3 : C.t1,
      }}>
        v{version}
      </span>
    </div>
  );
}
