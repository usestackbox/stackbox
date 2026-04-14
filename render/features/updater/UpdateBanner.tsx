// render/features/updater/UpdateBanner.tsx
import { C, SANS } from "../../design";
import type { UpdaterState } from "./useUpdater";

interface Props {
  state: UpdaterState;
  onInstall: () => void;
  onDismiss: () => void;
}

export function UpdateBanner({ state, onInstall, onDismiss }: Props) {
  if (state.phase !== "available" && state.phase !== "downloading" && state.phase !== "ready") {
    return null;
  }

  const isDownloading = state.phase === "downloading";
  const isReady = state.phase === "ready";

  return (
    <div
      style={{
        position: "relative",
        flexShrink: 0,
        zIndex: 9999,
        height: 36,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 14px",
        background: C.blueBg,
        borderBottom: `1px solid ${C.blueBorder}`,
        fontFamily: SANS,
        fontSize: 12,
      }}
    >
      {/* Left: message */}
      <span style={{ color: C.blue, display: "flex", alignItems: "center", gap: 8 }}>
        {isDownloading && <span style={{ color: C.t3 }}>Downloading update… {state.percent}%</span>}
        {isReady && <span style={{ color: C.green }}>✓ Update ready — restarting…</span>}
        {state.phase === "available" && (
          <>
            <span style={{ color: C.blue }}>★</span>
            <span style={{ color: C.t1 }}>Calus {state.version} is available</span>
            {state.notes && (
              <span
                style={{
                  color: C.t3,
                  maxWidth: 360,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                — {state.notes}
              </span>
            )}
          </>
        )}
      </span>

      {/* Right: progress bar or action buttons */}
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {isDownloading && (
          <div
            style={{
              width: 120,
              height: 4,
              background: C.border,
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${state.percent}%`,
                background: C.blue,
                transition: "width .2s",
              }}
            />
          </div>
        )}

        {state.phase === "available" && (
          <>
            <button
              onClick={onInstall}
              style={{
                padding: "3px 10px",
                background: C.blue,
                color: "#000",
                border: "none",
                borderRadius: 4,
                fontSize: 11,
                fontFamily: SANS,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Install
            </button>
            <button
              onClick={onDismiss}
              style={{
                padding: "3px 8px",
                background: "transparent",
                color: C.t3,
                border: `1px solid ${C.border}`,
                borderRadius: 4,
                fontSize: 11,
                fontFamily: SANS,
                cursor: "pointer",
              }}
            >
              Later
            </button>
          </>
        )}
      </span>
    </div>
  );
}
