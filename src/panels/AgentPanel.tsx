import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { C, MONO, SANS, PORT } from "../shared/constants";
import { IcoAgents } from "../shared/icons";
import type { BusMessage, SubAgent } from "../shared/types";

interface AgentPanelProps {
  runboxId:        string;
  parentSessionId: string | null;
  onClose:         () => void;
}

export function AgentPanel({ runboxId, parentSessionId, onClose }: AgentPanelProps) {
  const [agents,    setAgents]    = useState<SubAgent[]>([]);
  const [agentDefs, setAgentDefs] = useState<{ name: string; description: string; tools: string }[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  // Load available .claude/agents/ definitions
  useEffect(() => {
    invoke<{ name: string; description: string; tools: string }[]>("list_agent_definitions")
      .then(defs => setAgentDefs(defs))
      .catch(() => {});
  }, []);

  useEffect(() => {
    // Replay history first
    fetch(`http://localhost:${PORT}/bus/history?runbox_id=${runboxId}&limit=200`)
      .then(r => r.json())
      .then((rows: any[]) => {
        const next: SubAgent[] = [];
        for (const r of rows) {
          const topic   = r.topic as string;
          const from    = r.from_agent as string;
          const payload = (() => { try { return JSON.parse(r.payload); } catch { return {}; } })();

          if (topic === "subagent.started") {
            next.push({ sessionId: from, parentSession: payload.parent_session ?? r.correlation_id ?? "", task: payload.task ?? "", status: "running", startedAt: r.timestamp, outputLines: [], expanded: false });
          } else if (topic === "subagent.done") {
            const idx = next.findIndex(a => a.sessionId === from);
            if (idx !== -1) { next[idx].status = "done"; next[idx].endedAt = r.timestamp; }
          } else if (topic === "task.failed" || topic === "error") {
            const idx = next.findIndex(a => a.sessionId === from);
            if (idx !== -1) { next[idx].status = "failed"; next[idx].endedAt = r.timestamp; }
          } else if (topic === "subagent.output") {
            const idx = next.findIndex(a => a.sessionId === from);
            if (idx !== -1) {
              const stripped = (r.payload as string).replace(/\x1b\[[0-9;]*m/g, "").trim();
              if (stripped) next[idx].outputLines.push(stripped);
            }
          } else if (topic === "agent.delegated") {
            const childId = payload.child_session ?? "";
            if (childId && !next.find(a => a.sessionId === childId))
              next.push({ sessionId: childId, parentSession: from, task: payload.task ?? "", status: "running", startedAt: r.timestamp, outputLines: [], expanded: false });
          }
        }
        setAgents(next);
      })
      .catch(() => {});

    const since = Date.now() - 2000;
    const es = new EventSource(
      `http://localhost:${PORT}/bus/stream?runbox_id=${runboxId}&since_ms=${since}`
    );
    esRef.current = es;
    es.onopen  = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.onmessage = (e) => {
      try {
        const msg: BusMessage = JSON.parse(e.data);
        const payload = (() => { try { return JSON.parse(msg.payload); } catch { return {}; } })();

        setAgents(prev => {
          const next = [...prev];

          if (msg.topic === "agent.delegated") {
            const childId = payload.child_session ?? msg.correlation_id ?? "";
            if (childId && !next.find(a => a.sessionId === childId))
              next.push({ sessionId: childId, parentSession: msg.from, task: payload.task ?? "", status: "running", startedAt: msg.timestamp, outputLines: [], expanded: false });
          } else if (msg.topic === "subagent.started") {
            if (!next.find(a => a.sessionId === msg.from))
              next.push({ sessionId: msg.from, parentSession: payload.parent_session ?? "", task: payload.task ?? "", status: "running", startedAt: msg.timestamp, outputLines: [], expanded: false });
          } else if (msg.topic === "subagent.done") {
            const idx = next.findIndex(a => a.sessionId === msg.from);
            if (idx !== -1) next[idx] = { ...next[idx], status: "done", endedAt: msg.timestamp };
          } else if (msg.topic === "task.failed" || msg.topic === "error") {
            const idx = next.findIndex(a => a.sessionId === msg.from);
            if (idx !== -1 && next[idx].status === "running")
              next[idx] = { ...next[idx], status: "failed", endedAt: msg.timestamp };
          } else if (msg.topic === "subagent.output") {
            const idx = next.findIndex(a => a.sessionId === msg.from);
            if (idx !== -1) {
              const stripped = msg.payload.replace(/\x1b\[[0-9;]*m/g, "").trim();
              if (stripped)
                next[idx] = { ...next[idx], outputLines: [...next[idx].outputLines.slice(-199), stripped] };
            }
          }
          return next;
        });
      } catch { /* ignore */ }
    };

    return () => { es.close(); setConnected(false); };
  }, [runboxId]);

  const toggleExpand = (sid: string) =>
    setAgents(p => p.map(a => a.sessionId === sid ? { ...a, expanded: !a.expanded } : a));

  const shortId  = (id: string) => id.slice(0, 8);
  const duration = (a: SubAgent) => {
    const ms = (a.endedAt ?? Date.now()) - a.startedAt;
    return ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60000)}m`;
  };

  const displayed = parentSessionId
    ? agents.filter(a => a.parentSession === parentSessionId)
    : agents;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>

      {/* Header */}
      <div style={{ padding: "11px 14px 10px", flexShrink: 0, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8 }}>
        <IcoAgents on />
        <span style={{ fontSize: 13, fontWeight: 600, color: C.t0, flex: 1, fontFamily: SANS }}>Sub-agents</span>
        <span title={connected ? "Connected" : "Disconnected"}
          style={{ width: 6, height: 6, borderRadius: "50%", background: connected ? C.green : C.t2, flexShrink: 0 }} />
        <button onClick={onClose}
          style={{ background: "none", border: "none", color: C.t2, cursor: "pointer", fontSize: 16, padding: "2px 5px", borderRadius: 4, lineHeight: 1 }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.t0}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.t2}>×</button>
      </div>

      {/* Available agent definitions */}
      {agentDefs.length > 0 && (
        <div style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: C.t2, fontFamily: SANS, marginBottom: 5 }}>Available specialists</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {agentDefs.map(d => (
              <span key={d.name} title={d.description}
                style={{ fontSize: 10, fontFamily: MONO, color: C.blue, background: C.blueDim, border: `1px solid rgba(88,166,255,.2)`, borderRadius: 4, padding: "1px 7px", cursor: "default" }}>
                {d.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Task cards */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {displayed.length === 0 && (
          <div style={{ padding: "40px 16px", textAlign: "center", color: C.t2, fontSize: 12, fontFamily: SANS, lineHeight: 1.8 }}>
            No sub-agents yet.<br />
            <span style={{ color: C.t3, fontSize: 11 }}>They appear when an agent spawns a child via the Task tool or POST /bus/spawn.</span>
          </div>
        )}
        {displayed.map(agent => {
          const statusColor = agent.status === "done" ? C.green : agent.status === "failed" ? C.redBright : C.amber;
          const statusDot   = agent.status === "running" ? "◌" : agent.status === "done" ? "●" : "✕";
          return (
            <div key={agent.sessionId} style={{ borderBottom: `1px solid ${C.border}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", cursor: "pointer" }}
                onClick={() => toggleExpand(agent.sessionId)}>
                <span style={{ color: statusColor, fontSize: 11, flexShrink: 0, fontFamily: MONO }}>{statusDot}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: C.t0, fontFamily: SANS, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {agent.task || shortId(agent.sessionId)}
                  </div>
                  <div style={{ fontSize: 10, color: C.t2, fontFamily: MONO, marginTop: 1 }}>
                    {shortId(agent.sessionId)} · {duration(agent)}
                  </div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, color: statusColor, background: `${statusColor}18`, border: `1px solid ${statusColor}33`, borderRadius: 3, padding: "1px 5px", fontFamily: SANS, flexShrink: 0 }}>
                  {agent.status}
                </span>
                <span style={{ fontSize: 10, color: C.t2, flexShrink: 0, fontFamily: MONO, transform: agent.expanded ? "rotate(180deg)" : "none", display: "inline-block", transition: "transform .15s" }}>▾</span>
              </div>

              {agent.expanded && (
                <div style={{ background: C.bg0, borderTop: `1px solid ${C.border}`, maxHeight: 220, overflowY: "auto", padding: "8px 14px" }}>
                  {agent.outputLines.length === 0 ? (
                    <div style={{ fontSize: 11, color: C.t3, fontFamily: MONO }}>No output captured yet.</div>
                  ) : (
                    agent.outputLines.slice(-100).map((line: string, i: number) => (
                      <div key={i} style={{ fontSize: 11, fontFamily: MONO, color: C.t1, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{line}</div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{ padding: "6px 14px", borderTop: `1px solid ${C.border}`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 10, color: C.t2, fontFamily: SANS }}>{displayed.length} sub-agent{displayed.length !== 1 ? "s" : ""}</span>
        <button onClick={() => setAgents([])}
          style={{ fontSize: 10, color: C.t2, background: "none", border: "none", cursor: "pointer", fontFamily: SANS, padding: 0 }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.t0}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.t2}>Clear</button>
      </div>
    </div>
  );
}