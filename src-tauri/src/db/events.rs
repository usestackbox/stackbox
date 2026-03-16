// src-tauri/src/db/events.rs
//
// Workspace event persistence — append-only.
// All writes go through event_record(). Never call UPDATE on this table.

use rusqlite::{params, Result};

use super::{Db, WorkspaceEvent, now_ms};

/// Insert one workspace event. This is the ONLY way to write events.
/// Append-only — no updates, no deletes (except on runbox delete).
pub fn event_record(
    db:           &Db,
    runbox_id:    &str,
    session_id:   &str,
    event_type:   &str,
    source:       &str,
    payload_json: &str,
) -> Result<()> {
    let id           = uuid::Uuid::new_v4().to_string();
    let runbox_id    = runbox_id.to_string();
    let session_id   = session_id.to_string();
    let event_type   = event_type.to_string();
    let source       = source.to_string();
    let payload_json = payload_json.to_string();
    let ts           = now_ms();

    db.write_async(move |conn| {
        let _ = conn.execute(
            "INSERT INTO workspace_events
                 (id, runbox_id, session_id, event_type, source, payload_json, timestamp)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, runbox_id, session_id, event_type, source, payload_json, ts],
        );
    });
    Ok(())
}

/// Most recent N events for a runbox — used by EventTimelinePanel.
pub fn events_recent(db: &Db, runbox_id: &str, limit: usize) -> Result<Vec<WorkspaceEvent>> {
    let conn = db.read();
    let mut stmt = conn.prepare(
        "SELECT id, runbox_id, session_id, event_type, source, payload_json, timestamp
         FROM workspace_events
         WHERE runbox_id = ?1
         ORDER BY timestamp DESC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![runbox_id, limit as i64], event_from_row)?;
    rows.collect()
}

/// Events since a timestamp — used by SSE replay.
pub fn events_since(db: &Db, runbox_id: &str, since_ms: i64, limit: usize) -> Result<Vec<WorkspaceEvent>> {
    let conn = db.read();
    let mut stmt = conn.prepare(
        "SELECT id, runbox_id, session_id, event_type, source, payload_json, timestamp
         FROM workspace_events
         WHERE runbox_id = ?1 AND timestamp >= ?2
         ORDER BY timestamp ASC
         LIMIT ?3",
    )?;
    let rows = stmt.query_map(params![runbox_id, since_ms, limit as i64], event_from_row)?;
    rows.collect()
}

/// Events by type — used by context builder to get recent CommandResult etc.
pub fn events_by_type(
    db:         &Db,
    runbox_id:  &str,
    event_type: &str,
    limit:      usize,
) -> Result<Vec<WorkspaceEvent>> {
    let conn = db.read();
    let mut stmt = conn.prepare(
        "SELECT id, runbox_id, session_id, event_type, source, payload_json, timestamp
         FROM workspace_events
         WHERE runbox_id = ?1 AND event_type = ?2
         ORDER BY timestamp DESC
         LIMIT ?3",
    )?;
    let rows = stmt.query_map(params![runbox_id, event_type, limit as i64], event_from_row)?;
    rows.collect()
}

/// Delete all events for a runbox — called on runbox delete only.
pub fn events_delete_for_runbox(db: &Db, runbox_id: &str) {
    let runbox_id = runbox_id.to_string();
    db.write_async(move |conn| {
        let _ = conn.execute(
            "DELETE FROM workspace_events WHERE runbox_id = ?1",
            params![runbox_id],
        );
    });
}

fn event_from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<WorkspaceEvent> {
    Ok(WorkspaceEvent {
        id:           r.get(0)?,
        runbox_id:    r.get(1)?,
        session_id:   r.get(2)?,
        event_type:   r.get(3)?,
        source:       r.get(4)?,
        payload_json: r.get(5)?,
        timestamp:    r.get(6)?,
    })
}
