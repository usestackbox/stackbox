import { useRef, useState, useCallback } from "react";
import { C, MONO, SANS } from "../../design";
import type { LiveDiffFile, AgentSpan } from "./types";

interface Props {
  files:        LiveDiffFile[];
  agentSpans:   AgentSpan[];
  committing:   boolean;
  pushing:      boolean;
  message:      string;
  onMessage:    (m: string) => void;
  onCommit:     () => void;
  onCommitPush: () => void;
  onPush:       () => void;
  onFileClick:  (fc: LiveDiffFile) => void;
  onStage?:     (path: string) => Promise<void>;
  onUnstage?:   (path: string) => Promise<void>;
  onDiscard?:   (path: string) => Promise<void>;
}


function reltime(ms: number) {
  if (!ms) return "";
  const d = Date.now() - ms;
  if (d < 60_000)    return "now";
  if (d < 3600_000)  return `${Math.floor(d / 60_000)}m`;
  if (d < 86400_000) return `${Math.floor(d / 3600_000)}h`;
  return `${Math.floor(d / 86400_000)}d`;
}

const INS = "rgba(74,222,128,.60)";
const DEL = "rgba(248,113,113,.60)";

const TYPE: Record<string, { label: string; labelBg: string; labelColor: string }> = {
  created:  { label: "A", labelBg: "rgba(74,222,128,.12)",  labelColor: "rgba(74,222,128,.7)"  },
  modified: { label: "M", labelBg: "rgba(255,255,255,.07)", labelColor: "rgba(255,255,255,.35)" },
  deleted:  { label: "D", labelBg: "rgba(248,113,113,.12)", labelColor: "rgba(248,113,113,.7)" },
};

// ── Full diff view ─────────────────────────────────────────────────────────────

function DiffView({ fc, onBack }: { fc: LiveDiffFile; onBack: () => void }) {
  const lines = (fc.diff ?? "").split("\n");
  const name  = fc.path.split(/[/\\]/).pop() ?? fc.path;
  const dir   = fc.path.slice(0, fc.path.length - name.length);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg0 }}>

      {/* top bar */}
      <div style={{
        height: 48, display: "flex", alignItems: "center",
        borderBottom: `1px solid ${C.border}`, flexShrink: 0, gap: 0,
      }}>
        <button onClick={onBack}
          style={{
            height: "100%", padding: "0 16px",
            background: "none", border: "none", borderRight: `1px solid ${C.border}`,
            color: C.t2, cursor: "pointer", fontSize: 13, fontFamily: SANS,
            display: "flex", alignItems: "center", gap: 6, transition: "color .1s", flexShrink: 0,
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = C.t0; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = C.t2; }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Back
        </button>

        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6, padding: "0 14px" }}>
          {dir && <span style={{ fontSize: 11, fontFamily: MONO, color: C.t3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>{dir}</span>}
          <span style={{ fontSize: 13, fontFamily: MONO, color: C.t0, fontWeight: 700, whiteSpace: "nowrap" }}>{name}</span>
        </div>

        <div style={{ display: "flex", gap: 8, paddingRight: 14, flexShrink: 0, fontFamily: MONO }}>
          {fc.insertions > 0 && <span style={{ fontSize: 13, color: INS, fontWeight: 800 }}>+{fc.insertions}</span>}
          {fc.deletions  > 0 && <span style={{ fontSize: 13, color: DEL, fontWeight: 800 }}>-{fc.deletions}</span>}
        </div>
      </div>

      {/* diff table */}
      {!fc.diff?.trim() ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 11, color: C.t3, fontFamily: SANS }}>
            {fc.change_type === "deleted" ? "File deleted" : "No diff available"}
          </span>
        </div>
      ) : (
        <div style={{ flex: 1, overflow: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: 40 }} />
              <col style={{ width: 14 }} />
              <col />
            </colgroup>
            <tbody>
              {lines.map((line, i) => {
                const isAdd  = line.startsWith("+") && !line.startsWith("+++");
                const isDel  = line.startsWith("-") && !line.startsWith("---");
                const isHunk = line.startsWith("@@");
                const isMeta = !isAdd && !isDel && !isHunk && (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("new file") || line.startsWith("deleted file"));

                const rowBg  = isAdd ? "rgba(74,222,128,.055)" : isDel ? "rgba(248,113,113,.055)" : isHunk ? "rgba(255,255,255,.01)" : "transparent";
                const gutBg  = isAdd ? "rgba(74,222,128,.10)"  : isDel ? "rgba(248,113,113,.10)"  : "rgba(255,255,255,.01)";
                const sigCol = isAdd ? "rgba(74,222,128,.45)"  : isDel ? "rgba(248,113,113,.45)"  : "transparent";
                const txtCol = isAdd  ? "rgba(160,220,160,.80)"
                             : isDel  ? "rgba(220,155,155,.80)"
                             : isHunk ? "rgba(90,120,155,.55)"
                             : isMeta ? "rgba(90,90,90,.5)"
                             : "rgba(180,180,180,.60)";

                return (
                  <tr key={i} style={{ background: rowBg }}>
                    <td style={{ padding: "0 6px", textAlign: "right", fontSize: 9, fontFamily: MONO, color: "rgba(255,255,255,.12)", userSelect: "none", background: gutBg, borderRight: `1px solid ${C.border}`, lineHeight: "18px", verticalAlign: "top" }}>
                      {(!isMeta && !isHunk) ? i + 1 : ""}
                    </td>
                    <td style={{ textAlign: "center", fontSize: 10, fontFamily: MONO, color: sigCol, userSelect: "none", background: gutBg, borderRight: `1px solid ${C.border}`, lineHeight: "18px", verticalAlign: "top" }}>
                      {isAdd ? "+" : isDel ? "−" : ""}
                    </td>
                    <td style={{ paddingLeft: 10, paddingRight: 6, lineHeight: "18px", verticalAlign: "top" }}>
                      <span style={{ fontSize: 11, color: txtCol, fontFamily: MONO, whiteSpace: "pre-wrap", wordBreak: "break-all", fontStyle: isHunk ? "italic" : "normal" }}>
                        {line || " "}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

export function ChangesTab({
  files, agentSpans,
  committing, pushing,
  message, onMessage,
  onCommit, onCommitPush, onPush, onFileClick,
  onDiscard,
}: Props) {
  const busy    = committing || pushing;
  const textRef = useRef<HTMLTextAreaElement>(null);

  const [diffFile,    setDiffFile]    = useState<LiveDiffFile | null>(null);
  const [justCommitted, setJustCommitted] = useState(false);

  const openDiff = useCallback((fc: LiveDiffFile) => {
    setDiffFile(fc);
    onFileClick(fc);
  }, [onFileClick]);

  // wrap commit to show push prompt after
  const handleCommitLocal = useCallback(async () => {
    await onCommit();
    setJustCommitted(true);
  }, [onCommit]);

  const handlePushNow = useCallback(async () => {
    setJustCommitted(false);
    await onCommitPush(); // reuse — message is already cleared so it just pushes effectively
  }, [onCommitPush]);

  const totalIns = files.reduce((s, f) => s + f.insertions, 0);
  const totalDel = files.reduce((s, f) => s + f.deletions, 0);

  // ── Diff view ──
  if (diffFile) {
    return <DiffView fc={diffFile} onBack={() => setDiffFile(null)} />;
  }

  // ── File list view ──
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>

      {/* commit box */}
      <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <textarea
          ref={textRef}
          value={message}
          onChange={e => { onMessage(e.target.value); setJustCommitted(false); }}
          placeholder="Commit message…"
          rows={2}
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); handleCommitLocal(); } }}
          style={{
            width: "100%", boxSizing: "border-box", display: "block",
            background: C.bg0, border: `1px solid ${C.border}`, borderRadius: 7,
            color: C.t0, fontSize: 13, padding: "8px 10px",
            resize: "none", outline: "none", fontFamily: SANS, lineHeight: 1.5,
            transition: "border-color .12s", marginBottom: 8,
          }}
          onFocus={e => e.currentTarget.style.borderColor = C.borderMd}
          onBlur={e  => e.currentTarget.style.borderColor = C.border}
        />

        {/* Commit + Push buttons */}
        {!justCommitted && (
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={handleCommitLocal} disabled={busy || !message.trim()}
              style={{
                flex: 1, height: 34, borderRadius: 7,
                border: `1px solid ${message.trim() && !busy ? C.borderMd : C.border}`,
                background: message.trim() && !busy ? "rgba(255,255,255,.07)" : "transparent",
                color: message.trim() && !busy ? C.t0 : C.t3,
                fontSize: 13, fontFamily: SANS, fontWeight: 500,
                cursor: message.trim() && !busy ? "pointer" : "default",
                transition: "all .1s",
              }}>
              {committing ? "Committing…" : "Commit"}
            </button>
            <button onClick={onPush} disabled={pushing}
              style={{
                height: 34, padding: "0 14px", borderRadius: 7,
                border: `1px solid ${!pushing ? C.border : C.border}`,
                background: "transparent",
                color: pushing ? C.t3 : C.t2,
                fontSize: 13, fontFamily: SANS, fontWeight: 500,
                cursor: pushing ? "default" : "pointer",
                display: "flex", alignItems: "center", gap: 5,
                transition: "all .1s", flexShrink: 0,
              }}
              onMouseEnter={e => { if (!pushing) { const el = e.currentTarget as HTMLElement; el.style.borderColor = C.borderMd; el.style.color = C.t0; el.style.background = "rgba(255,255,255,.04)"; } }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = C.border; el.style.color = pushing ? C.t3 : C.t2; el.style.background = "transparent"; }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
              </svg>
              {pushing ? "Pushing…" : "Push"}
            </button>
          </div>
        )}

        {/* Post-commit: push prompt */}
        {justCommitted && (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 12, fontFamily: SANS, color: C.t2, flex: 1 }}>
              Committed. Push now?
            </span>
            <button onClick={handlePushNow} disabled={pushing}
              style={{
                height: 34, padding: "0 16px", borderRadius: 7,
                border: `1px solid ${C.borderMd}`,
                background: "rgba(255,255,255,.07)",
                color: pushing ? C.t3 : C.t0,
                fontSize: 13, fontFamily: SANS, fontWeight: 500,
                cursor: pushing ? "default" : "pointer",
                display: "flex", alignItems: "center", gap: 5, transition: "all .1s",
              }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
              </svg>
              {pushing ? "Pushing…" : "Push"}
            </button>
            <button onClick={() => setJustCommitted(false)}
              style={{ height: 34, padding: "0 10px", borderRadius: 7, border: `1px solid ${C.border}`, background: "transparent", color: C.t3, fontSize: 12, fontFamily: SANS, cursor: "pointer" }}>
              Later
            </button>
          </div>
        )}
      </div>

      {/* file count + totals */}
      {files.length > 0 && (
        <div style={{
          padding: "7px 14px", borderBottom: `1px solid ${C.border}`,
          display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
        }}>
          <span style={{ fontSize: 11, fontFamily: MONO, color: C.t3, flex: 1, letterSpacing: "0.04em" }}>
            {files.length} FILES CHANGED
          </span>
          {totalIns > 0 && <span style={{ fontSize: 12, fontFamily: MONO, color: INS, fontWeight: 400 }}>+{totalIns}</span>}
          {totalDel > 0 && <span style={{ fontSize: 12, fontFamily: MONO, color: DEL, fontWeight: 400 }}>-{totalDel}</span>}
        </div>
      )}

      {/* list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        {files.length === 0 && (
          <div style={{ padding: "56px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <span style={{ fontSize: 13, color: C.t3, fontFamily: SANS }}>Working tree clean</span>
          </div>
        )}

        {files.map(fc => {
          const name = fc.path.split(/[/\\]/).pop() ?? fc.path;
          const dir  = fc.path.slice(0, fc.path.length - name.length);
          const t    = TYPE[fc.change_type] ?? TYPE.modified;

          return (
            <div
              key={fc.path}
              onClick={() => openDiff(fc)}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "9px 14px", cursor: "pointer",
                borderBottom: `1px solid ${C.border}`,
                transition: "background .08s",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.bg2; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>

              {/* type label pill */}
              <span style={{
                fontSize: 10, fontFamily: MONO, fontWeight: 500,
                color: t.labelColor, background: t.labelBg,
                borderRadius: 4, padding: "1px 5px", flexShrink: 0,
                letterSpacing: "0.02em",
              }}>{t.label}</span>

              {/* name + dir */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontFamily: MONO, color: C.t0, fontWeight: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {name}
                </div>
                {dir && (
                  <div style={{ fontSize: 11, fontFamily: MONO, color: C.t3, fontWeight: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>
                    {dir}
                  </div>
                )}
              </div>

              {/* ins/del */}
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                {fc.insertions > 0 && <span style={{ fontSize: 12, fontFamily: MONO, color: INS, fontWeight: 400 }}>+{fc.insertions}</span>}
                {fc.deletions  > 0 && <span style={{ fontSize: 12, fontFamily: MONO, color: DEL, fontWeight: 400 }}>-{fc.deletions}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}