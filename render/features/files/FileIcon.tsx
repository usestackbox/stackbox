// features/files/FileIcon.tsx
export function fileColor(name: string, _dir = false): string {
  if (_dir) return "rgba(255,255,255,.4)";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "#3b82f6", tsx: "#06b6d4", js: "#f59e0b", jsx: "#f97316",
    py: "#a78bfa", rb: "#f87171", go: "#06b6d4", rs: "#f97316",
    css: "#60a5fa", scss: "#f472b6", html: "#f97316", json: "#fbbf24",
    md: "rgba(255,255,255,.5)", sh: "#4ade80", toml: "#fb923c",
    yaml: "#6ee7b7", yml: "#6ee7b7", lock: "rgba(255,255,255,.2)",
    svg: "#f472b6", png: "#a78bfa", jpg: "#a78bfa", gif: "#a78bfa",
  };
  return map[ext] ?? "rgba(255,255,255,.3)";
}

export function FileIcon({ name, isDir = false, size = 10 }: {
  name:   string;
  isDir?: boolean;
  size?:  number;
}) {
  const color = fileColor(name, isDir);
  if (isDir) {
    return (
      <svg width={size + 2} height={size + 2} viewBox="0 0 24 24" fill="none"
        stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  );
}