// render/features/settings/AppearanceTab.tsx
import { C, SANS } from "../../design";
import { Row, Section } from "./GeneralTab";
import type { useSettings } from "./useSettings";

type Ctx = ReturnType<typeof useSettings>;

export function AppearanceTab({ ctx }: { ctx: Ctx }) {
  const { settings, save } = ctx;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <Section title="Layout">
        <Row label="Sidebar width">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="range"
              min={180}
              max={400}
              step={10}
              value={settings.sidebarWidth}
              onChange={(e) => save({ sidebarWidth: Number(e.target.value) })}
              style={{ width: 100 }}
            />
            <span style={{ fontSize: 12, color: C.t2, fontFamily: "monospace", minWidth: 36 }}>
              {settings.sidebarWidth}px
            </span>
          </div>
        </Row>
      </Section>

      <Section title="Font">
        <Row label="UI font size">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="range"
              min={11}
              max={18}
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
        <Row label="Preview">
          <span style={{ fontSize: settings.fontSize, color: C.t2, fontFamily: SANS }}>
            The quick brown fox
          </span>
        </Row>
      </Section>
    </div>
  );
}
