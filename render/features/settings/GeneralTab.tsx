// render/features/settings/GeneralTab.tsx
import { C, SANS } from "../../design";
import type { useSettings } from "./useSettings";

type Ctx = ReturnType<typeof useSettings>;

export function GeneralTab({ ctx }: { ctx: Ctx }) {
  const { settings, save } = ctx;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <Section title="Interface">
        <Row label="Theme">
          <Select
            value={settings.theme}
            options={[
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
              { value: "system", label: "System" },
            ]}
            onChange={(v) => save({ theme: v as "dark" | "light" | "system" })}
          />
        </Row>
        <Row label="Font size">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="range"
              min={11}
              max={20}
              step={1}
              value={settings.fontSize}
              onChange={(e) => save({ fontSize: Number(e.target.value) })}
              style={{ width: 100 }}
            />
            <span style={{ fontSize: 12, color: C.t2, fontFamily: "monospace", minWidth: 28 }}>
              {settings.fontSize}px
            </span>
          </div>
        </Row>
      </Section>

      <Section title="Startup">
        <Row label="Launch at login">
          <Toggle checked={settings.launchAtLogin} onChange={(v) => save({ launchAtLogin: v })} />
        </Row>
      </Section>

      <Section title="Logging">
        <Row label="Log level">
          <Select
            value={settings.logLevel}
            options={[
              { value: "error", label: "Error" },
              { value: "warn", label: "Warn" },
              { value: "info", label: "Info" },
              { value: "debug", label: "Debug" },
              { value: "trace", label: "Trace" },
            ]}
            onChange={(v) => save({ logLevel: v as typeof settings.logLevel })}
          />
        </Row>
      </Section>
    </div>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p
        style={{
          margin: "0 0 10px",
          fontSize: 11,
          color: C.t3,
          textTransform: "uppercase",
          letterSpacing: ".07em",
        }}
      >
        {title}
      </p>
      <div
        style={{
          background: C.bg2,
          border: `1px solid ${C.borderSubtle}`,
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 14px",
        borderBottom: `1px solid ${C.borderSubtle}`,
      }}
    >
      <span style={{ fontSize: 13, color: C.t1 }}>{label}</span>
      {children}
    </div>
  );
}

export function Select({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        background: C.bg4,
        color: C.t1,
        border: `1px solid ${C.border}`,
        borderRadius: 5,
        padding: "4px 8px",
        fontSize: 12,
        fontFamily: SANS,
        cursor: "pointer",
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
}: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        background: checked ? C.blue : C.bg5,
        border: "none",
        cursor: "pointer",
        position: "relative",
        transition: "background .15s",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: checked ? 19 : 3,
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: "#fff",
          transition: "left .15s",
        }}
      />
    </button>
  );
}
