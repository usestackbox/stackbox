// features/workspace/FileTab.tsx
import { MONO } from "../../design";
import { TabCloseBtn } from "../../ui";
import type { FileTab as FileTabData } from "./types";

/** Returns a CSS color string for a file extension. */
function fileColor(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "#3b82f6",
    tsx: "#06b6d4",
    js: "#f59e0b",
    jsx: "#f97316",
    py: "#a3e635",
    rs: "#f97316",
    go: "#06b6d4",
    css: "#a78bfa",
    scss: "#f0abfc",
    html: "#f97171",
    json: "#fbbf24",
    md: "#94a3b8",
    yaml: "#10b981",
    yml: "#10b981",
    sh: "#4ade80",
    toml: "#fb923c",
    sql: "#60a5fa",
  };
  return map[ext] ?? "rgba(255,255,255,.5)";
}

interface FileTabProps {
  tab: FileTabData;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
}

export function FileTab({ tab, isActive, onSelect, onClose }: FileTabProps) {
  const fileName = tab.filePath.split(/[/\\]/).pop() ?? tab.filePath;

  return (
    <div
      onClick={onSelect}
      title={tab.filePath}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        padding: "0 6px 0 10px",
        height: "100%",
        borderRadius: 0,
        cursor: "pointer",
        flexShrink: 0,
        background: isActive ? "rgba(255,255,255,.07)" : "transparent",
        borderRight: "1px solid rgba(255,255,255,.06)",
        borderTop: "none",
        borderBottom: "none",
        borderLeft: "none",
        transition: "background .1s",
        userSelect: "none",
      }}
      onMouseEnter={(e) => {
        if (!isActive) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,.09)";
      }}
      onMouseLeave={(e) => {
        if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent";
      }}
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        style={{ flexShrink: 0, color: isActive ? "#fff" : "rgba(255,255,255,.4)" }}
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>

      <span
        style={{
          fontSize: 12,
          fontFamily: MONO,
          color: isActive ? "#ffffff" : "rgba(255,255,255,.4)",
          fontWeight: isActive ? 500 : 400,
          maxWidth: 120,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {fileName}
      </span>

      <TabCloseBtn onClose={onClose} />
    </div>
  );
}
