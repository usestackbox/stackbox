import { C, MONO, SANS } from "../../design";
import type { GitCommit } from "./types";

function reldate(iso: string) {
  try {
    const d = Date.now() - new Date(iso).getTime();
    if (d < 3600_000)  return `${Math.floor(d / 60_000)}m`;
    if (d < 86400_000) return `${Math.floor(d / 3600_000)}h`;
    return `${Math.floor(d / 86400_000)}d`;
  } catch { return ""; }
}

export function HistoryTab({ commits }: { commits: GitCommit[] }) {
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "8px", display: "flex", flexDirection: "column", gap: 3 }}>
      {commits.length === 0 && (
        <div style={{ padding: "32px 0", textAlign: "center", fontSize: 12, color: C.t2, fontFamily: SANS }}>No commits yet.</div>
      )}
      {commits.map((c, i) => (
        <div key={c.hash} style={{ background: i === 0 ? C.bg3 : C.bg2, border: `1px solid ${i === 0 ? C.borderMd : C.border}`, borderRadius: 8, padding: "9px 10px", display: "flex", gap: 10, alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, paddingTop: 2, gap: 3 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: i === 0 ? C.t0 : C.t3 }} />
            {i < commits.length - 1 && <div style={{ width: 1, height: 14, background: C.border }} />}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: i === 0 ? C.t0 : C.t1, fontFamily: SANS, fontWeight: i === 0 ? 500 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 3 }}>{c.message}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <span style={{ fontSize: 10, fontFamily: MONO, color: C.t3 }}>{c.short_hash}</span>
              <span style={{ fontSize: 10, color: C.t3, fontFamily: SANS }}>{c.author.split(" ")[0]}</span>
              <span style={{ fontSize: 10, color: C.t3, fontFamily: SANS }}>{reldate(c.date)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}