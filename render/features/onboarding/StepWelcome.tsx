// render/features/onboarding/StepWelcome.tsx
import { C, FS, SANS } from "../../design";

export function StepWelcome({ onNext }: { onNext: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Logo + title */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center" }}>
        <div style={{
          width: 52, height: 52,
          background: C.bg4,
          border: `1px solid ${C.borderMd}`,
          borderRadius: C.r3,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
            <rect x="2" y="3" width="8" height="6" rx="1.5" stroke={C.violet} strokeWidth="1.5" />
            <rect x="14" y="3" width="8" height="6" rx="1.5" stroke={C.blue} strokeWidth="1.5" />
            <rect x="7" y="15" width="10" height="6" rx="1.5" stroke={C.violet} strokeWidth="1.5" />
            <line x1="6" y1="9" x2="6" y2="12" stroke={C.t3} strokeWidth="1.5" strokeLinecap="round" />
            <line x1="18" y1="9" x2="18" y2="12" stroke={C.t3} strokeWidth="1.5" strokeLinecap="round" />
            <line x1="6" y1="12" x2="18" y2="12" stroke={C.t3} strokeWidth="1.5" strokeLinecap="round" />
            <line x1="12" y1="12" x2="12" y2="15" stroke={C.t3} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>

        <div>
          <div style={{ fontSize: FS.xxl, fontWeight: 700, color: C.t0, fontFamily: SANS, letterSpacing: "-.02em", lineHeight: 1.15 }}>
            Welcome to Calus
          </div>
          <p style={{ margin: "8px 0 0", fontSize: FS.sm, color: C.t3, lineHeight: 1.6, fontFamily: SANS }}>
            The control plane for AI coding agents.
          </p>
        </div>
      </div>

      <button
        onClick={onNext}
        style={{
          width: "100%", padding: "10px 0",
          background: C.violetBg,
          color: C.violet,
          border: `1px solid ${C.violetBorder}`,
          borderRadius: C.r2,
          fontSize: FS.sm, fontWeight: 600, fontFamily: SANS,
          cursor: "pointer", letterSpacing: "-.01em",
          transition: "background .15s, color .15s",
        }}
        onMouseEnter={e => {
          const el = e.currentTarget as HTMLElement;
          el.style.background = C.violetBorder;
          el.style.color = C.violetBright;
        }}
        onMouseLeave={e => {
          const el = e.currentTarget as HTMLElement;
          el.style.background = C.violetBg;
          el.style.color = C.violet;
        }}
      >
        Get started →
      </button>
    </div>
  );
}