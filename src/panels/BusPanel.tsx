import { useState, useRef, useEffect, useCallback } from "react";
import { C, MONO, SANS, PORT, reltime, topicColor } from "../shared/constants";
import { IcoBus } from "../shared/icons";
import type { BusMessage } from "../shared/types";

interface BusPanelProps {
  runboxId:     string;
  onClose:      () => void;
  onNewMessage: () => void;
}

const ALLOWED_TOPICS = ["task.started", "task.done"];

export function BusPanel({ runboxId, onClose, onNewMessage }: BusPanelProps) {
  const [messages,    setMessages]    = useState<BusMessage[]>([]);
  const [agents,      setAgents]      = useState<string[]>([]);
  const [filterTopic, setFilterTopic] = useState<string>("all");
  const [connected,   setConnected]   = useState(false);
  const esRef     = useRef<EventSource | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const refreshAgents = useCallback(() => {
    fetch(`http://localhost:${PORT}/bus/agents?runbox_id=${runboxId}`)
      .then(r => r.json())
      .then((ids: string[]) => setAgents(ids))
      .catch(() => {});
  }, [runboxId]);

  useEffect(() => {
    // Load last 50 messages from history
    fetch(`http://localhost:${PORT}/bus/history?runbox_id=${runboxId}&limit=50`)
      .then(r => r.json())
      .then((rows: any[]) => {
        const hist: BusMessage[] = rows.map(r => ({
          id:             r.id,
          from:           r.from_agent,
          topic:          r.topic,
          payload:        r.payload,
          timestamp:      r.timestamp,
          correlation_id: r.correlation_id ?? null,
        })).reverse();
        setMessages(hist);
      })
      .catch(() => {});

    refreshAgents();
    const agentPoll = setInterval(refreshAgents, 4000);

    const since = Date.now() - 1000;
    const es = new EventSource(
      `http://localhost:${PORT}/bus/stream?runbox_id=${runboxId}&since_ms=${since}`
    );
    esRef.current = es;
    es.onopen  = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      try {
        const msg: BusMessage = JSON.parse(e.data);
        if (!ALLOWED_TOPICS.includes(msg.topic)) return;
        let isNew = false;
        setMessages(prev => {
          if (prev.some(m => m.id === msg.id)) return prev;
          isNew = true;
          return [...prev.slice(-199), msg];
        });
        if (isNew) onNewMessage();
      } catch { /* ignore malformed */ }
    };

    return () => {
      es.close();
      clearInterval(agentPoll);
      setConnected(false);
    };
  }, [runboxId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const taskMessages = messages.filter(m => ALLOWED_TOPICS.includes(m.topic));
  const displayed    = filterTopic === "all" ? taskMessages : taskMessages.filter(m => m.topic === filterTopic);
  const allTopics    = Array.from(new Set(taskMessages.map(m => m.topic)));
  const shortId      = (id: string) => id.length > 8 ? id.slice(0, 8) : id;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>

      {/* Header */}
      <div style={{ padding: "11px 14px 10px", flexShrink: 0, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8 }}>
        <IcoBus on />
        <span style={{ fontSize: 13, fontWeight: 600, color: C.t0, flex: 1, fontFamily: SANS }}>Agent Bus</span>
        <span title={connected ? "Connected" : "Disconnected"}
          style={{ width: 6, height: 6, borderRadius: "50%", background: connected ? C.green : C.t2, flexShrink: 0 }} />
        <button onClick={onClose}
          style={{ background: "none", border: "none", color: C.t2, cursor: "pointer", fontSize: 16, padding: "2px 5px", borderRadius: 4, lineHeight: 1 }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.t0}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.t2}>×</button>
      </div>

      {/* Active agents */}
      {agents.length > 0 && (
        <div style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}`, flexShrink: 0, display: "flex", flexWrap: "wrap", gap: 4 }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: C.t2, fontFamily: SANS, alignSelf: "center", marginRight: 2 }}>Live</span>
          {agents.map(a => (
            <span key={a} style={{ fontSize: 10, fontFamily: MONO, color: C.tealText, background: C.tealDim, border: `1px solid ${C.tealBorder}`, borderRadius: 4, padding: "1px 6px" }}>
              {shortId(a)}
            </span>
          ))}
        </div>
      )}

      {/* Topic filter */}
      <div style={{ padding: "7px 12px", borderBottom: `1px solid ${C.border}`, flexShrink: 0, display: "flex", gap: 4, overflowX: "auto" }}>
        {["all", ...allTopics].map(t => (
          <button key={t} onClick={() => setFilterTopic(t)}
            style={{ fontSize: 10, fontFamily: SANS, fontWeight: 500, padding: "2px 8px", borderRadius: 4, border: `1px solid ${filterTopic === t ? topicColor(t) : C.border}`, background: filterTopic === t ? `${topicColor(t)}18` : "none", color: filterTopic === t ? topicColor(t) : C.t2, cursor: "pointer", flexShrink: 0, transition: "all .1s" }}>
            {t}
          </button>
        ))}
      </div>

      {/* Message feed */}
      <div style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
        {displayed.length === 0 && (
          <div style={{ padding: "32px 0", textAlign: "center", color: C.t2, fontSize: 12, fontFamily: SANS }}>
            {connected ? "Waiting for messages…" : "Connecting…"}
          </div>
        )}
        {displayed.map(msg => {
          const tc = topicColor(msg.topic);
          const ts = reltime(msg.timestamp);
          let payloadText = msg.payload;
          try {
            const obj = JSON.parse(msg.payload);
            payloadText = JSON.stringify(obj, null, 0);
            if (typeof obj === "object" && Object.keys(obj).length <= 3)
              payloadText = Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join("  ·  ");
          } catch { /* leave as-is */ }

          return (
            <div key={msg.id}
              style={{ padding: "7px 14px", borderBottom: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 3 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 700, fontFamily: SANS, color: tc, background: `${tc}18`, border: `1px solid ${tc}33`, borderRadius: 3, padding: "1px 5px", flexShrink: 0 }}>
                  {msg.topic}
                </span>
                <span style={{ fontSize: 10, fontFamily: MONO, color: C.t2, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {shortId(msg.from)}
                </span>
                {ts && <span style={{ fontSize: 10, color: C.t2, fontFamily: SANS, flexShrink: 0 }}>{ts}</span>}
              </div>
              {payloadText && (
                <div style={{ fontSize: 11, fontFamily: MONO, color: C.t1, wordBreak: "break-word", lineHeight: 1.5, paddingLeft: 2 }}>
                  {payloadText.length > 180 ? payloadText.slice(0, 180) + "…" : payloadText}
                </div>
              )}
              {msg.correlation_id && (
                <div style={{ fontSize: 9, fontFamily: MONO, color: C.t3 }}>↩ {shortId(msg.correlation_id)}</div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Footer */}
      <div style={{ padding: "6px 14px", borderTop: `1px solid ${C.border}`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 10, color: C.t2, fontFamily: SANS }}>{taskMessages.length} message{taskMessages.length !== 1 ? "s" : ""}</span>
        <button onClick={() => setMessages([])}
          style={{ fontSize: 10, color: C.t2, background: "none", border: "none", cursor: "pointer", fontFamily: SANS, padding: 0 }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = C.t0}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = C.t2}>
          Clear
        </button>
      </div>
    </div>
  );
}