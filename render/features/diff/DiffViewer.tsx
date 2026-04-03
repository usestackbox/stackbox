// features/diff/DiffViewer.tsx
import { C, MONO, SANS } from "../../design";
import type { DiffTab } from "../../types";
import { parseDiff, getDiffLanguage, extColor, HLJS_DIFF_THEME } from "./diffUtils";
import { UnifiedDiff } from "./UnifiedDiff";
import { StatBar } from "./StatBar";

interface Props {
  tab:          DiffTab;
  allTabs?:     DiffTab[];
  onClose:      () => void;
  onSelectTab?: (id: string) => void;
}

export function DiffViewer({ tab, allTabs, onClose, onSelectTab }: Props) {
  const lines    = parseDiff(tab.diff);
  const lang     = getDiffLanguage(tab.path);
  const tabs     = allTabs ?? [tab];
  const tabIdx   = tabs.findIndex(t => t.id === tab.id);
  const hasPrev  = tabIdx > 0;
  const hasNext  = tabIdx < tabs.length - 1;
  const fileName = tab.path.split(/[/\\]/).pop() ?? tab.path;
  const dirPart  = tab.path.slice(0, tab.path.length - fileName.length);
  const ec       = extColor(tab.path);
  const badgeColor = tab.changeType === "deleted" ? "#cc5555" : tab.changeType === "created" ? "#4a9955" : "#666666";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg0 }}>
      <style>{HLJS_DIFF_THEME}</style>

      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", height: 38, flexShrink: 0, borderBottom: `1px solid ${C.border}`, background: C.bg1, gap: 0 }}>
        <button onClick={onClose} title="Back to file list"
          style={{ height: "100%", padding: "0 12px", background: "none", border: "none", borderRight: `1px solid ${C.border}`, color: C.t2, cursor: "pointer", fontSize: 11, fontWeight: 600, letterSpacing: ".04em", display: "flex", alignItems: "center", gap: 5, transition: "color .1s, background .1s", fontFamily: SANS, flexShrink: 0 }}
          onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.color = C.t0; el.style.background = "rgba(255,255,255,.04)"; }}
          onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.color = C.t2; el.style.background = "none"; }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Files
        </button>

        <div style={{ width: 3, height: 14, borderRadius: 2, background: ec, flexShrink: 0, marginLeft: 12 }} />

        <div style={{ display: "flex", alignItems: "center", gap: 5, flex: 1, minWidth: 0, padding: "0 10px" }}>
          {dirPart && <span style={{ fontSize: 11, fontFamily: MONO, color: C.t3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>{dirPart}</span>}
          <span style={{ fontSize: 12, fontFamily: MONO, fontWeight: 600, color: C.t0, whiteSpace: "nowrap" }}>{fileName}</span>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: badgeColor, background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.09)", borderRadius: 3, padding: "1px 6px", fontFamily: SANS, flexShrink: 0, marginLeft: 2 }}>{tab.changeType}</span>
        </div>

        <StatBar ins={tab.insertions} del={tab.deletions} />

        {tabs.length > 1 && (
          <div style={{ display: "flex", alignItems: "center", height: "100%", borderLeft: `1px solid ${C.border}`, marginLeft: 8 }}>
            <button onClick={() => hasPrev && onSelectTab?.(tabs[tabIdx - 1].id)} disabled={!hasPrev} title="Previous file"
              style={{ height: "100%", padding: "0 10px", background: "none", border: "none", color: hasPrev ? C.t1 : C.t3, cursor: hasPrev ? "pointer" : "default", fontSize: 14 }}>‹</button>
            <span style={{ fontSize: 10, fontFamily: MONO, color: C.t2, minWidth: 32, textAlign: "center" }}>{tabIdx + 1}/{tabs.length}</span>
            <button onClick={() => hasNext && onSelectTab?.(tabs[tabIdx + 1].id)} disabled={!hasNext} title="Next file"
              style={{ height: "100%", padding: "0 10px", background: "none", border: "none", color: hasNext ? C.t1 : C.t3, cursor: hasNext ? "pointer" : "default", fontSize: 14 }}>›</button>
          </div>
        )}
      </div>

      {/* Path sub-bar */}
      <div style={{ display: "flex", alignItems: "center", height: 28, padding: "0 14px", flexShrink: 0, borderBottom: `1px solid ${C.border}`, background: "rgba(255,255,255,.012)" }}>
        <span style={{ fontFamily: MONO, fontSize: 11, color: C.t2, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tab.path}</span>
        {(tab.insertions > 0 || tab.deletions > 0) && (
          <span style={{ display: "flex", gap: 6, flexShrink: 0, fontSize: 10, fontFamily: MONO }}>
            {tab.insertions > 0 && <span style={{ color: "#4a9955" }}>+{tab.insertions}</span>}
            {tab.deletions  > 0 && <span style={{ color: "#e05555" }}>-{tab.deletions}</span>}
          </span>
        )}
      </div>

      {/* Empty state */}
      {!tab.diff.trim() && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
          <span style={{ fontSize: 12, color: C.t2, fontFamily: SANS }}>{tab.changeType === "deleted" ? "File deleted." : "No diff available."}</span>
        </div>
      )}

      {tab.diff.trim() && (
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          <UnifiedDiff lines={lines} lang={lang} />
        </div>
      )}
    </div>
  );
}