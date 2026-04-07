// src/pty/writer.rs
//
// PtyWriter holds write handles for all active PTY sessions.
// The webhook handler calls write(runbox_id, text) to inject feedback
// directly into an agent's terminal — the agent reads it naturally.
//
// Thread-safe: Arc<Mutex<HashMap>> under the hood.
//
// Usage in pty/mod.rs (after spawning):
//   let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
//   state.pty_writer.register(&runbox_id, tx);
//
//   // Forward incoming bytes to the PTY writer in a background task:
//   let mut pty_w = pair.master.take_writer()?;
//   tauri::async_runtime::spawn(async move {
//       while let Some(bytes) = rx.recv().await {
//           let _ = pty_w.write_all(&bytes);
//       }
//   });
//
// On PTY exit:
//   state.pty_writer.unregister(&runbox_id);

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

#[derive(Clone)]
pub struct PtyWriter {
    senders: Arc<Mutex<HashMap<String, tokio::sync::mpsc::UnboundedSender<Vec<u8>>>>>,
}

impl PtyWriter {
    pub fn new() -> Self {
        Self {
            senders: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Register a PTY when it spawns.
    /// `sender` forwards bytes into the PTY's stdin via an async forwarder task.
    pub fn register(&self, runbox_id: &str, sender: tokio::sync::mpsc::UnboundedSender<Vec<u8>>) {
        self.senders
            .lock()
            .unwrap()
            .insert(runbox_id.to_string(), sender);
        eprintln!("[pty_writer] registered: {runbox_id}");
    }

    /// Unregister a PTY when it exits.
    pub fn unregister(&self, runbox_id: &str) {
        self.senders.lock().unwrap().remove(runbox_id);
        eprintln!("[pty_writer] unregistered: {runbox_id}");
    }

    /// Write text into the agent's PTY stdin.
    /// A trailing newline is appended so the agent processes the input line.
    pub fn write(&self, runbox_id: &str, text: &str) -> Result<(), String> {
        let guard = self.senders.lock().unwrap();
        let Some(sender) = guard.get(runbox_id) else {
            return Err(format!("no PTY registered for runbox: {runbox_id}"));
        };

        let mut bytes = text.as_bytes().to_vec();
        if !bytes.ends_with(b"\n") {
            bytes.push(b'\n');
        }

        sender
            .send(bytes)
            .map_err(|e| format!("PTY send error: {e}"))
    }

    /// Check whether a PTY is still alive.
    pub fn is_alive(&self, runbox_id: &str) -> bool {
        self.senders.lock().unwrap().contains_key(runbox_id)
    }

    /// List all active runbox IDs (for debugging / dashboard).
    pub fn active_ids(&self) -> Vec<String> {
        self.senders.lock().unwrap().keys().cloned().collect()
    }
}

impl Default for PtyWriter {
    fn default() -> Self {
        Self::new()
    }
}
