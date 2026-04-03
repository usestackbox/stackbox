

use rusqlite::{params, Result};
use super::{Db, WorkspaceEvent, now_ms};
use serde_json;

/// Insert one workspace event. This is the ONLY way to write events.
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
    let payload_json = sanitise_payload(&event_type, payload_json);
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

/// Most recent N events for a runbox.
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

/// Events since a timestamp.
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

/// Events by type.
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

/// BM25 full-text search over payload_json via FTS5.
/// Falls back to events_recent if FTS table doesn't exist yet.
pub fn events_search(
    db:        &Db,
    runbox_id: &str,
    query:     &str,
    limit:     usize,
) -> Result<Vec<WorkspaceEvent>> {
    let conn = db.read();

    let fts_exists: bool = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='workspace_events_fts'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;

    if !fts_exists {
        return events_recent(db, runbox_id, limit);
    }

    let mut stmt = conn.prepare(
        "SELECT e.id, e.runbox_id, e.session_id, e.event_type, e.source, e.payload_json, e.timestamp
         FROM workspace_events e
         JOIN workspace_events_fts fts ON fts.rowid = e.rowid
         WHERE fts.workspace_events_fts MATCH ?1
           AND e.runbox_id = ?2
         ORDER BY rank, e.timestamp DESC
         LIMIT ?3",
    )?;

    let rows    = stmt.query_map(params![query, runbox_id, limit as i64], event_from_row)?;
    let results = rows.collect::<Result<Vec<_>>>()?;

    if results.is_empty() {
        return events_recent(db, runbox_id, limit);
    }
    Ok(results)
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

const MAX_DURATION_MS: i64 = 5 * 60 * 1000;

pub fn sanitise_payload(event_type: &str, payload_json: &str) -> String {
    if event_type != "CommandResult" { return payload_json.to_string(); }
    if !payload_json.contains("duration_ms") { return payload_json.to_string(); }
    if let Ok(mut v) = serde_json::from_str::<serde_json::Value>(payload_json) {
        if let Some(d) = v.get("duration_ms").and_then(|d| d.as_i64()) {
            if d > MAX_DURATION_MS {
                v["duration_ms"] = serde_json::json!(MAX_DURATION_MS);
                v["timed_out"]   = serde_json::json!(true);
                return serde_json::to_string(&v).unwrap_or_else(|_| payload_json.to_string());
            }
        }
    }
    payload_json.to_string()
}

pub fn events_compact(db: &Db, runbox_id: &str, keep_days: u32) {
    let runbox_id  = runbox_id.to_string();
    let cutoff_ms  = super::now_ms() - (keep_days as i64 * 86_400_000);
    db.write_async(move |conn| {
        let keep_threshold: i64 = conn.query_row(
            "SELECT timestamp FROM workspace_events
             WHERE runbox_id=?1
             ORDER BY timestamp DESC
             LIMIT 1 OFFSET 999",
            rusqlite::params![runbox_id],
            |r| r.get(0),
        ).unwrap_or(0);
        let cutoff = cutoff_ms.max(keep_threshold);
        let _ = conn.execute(
            "DELETE FROM workspace_events WHERE runbox_id=?1 AND timestamp < ?2",
            rusqlite::params![runbox_id, cutoff],
        );
    });
}