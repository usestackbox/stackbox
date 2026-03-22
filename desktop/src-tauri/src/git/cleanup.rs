// src-tauri/src/git/cleanup.rs
//
// On startup: scan all parent directories of known runbox CWDs for
// stackbox-wt-* folders. Any that don't match a runbox ID in SQLite
// are orphans from a crash — prune them.

use crate::db::Db;
use std::path::Path;

/// Call once on startup after DB is open.
pub fn prune_orphan_worktrees(db: &Db) {
    // Collect all known runbox IDs and their CWDs from DB
    let rows: Vec<(String, String)> = {
        let conn = db.read();
        let mut stmt = match conn.prepare("SELECT id, cwd FROM runboxes") {
            Ok(s) => s,
            Err(_) => return,
        };
        // Collect immediately so MappedRows (borrows stmt+conn) is dropped before block ends
        let collected: Vec<(String, String)> = match stmt.query_map(
            [],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        ) {
            Ok(mapped) => mapped.filter_map(|r| r.ok()).collect(),
            Err(_)     => return,
        };
        collected
    };

    let known_ids: std::collections::HashSet<String> = rows.iter()
        .map(|(id, _)| id[..id.len().min(8)].to_string())
        .collect();

    // Scan parent dirs of every known CWD for stackbox-wt-* folders
    let mut scanned: std::collections::HashSet<String> = std::collections::HashSet::new();

    for (_, cwd) in &rows {
        let parent = match Path::new(cwd).parent() {
            Some(p) => p.to_path_buf(),
            None    => continue,
        };
        let parent_str = parent.to_string_lossy().to_string();
        if scanned.contains(&parent_str) { continue; }
        scanned.insert(parent_str);

        let entries = match std::fs::read_dir(&parent) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for entry in entries.filter_map(|e| e.ok()) {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("stackbox-wt-") { continue; }

            // Extract the short ID suffix — "stackbox-wt-{8 chars}"
            let suffix = &name["stackbox-wt-".len()..];
            if known_ids.contains(suffix) { continue; }

            // Not in DB — orphan. Remove it.
            let path = entry.path();
            eprintln!("[cleanup] pruning orphan worktree: {}", path.display());
            let _ = std::process::Command::new("git")
                .args(["worktree", "remove", "--force", &path.to_string_lossy()])
                .output();
            // Also try plain rmdir if git worktree remove fails
            std::fs::remove_dir_all(&path).ok();
        }
    }

    eprintln!("[cleanup] orphan worktree scan complete");
}