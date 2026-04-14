// src-tauri/src/git/diff.rs
//
// All read-only git commands use --no-optional-locks so the watcher
// never holds index.lock while an agent is trying to git add -A.

use super::repo::git_dir_opt;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LiveDiffFile {
    pub path: String,
    pub change_type: String,
    pub diff: String,
    pub insertions: i32,
    pub deletions: i32,
    pub modified_at: u64,
}

pub fn clear_cache_for(_cwd: &str) {}

/// Run a read-only git command with --no-optional-locks.
/// This prevents git from acquiring index.lock for status/diff operations,
/// so the watcher never blocks agents from running git add -A.
fn git_readonly(args: &[&str], cwd: &str, git_dir: Option<&str>) -> Result<String, String> {
    let mut full_args = vec!["--no-optional-locks"];
    full_args.extend_from_slice(args);
    git_with_args(&full_args, cwd, git_dir)
}

fn git_with_args(args: &[&str], cwd: &str, git_dir: Option<&str>) -> Result<String, String> {
    let mut cmd = std::process::Command::new("git");
    if let Some(gd) = git_dir {
        let abs_gd =
            std::fs::canonicalize(gd).unwrap_or_else(|_| std::path::Path::new(gd).to_path_buf());
        let abs_cwd =
            std::fs::canonicalize(cwd).unwrap_or_else(|_| std::path::Path::new(cwd).to_path_buf());
        cmd.arg("--git-dir")
            .arg(&abs_gd)
            .arg("--work-tree")
            .arg(&abs_cwd)
            .current_dir(&abs_cwd);
    } else {
        cmd.current_dir(cwd);
    }
    cmd.args(args);
    let out = cmd.output().map_err(|e| format!("git exec: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// Ensure the directory is a git repo.
/// Called at the top of diff_live so diffs always work even if the repo was
/// created before fs_create_dir started auto-initing git.
fn ensure_git_repo(cwd: &str, gdo: Option<&str>) {
    if gdo.is_some() {
        return; // already a worktree — git_dir_opt resolved a real .git
    }
    let p = std::path::Path::new(cwd);
    if !p.join(".git").exists() {
        let _ = std::process::Command::new("git")
            .arg("init")
            .current_dir(p)
            .output();
    }
}

/// Stage all working-tree changes so the diff panel always shows
/// the complete current state, including files an agent just wrote.
///
/// Retries up to 4 times with exponential backoff when git reports
/// index.lock contention (an agent or another git process holds the lock).
/// Failures for other reasons are swallowed — a stale diff is better than
/// an error.
fn stage_all(cwd: &str, gdo: Option<&str>) {
    let mut delay_ms = 50u64;
    for attempt in 0..4 {
        match git_with_args(&["add", "-A"], cwd, gdo) {
            Ok(_) => return,
            Err(e) if e.contains("index.lock") => {
                if attempt < 3 {
                    std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                    delay_ms *= 2; // 50 → 100 → 200 ms
                }
            }
            Err(_) => return, // non-lock error — give up immediately
        }
    }
}

pub fn diff_live(cwd: &str, runbox_id: &str) -> Result<Vec<LiveDiffFile>, String> {
    let gdo_owned = git_dir_opt(cwd, runbox_id);
    let gdo: Option<&str> = gdo_owned.as_deref();

    // Guard: make sure the directory is a git repo before doing anything.
    // This handles repos opened before the auto-init logic was added to
    // fs_create_dir, and any directory the user opens from outside Calus.
    ensure_git_repo(cwd, gdo);

    // Always stage everything before diffing — ensures newly written files and
    // unstaged changes are always visible in the diff panel.
    stage_all(cwd, gdo);

    // --no-optional-locks: don't create index.lock for this read-only status check
    let status_out =
        git_readonly(&["status", "--porcelain", "-uall"], cwd, gdo).unwrap_or_default();

    let mut files: Vec<LiveDiffFile> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for raw in status_out.lines() {
        if raw.len() < 4 {
            continue;
        }

        let x = raw.chars().nth(0).unwrap_or(' ');
        let y = raw.chars().nth(1).unwrap_or(' ');
        let path = raw[3..].trim().to_string();

        let path = if path.contains(" -> ") {
            path.split(" -> ").last().unwrap_or(&path).to_string()
        } else {
            path
        };

        if path.is_empty() || seen.contains(&path) {
            continue;
        }
        seen.insert(path.clone());

        let mt = mtime_ms(cwd, &path);

        let entry = match (x, y) {
            ('?', '?') => {
                // Untracked file — stage_all should have converted these to 'A'
                // but if it failed (e.g. index.lock timeout) we render them
                // directly so the panel never goes blank.
                let full = std::path::Path::new(cwd).join(&path);
                if !full.is_file() {
                    continue;
                }
                let content = std::fs::read_to_string(&full).unwrap_or_default();
                if content.is_empty() {
                    continue;
                }
                let lines: Vec<&str> = content.lines().collect();
                let count = lines.len();
                let mut diff = format!(
                    "diff --git a/{path} b/{path}\nnew file mode 100644\n\
                     index 0000000..0000000\n--- /dev/null\n+++ b/{path}\n\
                     @@ -0,0 +1,{count} @@\n"
                );
                for l in &lines {
                    diff.push('+');
                    diff.push_str(l);
                    diff.push('\n');
                }
                LiveDiffFile {
                    path,
                    change_type: "created".into(),
                    diff,
                    insertions: count as i32,
                    deletions: 0,
                    modified_at: mt,
                }
            }

            ('A', _) => {
                let diff = best_diff_readonly(cwd, gdo, &path, x, y)
                    .unwrap_or_else(|| synthetic_new(cwd, &path));
                let (ins, del) = stat(&diff);
                LiveDiffFile {
                    path,
                    change_type: "created".into(),
                    diff,
                    insertions: ins,
                    deletions: del,
                    modified_at: mt,
                }
            }

            ('D', _) | (_, 'D') => {
                let diff = best_diff_readonly(cwd, gdo, &path, x, y).unwrap_or_default();
                let (ins, del) = stat(&diff);
                LiveDiffFile {
                    path,
                    change_type: "deleted".into(),
                    diff,
                    insertions: ins,
                    deletions: del,
                    modified_at: mt,
                }
            }

            _ if x == 'M' || y == 'M' || x == 'R' || x == 'C' => {
                // Fall back to synthetic_new when all git diff strategies fail.
                // Covers: fresh repo with no HEAD, mid-write transient empty diff,
                // or any other state where git can't produce a useful diff.
                let diff = best_diff_readonly(cwd, gdo, &path, x, y)
                    .unwrap_or_else(|| synthetic_new(cwd, &path));
                let (ins, del) = stat(&diff);
                LiveDiffFile {
                    path,
                    change_type: "modified".into(),
                    diff,
                    insertions: ins,
                    deletions: del,
                    modified_at: mt,
                }
            }

            _ => continue,
        };

        files.push(entry);
    }

    files.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(files)
}

/// Try multiple diff strategies, in priority order, until one produces output.
///
/// Strategy order:
///   1. `git diff -- path`          — unstaged working-tree changes (y == M/D)
///   2. `git diff --cached -- path` — staged changes vs HEAD (or empty tree on
///                                    fresh repos — always works, even no HEAD)
///   3. `git diff HEAD -- path`     — staged+unstaged vs last commit
///
/// All calls use --no-optional-locks to avoid holding index.lock.
/// Returns None only when every strategy produces empty output, which triggers
/// the synthetic_new fallback in the caller.
fn best_diff_readonly(
    cwd: &str,
    gdo: Option<&str>,
    path: &str,
    x: char,
    y: char,
) -> Option<String> {
    // Strategy 1 — unstaged working-tree diff (only when there are unstaged changes)
    if y == 'M' || y == 'D' {
        if let Ok(d) = git_readonly(&["diff", "--", path], cwd, gdo) {
            if !d.trim().is_empty() {
                return Some(d);
            }
        }
    }

    // Strategy 2 — staged diff vs HEAD (or empty-tree on fresh repos).
    // `git diff --cached` works even when there is no HEAD commit: it compares
    // the index against the empty tree and shows all staged lines as additions.
    // This is the primary strategy for newly staged files (x == 'A').
    if matches!(x, 'M' | 'A' | 'D' | 'R' | 'C') {
        if let Ok(d) = git_readonly(&["diff", "--cached", "--", path], cwd, gdo) {
            if !d.trim().is_empty() {
                return Some(d);
            }
        }
    }

    // Strategy 3 — combined staged+unstaged vs last commit.
    // Fails on fresh repos (no HEAD) — caller falls back to synthetic_new.
    if let Ok(d) = git_readonly(&["diff", "HEAD", "--", path], cwd, gdo) {
        if !d.trim().is_empty() {
            return Some(d);
        }
    }

    None
}

fn synthetic_new(cwd: &str, path: &str) -> String {
    let full = std::path::Path::new(cwd).join(path);
    if !full.is_file() {
        return String::new();
    }
    let content = std::fs::read_to_string(&full).unwrap_or_default();
    let lines: Vec<&str> = content.lines().collect();
    let count = lines.len();
    let mut d = format!(
        "diff --git a/{path} b/{path}\nnew file mode 100644\n\
         --- /dev/null\n+++ b/{path}\n@@ -0,0 +1,{count} @@\n"
    );
    for l in &lines {
        d.push('+');
        d.push_str(l);
        d.push('\n');
    }
    d
}

fn stat(diff: &str) -> (i32, i32) {
    let (mut ins, mut del) = (0i32, 0i32);
    for l in diff.lines() {
        if l.starts_with('+') && !l.starts_with("+++") {
            ins += 1;
        } else if l.starts_with('-') && !l.starts_with("---") {
            del += 1;
        }
    }
    (ins, del)
}

pub fn diff_for_commit(cwd: &str, runbox_id: &str, hash: &str) -> Result<String, String> {
    let gdo_owned = git_dir_opt(cwd, runbox_id);
    let gdo: Option<&str> = gdo_owned.as_deref();
    // diff between commits is always read-only
    git_readonly(&["diff", &format!("{hash}~1"), hash], cwd, gdo)
}

fn mtime_ms(cwd: &str, rel_path: &str) -> u64 {
    std::fs::metadata(std::path::Path::new(cwd).join(rel_path))
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}