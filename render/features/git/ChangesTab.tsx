import { useRef } from "react";
import { C, MONO, SANS } from "../../design";
import type { LiveDiffFile } from "./types";

interface Props {
  files:        LiveDiffFile[];
  committing:   boolean;
  pushing:      boolean;
  message:      string;
  onMessage:    (m: string) => void;
  onCommit:     () => void;
  onCommitPush: () => void;
  onFileClick:  (fc: LiveDiffFile) => void;
}

const CHANGE_LETTER = { created: "A", modified: "M", deleted: "D" } as const;
const changeColor = (t: "created" | "modified" | "deleted") =>
  t === "created" ? C.green : t === "deleted" ? C.red : C.t2;

export function ChangesTab({ files, committing, pushing, message, onMessage, onCommit, onCommitPush, onFileClick }: Props) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const busy    = committing || pushing;

  const totalIns = files.reduce((s, f) => s + f.insertions, 0);
  const totalDel = files.reduce((s, f) => s + f.deletions, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {files.length > 0 && (
        <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          {[{ l: "ADDED", val: files.filter(f => f.change_type === "created").length },
            { l: "CHANGED", val: files.filter(f => f.change_type === "modified").length },
            { l: "DELETED", val: files.filter(f => f.change_type === "deleted").length }]
            .filter(x => x.val > 0).map(({ l, val }) => (
              <div key={l} style={{ flex: 1, padding: "6px 12px", borderRight: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 8, fontFamily: MONO, letterSpacing: ".10em", color: C.t3, marginBottom: 2 }}>{l}</div>
                <span style={{ fontSize: 14, fontFamily: MONO, fontWeight: 700, color: l === "ADDED" ? C.green : l === "DELETED" ? C.red : C.t0 }}>{val}</span>
              </div>
            ))}
          {(totalIns > 0 || totalDel > 0) && (
            <div style={{ flex: 1, padding: "6px 12px" }}>
              <div style={{ fontSize: 8, fontFamily: MONO, letterSpacing: ".10em", color: C.t3, marginBottom: 2 }}>LINES</div>
              <div style={{ display: "flex", gap: 4 }}>
                {totalIns > 0 && <span style={{ fontSize: 12, fontFamily: MONO, fontWeight: 700, color: C.green }}>+{totalIns}</span>}
                {totalDel > 0 && <span style={{ fontSize: 12, fontFamily: MONO, fontWeight: 700, color: C.red }}>-{totalDel}</span>}
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ padding: "8px", borderBottom: `1px solid ${C.border}`, flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <textarea ref={textRef} value={message} onChange={e => onMessage(e.target.value)}
          placeholder="Commit message…" rows={2}
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); onCommit(); } }}
          style={{ width: "100%", boxSizing: "border-box", background: C.bg0, border: `1px solid ${C.border}`, borderRadius: 8, color: C.t0, fontSize: 12, padding: "8px 10px", resize: "none", outline: "none", fontFamily: SANS, lineHeight: 1.5, transition: "border-color .15s" }}
          onFocus={e => e.currentTarget.style.borderColor = C.borderHi}
          onBlur={e => e.currentTarget.style.borderColor = C.border} />
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={onCommit} disabled={busy || !message.trim()}
            style={{ flex: 1, padding: "7px 0", borderRadius: 8, border: `1px solid ${message.trim() && !busy ? C.borderMd : C.border}`, background: message.trim() && !busy ? C.bg4 : "transparent", color: message.trim() && !busy ? C.t0 : C.t3, fontSize: 11, fontFamily: SANS, fontWeight: 600, cursor: message.trim() && !busy ? "pointer" : "default", transition: "all .1s" }}>
            {committing && !pushing ? "…" : "✓ Commit"}
          </button>
          <button onClick={onCommitPush} disabled={busy || !message.trim()}
            style={{ flex: 1, padding: "7px 0", borderRadius: 8, border: `1px solid ${message.trim() && !busy ? C.borderMd : C.border}`, background: "transparent", color: message.trim() && !busy ? C.t1 : C.t3, fontSize: 11, fontFamily: SANS, fontWeight: 600, cursor: message.trim() && !busy ? "pointer" : "default", transition: "all .1s" }}>
            {pushing ? "…" : "↑ Commit & Push"}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "8px", display: "flex", flexDirection: "column", gap: 3 }}>
        {files.length === 0 && (
          <div style={{ padding: "32px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            <span style={{ fontSize: 12, color: C.t2, fontFamily: SANS }}>No changes</span>
          </div>
        )}
        {files.map(fc => {
          const fileName  = fc.path.split(/[/\\]/).pop() ?? fc.path;
          const dirPart   = fc.path.slice(0, fc.path.length - fileName.length);
          const letter    = CHANGE_LETTER[fc.change_type];
          const lColor    = changeColor(fc.change_type);
          return (
            <div key={fc.path} onClick={() => onFileClick(fc)}
              style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px", cursor: "pointer", transition: "all .1s", display: "flex", alignItems: "center", gap: 8 }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = C.bg3; el.style.borderColor = C.borderMd; }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = C.bg2; el.style.borderColor = C.border; }}>
              <span style={{ fontSize: 10, fontFamily: MONO, fontWeight: 700, color: lColor, width: 10, flexShrink: 0, textAlign: "center" }}>{letter}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontFamily: MONO, color: C.t0, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fileName}</div>
                {dirPart && <div style={{ fontSize: 10, fontFamily: MONO, color: C.t2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>{dirPart}</div>}
              </div>
              <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                {fc.insertions > 0 && <span style={{ fontSize: 10, fontFamily: MONO, color: C.green, fontWeight: 600 }}>+{fc.insertions}</span>}
                {fc.deletions  > 0 && <span style={{ fontSize: 10, fontFamily: MONO, color: C.red,   fontWeight: 600 }}>-{fc.deletions}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}