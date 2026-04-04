// src-tauri/src/git/cleanup.rs
//
// On startup: scan all parent directories of known runbox CWDs for
// stackbox-wt-* folders. Any that don't match a known worktree_path
// or runbox short-ID in SQLite are orphans from a crash — prune them.
//
// FIX (Bug #cleanup-A): Query was reading `runboxes.worktree_path` which is
//   always NULL. Actual worktree paths are stored in `agent_worktrees`. Fixed
//   to query `agent_worktrees` instead.
//
// FIX (Bug #cleanup-B): Suffix check used `known_short_ids.contains(suffix)`
//   where suffix = "a1b2c3d4-claude-code" but known_short_ids held "a1b2c3d4".
//   Never matched → every worktree pruned as orphan on every startup.
//   Fixed to `suffix.starts_with(short_id)`.

use crate::db::Db;
use std::path::Path;

/// Call once on startup after DB is open.
pub fn prune_orphan_worktrees(db: &Db) {
    // Collect all known runbox IDs and CWDs from the runboxes table
    let runbox_rows: Vec<(String, String)> = {
        let conn = db.read();
        let mut stmt = match conn.prepare("SELECT id, cwd FROM runboxes") {
            Ok(s) => s,
            Err(_) => return,
        };
        let collected = match stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
            ))
        }) {
            Ok(mapped) => mapped.filter_map(|r| r.ok()).collect(),
            Err(_)     => return,
        };
        collected
    };

    // FIX (Bug #cleanup-A): Read worktree paths from agent_worktrees, not runboxes.
    //
    // Borrow-checker note: `MappedRows<'_>` borrows `stmt`; `stmt` borrows `conn`.
    // If `stmt.query_map(...)` is the *last* expression in the block its
    // intermediate `Result<MappedRows<'_,…>>` temporary is kept alive until after
    // `stmt` and `conn` are dropped, causing "does not live long enough".
    // Binding to a named `let` forces the iterator to be fully consumed and the
    // temporary dropped *before* the block closes, so `stmt`/`conn` can then
    // drop cleanly.
    let known_wt_paths: std::collections::HashSet<String> = {
        let conn = db.read();
        let mut stmt = match conn.prepare(
            "SELECT worktree_path FROM agent_worktrees WHERE worktree_path IS NOT NULL"
        ) {
            Ok(s) => s,
            Err(_) => return,
        };
        let paths: std::collections::HashSet<String> =
            match stmt.query_map([], |row| row.get::<_, String>(0)) {
                Ok(mapped) => mapped.filter_map(|r| r.ok()).collect(),
                Err(_)     => std::collections::HashSet::new(),
            };
        // `stmt` and `conn` drop here; `paths` owns its data — no borrow survives.
        paths
    };

    // Build short-ID lookup set (first 8 chars of runbox_id)
    let known_short_ids: std::collections::HashSet<String> = runbox_rows
        .iter()
        .map(|(id, _)| id[..id.len().min(8)].to_string())
        .collect();

    // Scan parent dirs of every known CWD for stackbox-wt-* folders
    let mut scanned: std::collections::HashSet<String> = std::collections::HashSet::new();

    for (_, cwd) in &runbox_rows {
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

            // Safe: known by exact absolute path stored in agent_worktrees
            if known_wt_paths.contains(&path_str) { continue; }

            // FIX (Bug #cleanup-B): suffix includes the agent slug, e.g.
            // "a1b2c3d4-claude-code". Check with starts_with, not contains.
            let suffix = &name["stackbox-wt-".len()..];
            if known_short_ids.iter().any(|id| suffix.starts_with(id.as_str())) {
                continue;
            }

            // Orphan — not referenced by any runbox in DB
            eprintln!("[cleanup] pruning orphan worktree: {path_str}");
            let _ = std::process::Command::new("git")
                .args(["worktree", "remove", "--force", &path_str])
                .current_dir(&parent)
                .output();
            // Fallback: plain remove if git worktree remove fails
            std::fs::remove_dir_all(&path).ok();
        }
    }

    eprintln!(
        "[cleanup] orphan worktree scan complete ({} runboxes checked)",
        runbox_rows.len()
    );
}