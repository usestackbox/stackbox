// render/features/onboarding/StepMCPSetup.tsx
import { useState } from "react";
import { C, MONO, SANS } from "../../design";
import type { McpServerConfig } from "../settings";

const PRESETS = [
  { name: "GitHub", url: "https://mcp.github.com/sse" },
  { name: "Asana", url: "https://mcp.asana.com/sse" },
  { name: "Notion", url: "https://mcp.notion.so/sse" },
  { name: "Salesforce", url: "https://mcp.salesforce.com/sse" },
];

interface Props {
  onNext: (server?: McpServerConfig) => void;
}

export function StepMCPSetup({ onNext }: Props) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [added, setAdded] = useState<McpServerConfig | null>(null);

  const pickPreset = (preset: (typeof PRESETS)[number]) => {
    setName(preset.name);
    setUrl(preset.url);
  };

  const addServer = () => {
    if (!name.trim() || !url.trim()) return;
    const server: McpServerConfig = {
      id: crypto.randomUUID(),
      name: name.trim(),
      url: url.trim(),
      enabled: true,
    };
    setAdded(server);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h2 style={{ margin: "0 0 6px", fontSize: 20, color: C.t1 }}>Connect an MCP Server</h2>
        <p style={{ margin: 0, fontSize: 13, color: C.t3, lineHeight: 1.6 }}>
          MCP servers give your AI agent access to external tools and data sources. This step is
          optional.
        </p>
      </div>

      {!added ? (
        <>
          {/* Presets */}
          <div>
            <p
              style={{
                margin: "0 0 8px",
                fontSize: 11,
                color: C.t3,
                textTransform: "uppercase",
                letterSpacing: ".07em",
              }}
            >
              Quick connect
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() => pickPreset(p)}
                  style={{
                    padding: "5px 12px",
                    fontSize: 12,
                    fontFamily: SANS,
                    background: url === p.url ? C.blueBg : C.bg4,
                    color: url === p.url ? C.blue : C.t2,
                    border: `1px solid ${url === p.url ? C.blueBorder : C.border}`,
                    borderRadius: 20,
                    cursor: "pointer",
                  }}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* Custom form */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              placeholder="Server name (e.g. My MCP)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
            />
            <input
              placeholder="URL (e.g. https://mcp.example.com/sse)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addServer();
              }}
              style={{ ...inputStyle, fontFamily: MONO, fontSize: 12 }}
            />
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={addServer}
              disabled={!name.trim() || !url.trim()}
              style={{
                ...primaryBtn,
                opacity: name.trim() && url.trim() ? 1 : 0.4,
                cursor: name.trim() && url.trim() ? "pointer" : "default",
              }}
            >
              Add &amp; Continue →
            </button>
            <button onClick={() => onNext()} style={ghostBtn}>
              Skip →
            </button>
          </div>
        </>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            style={{
              padding: "12px 14px",
              background: C.greenBg,
              border: `1px solid ${C.greenBorder}`,
              borderRadius: 8,
            }}
          >
            <div style={{ fontSize: 13, color: C.green, marginBottom: 4 }}>✓ MCP server added</div>
            <div style={{ fontSize: 12, color: C.t2 }}>{added.name}</div>
            <div style={{ fontSize: 11, color: C.t3, fontFamily: MONO, marginTop: 2 }}>
              {added.url}
            </div>
          </div>
          <button onClick={() => onNext(added)} style={primaryBtn}>
            Continue →
          </button>
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: C.bg4,
  color: C.t1,
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  padding: "8px 10px",
  fontSize: 13,
  fontFamily: SANS,
  width: "100%",
  boxSizing: "border-box",
  outline: "none",
};
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
