// src-tauri/src/git/cleanup.rs
//
// On startup: scan {cwd}/.worktrees/ for stackbox-wt-* folders.
// Any that aren't in agent_branches as an active worktree are orphans
// from a crash — prune them.
//
// FIX vs old code:
//   - Scans {cwd}/.worktrees/ instead of parent dir (worktrees moved inside project)
//   - Reads from agent_branches table instead of agent_worktrees
//   - Also handles legacy sibling-style orphans for one-time cleanup

use crate::db::Db;
use std::path::Path;

/// Call once on startup after DB is open.
pub fn prune_orphan_worktrees(db: &Db) {
    // Collect all known runbox IDs and CWDs
    let runbox_rows: Vec<(String, String)> = {
        let conn = db.read();
        let mut stmt = match conn.prepare("SELECT id, cwd FROM runboxes") {
            Ok(s) => s,
            Err(_) => return,
        };
        match stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
            ))
        }) {
            Ok(mapped) => mapped.filter_map(|r| r.ok()).collect(),
            Err(_)     => return,
        }
    };

    // Collect known active worktree paths from agent_branches
    let known_wt_paths: std::collections::HashSet<String> = {
        let conn = db.read();
        let mut stmt = match conn.prepare(
            "SELECT worktree_path FROM agent_branches WHERE worktree_path IS NOT NULL"
        ) {
            Ok(s) => s,
            Err(_) => {
                // Fall back to legacy table
                let mut stmt2 = match conn.prepare(
                    "SELECT worktree_path FROM agent_worktrees WHERE worktree_path IS NOT NULL"
                ) {
                    Ok(s)  => s,
                    Err(_) => return,
                };
                let paths: std::collections::HashSet<String> =
                    match stmt2.query_map([], |row| row.get::<_, String>(0)) {
                        Ok(mapped) => mapped.filter_map(|r| r.ok()).collect(),
                        Err(_)     => std::collections::HashSet::new(),
                    };
                return prune_with_known_paths(&runbox_rows, paths);
            }
        };
        match stmt.query_map([], |row| row.get::<_, String>(0)) {
            Ok(mapped) => mapped.filter_map(|r| r.ok()).collect(),
            Err(_)     => std::collections::HashSet::new(),
        }
    };

    prune_with_known_paths(&runbox_rows, known_wt_paths);
}

fn prune_with_known_paths(
    runbox_rows:    &[(String, String)],
    known_wt_paths: std::collections::HashSet<String>,
) {
    // Short IDs for name-based matching
    let known_short_ids: std::collections::HashSet<String> = runbox_rows
        .iter()
        .map(|(id, _)| id[..id.len().min(8)].to_string())
        .collect();

    let mut scanned: std::collections::HashSet<String> = std::collections::HashSet::new();

    for (_, cwd) in runbox_rows {
        // ── New layout: scan {cwd}/.worktrees/ ───────────────────────────────
        let wt_dir = Path::new(cwd).join(".worktrees");
        let wt_dir_str = wt_dir.to_string_lossy().to_string();

        if wt_dir.is_dir() && !scanned.contains(&wt_dir_str) {
            scanned.insert(wt_dir_str.clone());

            if let Ok(entries) = std::fs::read_dir(&wt_dir) {
                for entry in entries.filter_map(|e| e.ok()) {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if !name.starts_with("stackbox-wt-") { continue; }

                    let path     = entry.path();
                    let path_str = path.to_string_lossy().to_string();

                    if known_wt_paths.contains(&path_str) { continue; }

                    // suffix = "{runbox_short}-{session_short}-{slug}"
                    let suffix = &name["stackbox-wt-".len()..];
                    if known_short_ids.iter().any(|id| suffix.starts_with(id.as_str())) {
                        continue;
                    }

                    eprintln!("[cleanup] pruning orphan worktree (new layout): {path_str}");
                    let _ = std::process::Command::new("git")
                        .args(["worktree", "remove", "--force", &path_str])
                        .current_dir(cwd)
                        .output();
                    std::fs::remove_dir_all(&path).ok();
                }
            }
        }

        // ── Legacy layout: scan parent dir for sibling stackbox-wt-* ─────────
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

            if known_wt_paths.contains(&path_str) { continue; }

            let suffix = &name["stackbox-wt-".len()..];
            if known_short_ids.iter().any(|id| suffix.starts_with(id.as_str())) {
                continue;
            }

            eprintln!("[cleanup] pruning orphan worktree (legacy sibling): {path_str}");
            let _ = std::process::Command::new("git")
                .args(["worktree", "remove", "--force", &path_str])
                .current_dir(&parent)
                .output();
            std::fs::remove_dir_all(&path).ok();
        }
    }

    eprintln!(
        "[cleanup] orphan worktree scan complete ({} runboxes checked)",
        runbox_rows.len()
    );
}