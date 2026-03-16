// src-tauri/src/bus.rs
// Agent Bus — pub/sub message bus scoped to a RunBox.
//
// Architecture:
//   RunBox
//     ├── Broadcast Bus  (tokio::sync::broadcast) → events, status, fan-out to all agents
//     ├── mpsc per Agent (tokio::sync::mpsc)      → direct commands, point-to-point
//     └── SQLite         (db.rs bus_messages)      → persistence, late-join catchup
//
// Backpressure policy:
//   Slow receivers get RecvError::Lagged — messages are skipped, not buffered.
//   The SSE layer logs lags but does not disconnect the client.
//   BUS_CAPACITY controls how many messages can be buffered before lag begins.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::{broadcast, mpsc};

// ── Topic registry ─────────────────────────────────────────────────────────
/// Canonical topic strings. All agents MUST use these or prefix with "custom.".
/// This prevents topic drift (e.g. "task_done" vs "task.done" vs "taskDone").
pub const TOPICS: &[&str] = &[
    "agent.started",     // agent joined a runbox session
    "agent.stopped",     // agent session ended
    "agent.delegated",   // parent agent delegated a task to a sub-agent via Task tool
    "task.started",      // agent began a task
    "task.done",         // agent completed a task successfully
    "task.failed",       // agent failed a task
    "file.changed",      // filesystem change observed
    "memory.added",      // memory written to LanceDB
    "status",            // general heartbeat / status update
    "error",             // agent-reported error
    "subagent.started",  // headless sub-agent session started
    "subagent.done",     // headless sub-agent session completed
    "subagent.output",   // captured stdout chunk from a headless sub-agent
];

pub fn is_valid_topic(topic: &str) -> bool {
    TOPICS.contains(&topic) || topic.starts_with("custom.")
}

// ── AgentId ────────────────────────────────────────────────────────────────
/// Agent identifier scoped to a RunBox. We reuse the PTY session_id for this —
/// same string, no extra ID to manage. Format: UUID string.
pub type AgentId = String;

// ── BusMessage ─────────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BusMessage {
    /// UUID4 — unique per message.
    pub id: String,
    /// Which agent published this.
    pub from: AgentId,
    /// Topic string — must pass is_valid_topic().
    pub topic: String,
    /// Plain text or JSON string — bus does not interpret this.
    pub payload: String,
    /// Unix milliseconds.
    pub timestamp: u64,
    /// Optional — links a reply to a previous message for request-reply tracing.
    pub correlation_id: Option<String>,
}

impl BusMessage {
    pub fn new(from: AgentId, topic: impl Into<String>, payload: impl Into<String>) -> Self {
        Self {
            id:             uuid::Uuid::new_v4().to_string(),
            from,
            topic:          topic.into(),
            payload:        payload.into(),
            timestamp:      now_ms(),
            correlation_id: None,
        }
    }

    pub fn with_correlation(mut self, cid: impl Into<String>) -> Self {
        self.correlation_id = Some(cid.into());
        self
    }
}

// ── Bus ────────────────────────────────────────────────────────────────────
/// One Bus per RunBox. Wraps a tokio broadcast channel.
///
/// Backpressure: BUS_CAPACITY is the ring-buffer size. If a receiver lags
/// behind by more than this many messages, it receives RecvError::Lagged.
/// The caller is responsible for handling lag (skip or reconnect).
const BUS_CAPACITY: usize = 512;

pub struct Bus {
    pub sender: broadcast::Sender<BusMessage>,
}

impl Bus {
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(BUS_CAPACITY);
        Self { sender }
    }

    /// Create a new receiver. Call once per agent that wants to subscribe.
    pub fn subscribe(&self) -> broadcast::Receiver<BusMessage> {
        self.sender.subscribe()
    }

    /// Publish a message. Validates topic before sending.
    /// Returns the number of active receivers the message was delivered to.
    /// Returns Ok(0) if no one is subscribed — this is NOT an error.
    pub fn publish(&self, msg: BusMessage) -> Result<usize, String> {
        if !is_valid_topic(&msg.topic) {
            return Err(format!(
                "invalid topic '{}' — use a topic from TOPICS or prefix with 'custom.'",
                msg.topic
            ));
        }
        Ok(self.sender.send(msg).unwrap_or(0))
    }
}

impl Default for Bus {
    fn default() -> Self {
        Self::new()
    }
}

// ── AgentHandle ────────────────────────────────────────────────────────────
/// Returned from BusRegistry::join(). Agents use this to publish to the
/// broadcast bus. They receive commands via the CommandReceiver from join().
pub struct AgentHandle {
    pub agent_id:   AgentId,
    pub bus_sender: broadcast::Sender<BusMessage>,
}

impl AgentHandle {
    /// Subscribe to the broadcast bus — receive all messages including your own.
    pub fn subscribe(&self) -> broadcast::Receiver<BusMessage> {
        self.bus_sender.subscribe()
    }

    /// Publish a message from this agent to all subscribers.
    pub fn publish(&self, topic: &str, payload: impl Into<String>) -> Result<usize, String> {
        let msg = BusMessage::new(self.agent_id.clone(), topic, payload);
        if !is_valid_topic(&msg.topic) {
            return Err(format!("invalid topic '{topic}'"));
        }
        Ok(self.bus_sender.send(msg).unwrap_or(0))
    }

    /// Publish with a correlation ID for request-reply tracing.
    pub fn publish_correlated(
        &self,
        topic:          &str,
        payload:        impl Into<String>,
        correlation_id: impl Into<String>,
    ) -> Result<usize, String> {
        let msg = BusMessage::new(self.agent_id.clone(), topic, payload)
            .with_correlation(correlation_id);
        if !is_valid_topic(&msg.topic) {
            return Err(format!("invalid topic '{topic}'"));
        }
        Ok(self.bus_sender.send(msg).unwrap_or(0))
    }
}

// ── Command channels — mpsc per agent ─────────────────────────────────────
/// Used for point-to-point commands: "tell this specific agent to do X".
/// Unlike the broadcast bus, mpsc guarantees delivery — the sender will
/// await until the receiver processes the message (bounded by capacity 64).
pub type CommandSender   = mpsc::Sender<BusMessage>;
pub type CommandReceiver = mpsc::Receiver<BusMessage>;

// ── BusRegistry ────────────────────────────────────────────────────────────
/// Global registry: RunBox → Bus, and (RunBox, AgentId) → CommandSender.
/// Wrapped in Arc by BusRegistry::new(). Share freely — all ops are lock-scoped.
#[derive(Default)]
pub struct BusRegistry {
    /// One broadcast Bus per RunBox.
    buses: Mutex<HashMap<String, Arc<Bus>>>,
    /// One mpsc CommandSender per (RunBox, AgentId).
    cmd_txs: Mutex<HashMap<String, HashMap<AgentId, CommandSender>>>,
}

impl BusRegistry {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    // ── Bus ────────────────────────────────────────────────────────────────

    /// Get or lazily create the Bus for a RunBox.
    pub fn get_or_create_bus(&self, runbox_id: &str) -> Arc<Bus> {
        let mut buses = self.buses.lock().unwrap();
        buses
            .entry(runbox_id.to_string())
            .or_insert_with(|| Arc::new(Bus::new()))
            .clone()
    }

    /// Publish directly without an AgentHandle. Used by Tauri commands and axum routes.
    pub fn publish(&self, runbox_id: &str, msg: BusMessage) -> Result<usize, String> {
        self.get_or_create_bus(runbox_id).publish(msg)
    }

    /// Subscribe to a RunBox bus. Caller gets RecvError::Lagged if too slow.
    pub fn subscribe(&self, runbox_id: &str) -> broadcast::Receiver<BusMessage> {
        self.get_or_create_bus(runbox_id).subscribe()
    }

    // ── Agent lifecycle ────────────────────────────────────────────────────

    /// Register an agent in a RunBox.
    ///
    /// Returns:
    ///   - AgentHandle  — the agent uses this to publish to the broadcast bus
    ///   - CommandReceiver — the agent listens to this for direct point-to-point commands
    pub fn join(&self, runbox_id: &str, agent_id: AgentId) -> (AgentHandle, CommandReceiver) {
        let bus = self.get_or_create_bus(runbox_id);
        let (cmd_tx, cmd_rx) = mpsc::channel(64);

        {
            let mut txs = self.cmd_txs.lock().unwrap();
            txs.entry(runbox_id.to_string())
                .or_default()
                .insert(agent_id.clone(), cmd_tx);
        }

        let handle = AgentHandle {
            agent_id,
            bus_sender: bus.sender.clone(),
        };

        (handle, cmd_rx)
    }

    /// Unregister an agent. Call on session end or pty_kill.
    pub fn leave(&self, runbox_id: &str, agent_id: &str) {
        let mut txs = self.cmd_txs.lock().unwrap();
        if let Some(agents) = txs.get_mut(runbox_id) {
            agents.remove(agent_id);
        }
    }

    // ── Direct command ─────────────────────────────────────────────────────

    /// Send a point-to-point command to a specific agent.
    ///
    /// Unlike publish(), this is not broadcast — only `to_agent` receives it.
    /// The topic is always "command" for direct messages.
    /// Awaits until the target agent's mpsc buffer has room (capacity: 64).
    pub async fn send_command(
        &self,
        runbox_id:      &str,
        to_agent:       &str,
        from:           AgentId,
        payload:        String,
        correlation_id: Option<String>,
    ) -> Result<(), String> {
        let tx = {
            let txs = self.cmd_txs.lock().unwrap();
            txs.get(runbox_id)
                .and_then(|agents| agents.get(to_agent))
                .cloned()
        };

        let tx = tx.ok_or_else(|| {
            format!("agent '{to_agent}' not found in runbox '{runbox_id}'")
        })?;

        let msg = BusMessage {
            id:             uuid::Uuid::new_v4().to_string(),
            from,
            topic:          "command".to_string(),
            payload,
            timestamp:      now_ms(),
            correlation_id,
        };

        tx.send(msg).await.map_err(|e| e.to_string())
    }

    // ── Queries ────────────────────────────────────────────────────────────

    /// List agents currently registered in a RunBox.
    pub fn agents_in(&self, runbox_id: &str) -> Vec<AgentId> {
        let txs = self.cmd_txs.lock().unwrap();
        txs.get(runbox_id)
            .map(|m| m.keys().cloned().collect())
            .unwrap_or_default()
    }

    /// Tear down all bus state for a RunBox. Call on runbox delete.
    pub fn remove_runbox(&self, runbox_id: &str) {
        self.buses.lock().unwrap().remove(runbox_id);
        self.cmd_txs.lock().unwrap().remove(runbox_id);
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}