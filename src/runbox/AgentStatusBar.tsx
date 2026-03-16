import { useState, useRef, useEffect } from "react";
import { C, MONO, SANS, PORT } from "../shared/constants";

interface ClaimedTask { sessionId: string; description: string; claimedAt: number; }

export function AgentStatusBar({ runboxId }: { runboxId: string }) {
  const [activeAgents, setActiveAgents] = useState<string[]>([]);
  const [claimedTasks, setClaimedTasks] = useState<ClaimedTask[]>([]);
  const [recentDone,   setRecentDone]   = useState<{ sessionId: string; summary: string }[]>([]);
  const esRef        = useRef<EventSource | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshFromApi = () => {
    fetch(`http://localhost:${PORT}/bus/agents?runbox_id=${runboxId}`)
      .then(r => r.json()).then((ids: string[]) => setActiveAgents(ids)).catch(() => {});
    fetch(`http://localhost:${PORT}/bus/tasks_in_progress?runbox_id=${runboxId}`)
      .then(r => r.json())
      .then((tasks: { session_id: string; task: string; timestamp: number }[]) => {
        setClaimedTasks(tasks.map(t => ({ sessionId: t.session_id, description: t.task, claimedAt: t.timestamp })));
      }).catch(() => {});
    fetch(`http://localhost:${PORT}/bus/history?runbox_id=${runboxId}&limit=20&topic=task.done`)
      .then(r => r.json())
      .then((rows: any[]) => {
        setRecentDone(rows.slice(0, 3).map(r => ({ sessionId: r.from_agent, summary: r.payload.slice(0, 80) })));
      }).catch(() => {});
  };

  const connectSSE = () => {
    const es = new EventSource(`http://localhost:${PORT}/bus/stream?runbox_id=${runboxId}&since_ms=${Date.now() - 2000}`);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as { topic: string; from: string; payload: string; timestamp: number };
        const p = (() => { try { return JSON.parse(msg.payload); } catch { return {}; } })();
        if (msg.topic === "agent.started")
          setActiveAgents(prev => prev.includes(msg.from) ? prev : [...prev, msg.from]);
        if (msg.topic === "agent.stopped") {
          setActiveAgents(prev => prev.filter(s => s !== msg.from));
          setClaimedTasks(prev => prev.filter(c => c.sessionId !== msg.from));
        }
        if (msg.topic === "task.started") {
          const desc = p.task ?? msg.payload.slice(0, 80);
          setClaimedTasks(prev => [...prev.filter(c => c.sessionId !== msg.from), { sessionId: msg.from, description: desc, claimedAt: msg.timestamp }]);
        }
        if (msg.topic === "task.done") refreshFromApi();
        if (msg.topic === "task.failed" || msg.topic === "error")
          setClaimedTasks(prev => prev.filter(c => c.sessionId !== msg.from));
      } catch {}
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      reconnectRef.current = setTimeout(connectSSE, 3000);
    };
  };

  useEffect(() => {
    refreshFromApi();
    connectSSE();
    return () => {
      esRef.current?.close();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runboxId]);

  const shortId = (id: string) => id.slice(0, 8);
  if (activeAgents.length === 0 && claimedTasks.length === 0 && recentDone.length === 0) return null;

  return (
    <div style={{ background: C.bg1, borderBottom: `1px solid ${C.border}`, padding: "5px 12px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", flexShrink: 0, minHeight: 28 }}>
      {activeAgents.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" as const, color: C.t2, fontFamily: SANS }}>Active</span>
          {activeAgents.map(a => (
            <span key={a} title={a} style={{ fontSize: 10, fontFamily: MONO, color: C.tealText, background: C.tealDim, border: `1px solid ${C.tealBorder}`, borderRadius: 4, padding: "1px 5px" }}>{shortId(a)}</span>
          ))}
        </div>
      )}
      {claimedTasks.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 5, flex: 1, flexWrap: "wrap" as const }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" as const, color: C.amber, fontFamily: SANS }}>In progress</span>
          {claimedTasks.map(t => (
            <span key={t.sessionId} title={`${t.sessionId}: ${t.description}`} style={{ fontSize: 10, fontFamily: SANS, color: C.amber, background: C.amberBg, border: `1px solid ${C.amber}33`, borderRadius: 4, padding: "1px 7px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
              <span style={{ color: C.t2, marginRight: 4, fontFamily: MONO }}>{shortId(t.sessionId)}</span>
              {t.description.length > 40 ? t.description.slice(0, 40) + "…" : t.description}
            </span>
          ))}
        </div>
      )}
      {recentDone.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" as const }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" as const, color: C.green, fontFamily: SANS }}>Done</span>
          {recentDone.map((d, i) => (
            <span key={i} title={d.summary} style={{ fontSize: 10, fontFamily: SANS, color: C.green, background: C.greenBg, border: `1px solid ${C.green}33`, borderRadius: 4, padding: "1px 7px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
              <span style={{ color: C.t2, marginRight: 4, fontFamily: MONO }}>{shortId(d.sessionId)}</span>
              {d.summary.length > 35 ? d.summary.slice(0, 35) + "…" : d.summary}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}