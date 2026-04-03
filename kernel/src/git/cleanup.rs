// src-tauri/src/git/cleanup.rs
//
// On startup: scan all parent directories of known runbox CWDs for
// stackbox-wt-* folders. Any that don't match a known worktree_path
// or runbox short-ID in SQLite are orphans from a crash — prune them.

use crate::db::Db;
use std::path::Path;

/// Call once on startup after DB is open.
pub fn prune_orphan_worktrees(db: &Db) {
    // Collect all known runbox IDs, CWDs, and persisted worktree paths from DB
    let rows: Vec<(String, String, Option<String>)> = {
        let conn = db.read();
        let mut stmt = match conn.prepare(
            "SELECT id, cwd, worktree_path FROM runboxes"
        ) {
            Ok(s) => s,
            Err(_) => return,
        };
        let collected = match stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        }) {
            Ok(mapped) => mapped.filter_map(|r| r.ok()).collect(),
            Err(_)     => return,
        };
        collected
    };

    // Build two lookup sets:
    //   1. known short IDs (first 8 chars of runbox_id) — for name-pattern matching
    //   2. known worktree absolute paths — for exact-path matching
    let known_short_ids: std::collections::HashSet<String> = rows.iter()
        .map(|(id, _, _)| id[..id.len().min(8)].to_string())
        .collect();

    let known_wt_paths: std::collections::HashSet<String> = rows.iter()
        .filter_map(|(_, _, wt)| wt.clone())
        .collect();

    // Scan parent dirs of every known CWD for stackbox-wt-* folders
    let mut scanned: std::collections::HashSet<String> = std::collections::HashSet::new();

    for (_, cwd, _) in &rows {
        let parent = match Path::new(cwd).parent() {
            Some(p) => p.to_path_buf(),
            None    => continue,
        };
        let parent_str = parent.to_string_lossy().to_string();
        if scanned.contains(&parent_str) { continue; }
        scanned.insert(parent_str.clone());

        let entries = match std::fs::read_dir(&parent) {
            Ok(e)  => e,
            Err(_) => continue,
        };

        for entry in entries.filter_map(|e| e.ok()) {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("stackbox-wt-") { continue; }

            let path     = entry.path();
            let path_str = path.to_string_lossy().to_string();

            // Safe: known by absolute path stored in DB
            if known_wt_paths.contains(&path_str) { continue; }

            // Safe: known by short-ID suffix in folder name
            let suffix = &name["stackbox-wt-".len()..];
            if known_short_ids.contains(suffix) { continue; }

            // Orphan — not referenced by any runbox in DB
            eprintln!("[cleanup] pruning orphan worktree: {path_str}");
            let _ = std::process::Command::new("git")
                .args(["worktree", "remove", "--force", &path_str])
                .output();
            // Fallback: plain remove if git worktree remove fails
            std::fs::remove_dir_all(&path).ok();
        }
    }

    eprintln!("[cleanup] orphan worktree scan complete ({} runboxes checked)", rows.len());
}