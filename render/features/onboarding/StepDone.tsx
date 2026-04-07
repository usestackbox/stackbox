// render/features/onboarding/StepDone.tsx
import { C, SANS } from "../../design";

export function StepDone({ onFinish }: { onFinish: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 28,
        padding: "12px 0 4px",
        textAlign: "center",
      }}
    >
      {/* Checkmark */}
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: "50%",
          background: C.greenBg,
          border: `2px solid ${C.greenBorder}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 30,
        }}
      >
        ✓
      </div>

      <div>
        <h2 style={{ margin: "0 0 10px", fontSize: 22, color: C.t1 }}>You're all set!</h2>
        <p style={{ margin: 0, fontSize: 14, color: C.t3, lineHeight: 1.7, maxWidth: 360 }}>
          Stackbox is ready. Create your first runbox to start working — give it a name and a
          project directory.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
        <button
          onClick={onFinish}
          style={{
            padding: "11px 0",
            width: "100%",
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            fontFamily: SANS,
            cursor: "pointer",
          }}
        >
          Open Stackbox →
        </button>
        <p style={{ margin: 0, fontSize: 11, color: C.t3 }}>
          Tip: press{" "}
          <kbd
            style={{
              padding: "1px 5px",
              background: "rgba(255,255,255,.07)",
              border: "1px solid rgba(255,255,255,.14)",
              borderRadius: 3,
              fontSize: 10,
            }}
          >
            ⌘K
          </kbd>{" "}
          anytime to open the command palette
        </p>
      </div>
    </div>
  );
}
