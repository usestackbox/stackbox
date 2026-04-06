// render/features/onboarding/StepWelcome.tsx
import { C, SANS } from "../../design";

const FEATURES = [
  { icon: "⬡", label: "Runboxes",  desc: "Isolated workspaces with full PTY terminals" },
  { icon: "⎇", label: "Git",       desc: "Worktree-per-runbox with visual diff & PRs"  },
  { icon: "◈", label: "AI agents", desc: "Long-term memory and context-aware agents"   },
  { icon: "⬡", label: "MCP",       desc: "Connect any Model Context Protocol server"   },
];

export function StepWelcome({ onNext }: { onNext: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {/* Heading */}
      <div style={{ textAlign: "center" }}>
        <span className="stackbox-brand" style={{ fontSize: 32, color: C.t1, display: "block", marginBottom: 10 }}>
          Welcome to Stackbox
        </span>
        <p style={{ margin: 0, fontSize: 14, color: C.t3, lineHeight: 1.6 }}>
          A workspace for developers who build with AI. Let's get you set up in about a minute.
        </p>
      </div>

      {/* Feature list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {FEATURES.map(f => (
          <div key={f.label} style={{
            display:      "flex",
            alignItems:   "center",
            gap:          14,
            padding:      "10px 14px",
            background:   C.bg2,
            border:       `1px solid ${C.borderSubtle}`,
            borderRadius: 8,
          }}>
            <span style={{ fontSize: 18, width: 24, textAlign: "center", flexShrink: 0 }}>{f.icon}</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.t1, marginBottom: 2 }}>{f.label}</div>
              <div style={{ fontSize: 12, color: C.t3 }}>{f.desc}</div>
            </div>
          </div>
        ))}
      </div>

      <button onClick={onNext} style={primaryBtn}>Get started →</button>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  padding:      "10px 0",
  width:        "100%",
  background:   "#2563eb",
  color:        "#fff",
  border:       "none",
  borderRadius: 8,
  fontSize:     14,
  fontWeight:   600,
  fontFamily:   SANS,
  cursor:       "pointer",
  transition:   "background .15s",
};
