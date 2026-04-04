import { useState } from "react";
import { C, MONO, SANS } from "../../design";

interface Props {
  allBranches:   string[];
  currentBranch: string;
  onSwitch:      (b: string) => void;
  onCreate?:     (b: string) => Promise<void>;
}

export function BranchesTab({ allBranches, currentBranch, onSwitch, onCreate }: Props) {
  const [showNew,   setShowNew]   = useState(false);
  const [newName,   setNewName]   = useState("");
  const [creating,  setCreating]  = useState(false);
  const [filter,    setFilter]    = useState("");

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await onCreate?.(name);
      setNewName(""); setShowNew(false);
    } finally {
      setCreating(false);
    }
  };

  const filtered = allBranches.filter(b => {
    const clean = b.replace("remotes/origin/", "").replace("heads/", "");
    return !filter || clean.toLowerCase().includes(filter.toLowerCase());
  });

  const local  = filtered.filter(b => !b.startsWith("remotes/"));
  const remote = filtered.filter(b => b.startsWith("remotes/"));

  const BranchRow = ({ b }: { b: string }) => {
    const clean    = b.replace("remotes/origin/", "").replace("heads/", "");
    const isActive = clean === currentBranch || b === currentBranch;
    const isRemote = b.startsWith("remotes/");
    return (
      <div style={{
        background: isActive ? C.bg3 : C.bg2,
        border: `1px solid ${isActive ? C.borderMd : C.border}`,
        borderRadius: 8, padding: "8px 10px",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: isActive ? C.t0 : C.t3, flexShrink: 0 }} />
        <span style={{
          fontSize: 12, fontFamily: MONO, color: isActive ? C.t0 : C.t1,
          flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {isActive && <span style={{ color: C.t3, marginRight: 5 }}>→</span>}{clean}
        </span>
        {isRemote && (
          <span style={{ fontSize: 9, fontFamily: MONO, color: C.t3, background: C.bg4, borderRadius: 4, padding: "1px 5px" }}>
            remote
          </span>
        )}
        {isActive && (
          <span style={{ fontSize: 10, fontFamily: SANS, color: C.t3, background: C.bg4, borderRadius: 6, padding: "2px 7px" }}>
            current
          </span>
        )}
        {!isActive && !isRemote && (
          <button onClick={() => onSwitch(clean)}
            style={{
              padding: "4px 10px", background: "transparent",
              border: `1px solid ${C.border}`, borderRadius: 6,
              color: C.t2, fontSize: 10, fontFamily: SANS,
              cursor: "pointer", transition: "all .1s",
            }}
            onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = C.borderMd; el.style.color = C.t0; }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = C.border; el.style.color = C.t2; }}>
            Switch
          </button>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>

      {/* Create new branch */}
      <div style={{ padding: "8px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        {!showNew ? (
          <button onClick={() => setShowNew(true)}
            style={{
              width: "100%", padding: "8px", borderRadius: 8,
              background: "transparent", border: `1px dashed ${C.border}`,
              color: C.t2, fontSize: 12, fontFamily: SANS,
              cursor: "pointer", transition: "all .15s",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}
            onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = C.borderMd; el.style.color = C.t0; el.style.background = C.bg2; }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = C.border; el.style.color = C.t2; el.style.background = "transparent"; }}>
            <span style={{ fontSize: 16, fontWeight: 300, lineHeight: 1 }}>+</span>
            New branch from current
          </button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") { setShowNew(false); setNewName(""); }
              }}
              placeholder="branch-name"
              style={{
                background: C.bg0, border: `1px solid ${C.borderMd}`, borderRadius: 8,
                color: C.t0, fontSize: 12, padding: "8px 10px", outline: "none",
                fontFamily: MONO, width: "100%", boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => { setShowNew(false); setNewName(""); }}
                style={{ padding: "7px 14px", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.t2, fontSize: 11, fontFamily: SANS, cursor: "pointer" }}>
                Cancel
              </button>
              <button onClick={handleCreate} disabled={creating || !newName.trim()}
                style={{
                  flex: 1, padding: "7px 0", borderRadius: 8, border: "none",
                  background: newName.trim() && !creating ? C.t0 : C.bg4,
                  color: newName.trim() && !creating ? C.bg0 : C.t3,
                  fontSize: 11, fontFamily: SANS, fontWeight: 600,
                  cursor: newName.trim() && !creating ? "pointer" : "default",
                }}>
                {creating ? "Creating…" : "Create & Switch"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Search */}
      {allBranches.length > 5 && (
        <div style={{ padding: "6px 8px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter branches…"
            style={{
              width: "100%", boxSizing: "border-box",
              background: C.bg0, border: `1px solid ${C.border}`, borderRadius: 7,
              color: C.t1, fontSize: 11, padding: "5px 10px", outline: "none",
              fontFamily: SANS,
            }}
          />
        </div>
      )}

      {/* Branch list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px", display: "flex", flexDirection: "column", gap: 3 }}>
        {allBranches.length === 0 && (
          <div style={{ padding: "32px 0", textAlign: "center", fontSize: 12, color: C.t2, fontFamily: SANS }}>
            No branches found.
          </div>
        )}

        {local.length > 0 && (
          <>
            {remote.length > 0 && (
              <div style={{ fontSize: 9, fontFamily: MONO, color: C.t3, letterSpacing: ".08em", padding: "4px 2px", marginTop: 2 }}>LOCAL</div>
            )}
            {local.map(b => <BranchRow key={b} b={b} />)}
          </>
        )}

        {remote.length > 0 && (
          <>
            <div style={{ fontSize: 9, fontFamily: MONO, color: C.t3, letterSpacing: ".08em", padding: "4px 2px", marginTop: 6 }}>REMOTE</div>
            {remote.map(b => <BranchRow key={b} b={b} />)}
          </>
        )}

        {filtered.length === 0 && filter && (
          <div style={{ padding: "16px 0", textAlign: "center", fontSize: 12, color: C.t3, fontFamily: SANS }}>
            No branches match "{filter}"
          </div>
        )}
      </div>
    </div>
  );
}