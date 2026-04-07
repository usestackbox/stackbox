// render/features/settings/SettingsModal.tsx
import { useState } from "react";
import { C, SANS } from "../../design";
import { useSettings }   from "./useSettings";
import { GeneralTab }    from "./GeneralTab";
import { UpdatesTab }    from "./UpdatesTab";
import { AppearanceTab } from "./AppearanceTab";
import { KeybindsTab }   from "./KeybindsTab";
import { MCPTab }        from "./MCPTab";
import { AboutTab }      from "./AboutTab";
import type { UseUpdaterReturn } from "../updater";

type Tab = "general" | "appearance" | "updates" | "keybinds" | "mcp" | "about";

const TABS: { id: Tab; label: string }[] = [
  { id: "general",    label: "General"    },
  { id: "appearance", label: "Appearance" },
  { id: "updates",    label: "Updates"    },
  { id: "keybinds",   label: "Keybinds"  },
  { id: "mcp",        label: "MCP"        },
  { id: "about",      label: "About"      },
];

interface Props {
  onClose:     () => void;
  updater:     UseUpdaterReturn;
  initialTab?: Tab;           // ← NEW: allows App.tsx to open a specific tab
}

export function SettingsModal({ onClose, updater, initialTab }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab ?? "general");  // ← use prop
  const settingsCtx   = useSettings();

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,.72)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 10000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 700, height: 520,
          background: C.bg3,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          boxShadow: C.shadowLg,
          display: "flex",
          overflow: "hidden",
          fontFamily: SANS,
        }}
      >
        {/* Sidebar */}
        <nav style={{
          width: 160,
          background: C.bg2,
          borderRight: `1px solid ${C.border}`,   // ← was C.borderSubtle (doesn't exist)
          padding: "12px 0",
          flexShrink: 0,
        }}>
          <p style={{
            margin: "0 0 6px",
            padding: "0 14px",
            fontSize: 10, color: C.t3,
            textTransform: "uppercase", letterSpacing: ".07em",
          }}>
            Settings
          </p>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                width: "100%",
                padding: "7px 14px",
                background:  tab === t.id ? C.bg4 : "transparent",
                border:      "none",
                borderLeft:  tab === t.id ? `2px solid ${C.blue}` : "2px solid transparent",
                color:       tab === t.id ? C.t1 : C.t2,
                fontSize:    13,
                fontFamily:  SANS,
                textAlign:   "left",
                cursor:      "pointer",
                transition:  "background .1s",
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px", position: "relative" }}>
          {/* Close */}
          <button
            onClick={onClose}
            style={{
              position: "absolute", top: 14, right: 16,
              background: "none", border: "none",
              color: C.t3, cursor: "pointer", fontSize: 20, lineHeight: 1,
            }}
          >×</button>

          {tab === "general"    && <GeneralTab    ctx={settingsCtx} />}
          {tab === "appearance" && <AppearanceTab ctx={settingsCtx} />}
          {tab === "updates"    && <UpdatesTab    ctx={settingsCtx} updater={updater} />}
          {tab === "keybinds"   && <KeybindsTab />}
          {tab === "mcp"        && <MCPTab        ctx={settingsCtx} />}
          {tab === "about"      && <AboutTab />}
        </div>
      </div>
    </div>
  );
}