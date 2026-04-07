// src-tauri/src/db/layout.rs

use super::{now_ms, Db, PaneLayout};
use rusqlite::{params, Result};

pub fn layout_save(db: &Db, runbox_id: &str, layout_json: &str, active_pane: &str) -> Result<()> {
    let runbox_id = runbox_id.to_string();
    let layout_json = layout_json.to_string();
    let active_pane = active_pane.to_string();
    let ts = now_ms();
    db.write_async(move |conn| {
        let _ = conn.execute(
            "INSERT INTO pane_layouts (runbox_id, layout_json, active_pane, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(runbox_id) DO UPDATE SET
               layout_json=excluded.layout_json,
               active_pane=excluded.active_pane,
               updated_at=excluded.updated_at",
            params![runbox_id, layout_json, active_pane, ts],
        );
    });
    Ok(())
}

pub fn layout_get(db: &Db, runbox_id: &str) -> Result<Option<PaneLayout>> {
    let conn = db.read();
    let mut stmt = conn.prepare(
        "SELECT runbox_id, layout_json, active_pane, updated_at
         FROM pane_layouts WHERE runbox_id=?1",
    )?;
    let mut rows = stmt.query_map(params![runbox_id], |r| {
        Ok(PaneLayout {
            runbox_id: r.get(0)?,
            layout_json: r.get(1)?,
            active_pane: r.get(2)?,
            updated_at: r.get(3)?,
        })
    })?;
    Ok(rows.next().transpose()?)
}
