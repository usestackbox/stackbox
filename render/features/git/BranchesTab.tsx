import { C, MONO, SANS } from "../../design";

interface Props {
  allBranches:  string[];
  currentBranch: string;
  onSwitch:     (b: string) => void;
}

export function BranchesTab({ allBranches, currentBranch, onSwitch }: Props) {
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "8px", display: "flex", flexDirection: "column", gap: 3 }}>
      {allBranches.length === 0 && (
        <div style={{ padding: "32px 0", textAlign: "center", fontSize: 12, color: C.t2, fontFamily: SANS }}>No branches found.</div>
      )}
      {allBranches.map(b => {
        const clean    = b.replace("remotes/origin/", "").replace("heads/", "");
        const isActive = clean === currentBranch || b === currentBranch;
        const isRemote = b.startsWith("remotes/");
        return (
          <div key={b} style={{ background: isActive ? C.bg3 : C.bg2, border: `1px solid ${isActive ? C.borderMd : C.border}`, borderRadius: 8, padding: "8px 10px", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: isActive ? C.t0 : C.t3, flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontFamily: MONO, color: isActive ? C.t0 : C.t1, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {isActive && <span style={{ color: C.t3, marginRight: 5 }}>→</span>}{clean}
            </span>
            {isRemote && <span style={{ fontSize: 9, fontFamily: MONO, color: C.t3, background: C.bg4, borderRadius: 4, padding: "1px 5px" }}>remote</span>}
            {isActive && <span style={{ fontSize: 10, fontFamily: SANS, color: C.t3, background: C.bg4, borderRadius: 6, padding: "2px 7px" }}>current</span>}
            {!isActive && !isRemote && (
              <button onClick={() => onSwitch(clean)}
                style={{ padding: "4px 10px", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 6, color: C.t2, fontSize: 10, fontFamily: SANS, cursor: "pointer", transition: "all .1s" }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = C.borderMd; el.style.color = C.t0; }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = C.border; el.style.color = C.t2; }}>
                Switch
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}