// render/features/settings/MCPTab.tsx
import { useState } from "react";
import { C, MONO, SANS } from "../../design";
import { Section, Toggle } from "./GeneralTab";
import type { McpServerConfig, useSettings } from "./useSettings";

type Ctx = ReturnType<typeof useSettings>;

export function MCPTab({ ctx }: { ctx: Ctx }) {
  const { settings, save } = ctx;
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");

  const addServer = () => {
    if (!newName.trim() || !newUrl.trim()) return;
    const server: McpServerConfig = {
      id: crypto.randomUUID(),
      name: newName.trim(),
      url: newUrl.trim(),
      enabled: true,
    };
    save({ mcpServers: [...settings.mcpServers, server] });
    setNewName("");
    setNewUrl("");
    setAdding(false);
  };

  const removeServer = (id: string) => {
    save({ mcpServers: settings.mcpServers.filter((s) => s.id !== id) });
  };

  const toggleServer = (id: string, enabled: boolean) => {
    save({
      mcpServers: settings.mcpServers.map((s) => (s.id === id ? { ...s, enabled } : s)),
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Section title="MCP Servers">
        {settings.mcpServers.length === 0 && !adding && (
          <div style={{ padding: "16px 14px", color: C.t3, fontSize: 13 }}>
            No MCP servers configured.
          </div>
        )}

        {settings.mcpServers.map((s, i) => (
          <div
            key={s.id}
            style={{
              display: "flex",
              alignItems: "center",
              padding: "10px 14px",
              gap: 10,
              borderBottom:
                i < settings.mcpServers.length - 1 || adding
                  ? `1px solid ${C.borderSubtle}`
                  : "none",
            }}
          >
            <Toggle checked={s.enabled} onChange={(v) => toggleServer(s.id, v)} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: C.t1, marginBottom: 2 }}>{s.name}</div>
              <div
                style={{
                  fontSize: 11,
                  color: C.t3,
                  fontFamily: MONO,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {s.url}
              </div>
            </div>
            <button
              onClick={() => removeServer(s.id)}
              style={{
                background: "none",
                border: "none",
                color: C.red,
                cursor: "pointer",
                fontSize: 18,
                lineHeight: 1,
                opacity: 0.7,
                flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>
        ))}

        {adding && (
          <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              placeholder="Server name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={inputStyle}
            />
            <input
              placeholder="https://mcp.example.com/sse"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addServer();
                if (e.key === "Escape") setAdding(false);
              }}
              style={inputStyle}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={addServer} style={btnPrimary}>
                Add
              </button>
              <button onClick={() => setAdding(false)} style={btnGhost}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </Section>

      {!adding && (
        <button
          onClick={() => setAdding(true)}
          style={{
            alignSelf: "flex-start",
            padding: "6px 14px",
            fontSize: 12,
            fontFamily: SANS,
            background: C.bg4,
            color: C.t1,
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          + Add Server
        </button>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: C.bg4,
  color: C.t1,
  border: `1px solid ${C.border}`,
  borderRadius: 5,
  padding: "6px 10px",
  fontSize: 12,
  fontFamily: SANS,
  width: "100%",
  boxSizing: "border-box",
  outline: "none",
};

const btnPrimary: React.CSSProperties = {
  padding: "5px 14px",
  fontSize: 12,
  fontFamily: SANS,
  background: C.blue,
  color: "#000",
  fontWeight: 600,
  border: "none",
  borderRadius: 5,
  cursor: "pointer",
};

const btnGhost: React.CSSProperties = {
  padding: "5px 14px",
  fontSize: 12,
  fontFamily: SANS,
  background: "transparent",
  color: C.t3,
  border: `1px solid ${C.border}`,
  borderRadius: 5,
  cursor: "pointer",
};
