// src-tauri/src/agent/supercontext.rs
// Supercontext V3 — auto session fallback only.
//
// REMOVED (V3):
//   git_cold_ingest   — git history was noise, not signal
//   save_classified   — agents write memory intentionally via remember()
//   ResponseCapture   — moved to detection.rs, no longer used
//   OutputClassifier  — deleted from detection.rs
//
// KEPT:
//   auto_session_summary — fallback if agent doesn't call session_summary()

use crate::memory;

// ── Auto session summary fallback ─────────────────────────────────────────────
// Called on session-end when agent didn't write a session_summary().
// Generates a weak-signal summary from recent workspace events.
// Agent-written summary always takes priority (checked before writing).

pub async fn auto_session_summary(
    runbox_id: &str,
    session_id: &str,
    agent_name: &str,
    db: &crate::db::Db,
) {
    let agent_type = memory::agent_type_from_name(agent_name);
    let agent_id = memory::make_agent_id(&agent_type, session_id);

    // Skip if agent already wrote a session summary this session
    let existing = memory::memories_for_runbox(runbox_id)
        .await
        .unwrap_or_default();
    let has_summary = existing.iter().any(|m| {
        m.agent_id == agent_id
            && m.effective_level() == memory::LEVEL_SESSION
            && m.session_id == session_id
    });
    if has_summary {
        return;
    }

    // Build from last 20 workspace events
    let events = crate::db::events::events_recent(db, runbox_id, 20).unwrap_or_default();
    if events.is_empty() {
        return;
    }

    let mut files_changed: Vec<String> = Vec::new();
    let mut commands_run: Vec<String> = Vec::new();

    for evt in &events {
        match evt.event_type.as_str() {
            "FileChanged" => {
                if let Ok(p) = serde_json::from_str::<serde_json::Value>(&evt.payload_json) {
                    if let Some(path) = p.get("path").and_then(|v| v.as_str()) {
                        files_changed.push(path.to_string());
                    }
                }
            }
            "CommandExecuted" => {
                if let Ok(p) = serde_json::from_str::<serde_json::Value>(&evt.payload_json) {
                    if let Some(cmd) = p.get("command").and_then(|v| v.as_str()) {
                        commands_run.push(cmd.chars().take(60).collect());
                    }
                }
            }
            _ => {}
        }
    }

    files_changed.dedup();
    commands_run.dedup();

    let mut lines: Vec<String> = Vec::new();
    if !files_changed.is_empty() {
        let sample: Vec<_> = files_changed.iter().take(5).collect();
        lines.push(format!(
            "Files changed: {}",
            sample
                .iter()
                .map(|s| s.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    if !commands_run.is_empty() {
        let sample: Vec<_> = commands_run.iter().take(3).collect();
        lines.push(format!(
            "Commands run: {}",
            sample
                .iter()
                .map(|s| s.as_str())
                .collect::<Vec<_>>()
                .join(" · ")
        ));
    }
    lines.push("[auto-generated — agent did not call session_summary()]".to_string());

    if lines.is_empty() {
        return;
    }

    let content = lines.join("\n");

    let _ = memory::session_summary(runbox_id, session_id, &agent_id, agent_name, &content).await;

    crate::agent::globals::emit_memory_added(runbox_id);
    eprintln!("[supercontext] auto session summary written for session={session_id}");
}
