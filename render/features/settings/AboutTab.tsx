// render/features/settings/AboutTab.tsx
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { C, MONO, SANS } from "../../design";

export function AboutTab() {
  const [version,  setVersion]  = useState("…");
  const [platform, setPlatform] = useState<{ os: string; arch: string } | null>(null);

  useEffect(() => {
    invoke<string>("get_app_version").then(setVersion).catch(() => {});
    invoke<{ os: string; arch: string; version: string }>("get_platform_info")
      .then(setPlatform).catch(() => {});
  }, []);

  const openUrl = (url: string) =>
    invoke("open_external_url", { url }).catch(() => window.open(url, "_blank"));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {/* Logo + version */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, paddingTop: 8 }}>
        <span className="stackbox-brand" style={{ fontSize: 28, color: C.t1 }}>Stackbox</span>
        <span style={{ fontFamily: MONO, fontSize: 13, color: C.t3 }}>v{version}</span>
        {platform && (
          <span style={{ fontSize: 11, color: C.t3 }}>
            {platform.os} · {platform.arch}
          </span>
        )}
      </div>

      {/* Links */}
      <div style={{
        background: C.bg2, border: `1px solid ${C.borderSubtle}`,
        borderRadius: 8, overflow: "hidden",
      }}>
        {[
          { label: "GitHub",        url: "https://github.com/usestackbox/stackbox"        },
          { label: "Documentation", url: "https://docs.stackbox.dev"                       },
          { label: "Changelog",     url: "https://github.com/usestackbox/stackbox/releases"},
          { label: "Report a bug",  url: "https://github.com/usestackbox/stackbox/issues" },
        ].map((item, i, arr) => (
          <button
            key={item.label}
            onClick={() => openUrl(item.url)}
            style={{
              width: "100%",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "10px 14px",
              background: "none",
              border: "none",
              borderBottom: i < arr.length - 1 ? `1px solid ${C.borderSubtle}` : "none",
              color: C.t1, fontSize: 13, fontFamily: SANS,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            {item.label}
            <span style={{ color: C.t3, fontSize: 12 }}>↗</span>
          </button>
        ))}
      </div>

      <p style={{ margin: 0, fontSize: 11, color: C.t3, textAlign: "center" }}>
        MIT License · © {new Date().getFullYear()} Stackbox contributors
      </p>
    </div>
  );
}
