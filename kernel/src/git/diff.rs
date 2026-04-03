// src-tauri/src/git/diff.rs
//
// All read-only git commands use --no-optional-locks so the watcher
// never holds index.lock while an agent is trying to git add -A.

use serde::{Deserialize, Serialize};
use super::repo::git_dir_opt;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LiveDiffFile {
    pub path:        String,
    pub change_type: String,
    pub diff:        String,
    pub insertions:  i32,
    pub deletions:   i32,
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
        let abs_gd  = std::fs::canonicalize(gd).unwrap_or_else(|_| std::path::Path::new(gd).to_path_buf());
        let abs_cwd = std::fs::canonicalize(cwd).unwrap_or_else(|_| std::path::Path::new(cwd).to_path_buf());
        cmd.arg("--git-dir").arg(&abs_gd)
           .arg("--work-tree").arg(&abs_cwd)
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

pub fn diff_live(cwd: &str, runbox_id: &str) -> Result<Vec<LiveDiffFile>, String> {
    let gdo_owned = git_dir_opt(cwd, runbox_id);
    let gdo: Option<&str> = gdo_owned.as_deref();

    // --no-optional-locks: don't create index.lock for this read-only status check
    let status_out = git_readonly(&["status", "--porcelain", "-uall"], cwd, gdo)
        .unwrap_or_default();

    let mut files: Vec<LiveDiffFile> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for raw in status_out.lines() {
        if raw.len() < 4 { continue; }

        let x = raw.chars().nth(0).unwrap_or(' ');
        let y = raw.chars().nth(1).unwrap_or(' ');
        let path = raw[3..].trim().to_string();

        let path = if path.contains(" -> ") {
            path.split(" -> ").last().unwrap_or(&path).to_string()
        } else {
            path
        };

        if path.is_empty() || seen.contains(&path) { continue; }
        seen.insert(path.clone());

        let mt = mtime_ms(cwd, &path);

        let entry = match (x, y) {
            ('?', '?') => {
                let full = std::path::Path::new(cwd).join(&path);
                if !full.is_file() { continue; }
                let content = std::fs::read_to_string(&full).unwrap_or_default();
                if content.is_empty() { continue; }
                let lines: Vec<&str> = content.lines().collect();
                let count = lines.len();
                let mut diff = format!(
                    "diff --git a/{path} b/{path}\nnew file mode 100644\n\
                     index 0000000..0000000\n--- /dev/null\n+++ b/{path}\n\
                     @@ -0,0 +1,{count} @@\n"
                );
                for l in &lines { diff.push('+'); diff.push_str(l); diff.push('\n'); }
                LiveDiffFile {
                    path, change_type: "created".into(),
                    diff, insertions: count as i32, deletions: 0, modified_at: mt,
                }
            }

            ('A', _) => {
                let diff = best_diff_readonly(cwd, gdo, &path, x, y)
                    .unwrap_or_else(|| synthetic_new(cwd, &path));
                let (ins, del) = stat(&diff);
                LiveDiffFile { path, change_type: "created".into(), diff, insertions: ins, deletions: del, modified_at: mt }
            }

            ('D', _) | (_, 'D') => {
                let diff = best_diff_readonly(cwd, gdo, &path, x, y).unwrap_or_default();
                let (ins, del) = stat(&diff);
                LiveDiffFile { path, change_type: "deleted".into(), diff, insertions: ins, deletions: del, modified_at: mt }
            }

            _ if x == 'M' || y == 'M' || x == 'R' || x == 'C' => {
                let diff = best_diff_readonly(cwd, gdo, &path, x, y).unwrap_or_default();
                if diff.trim().is_empty() { continue; }
                let (ins, del) = stat(&diff);
                LiveDiffFile { path, change_type: "modified".into(), diff, insertions: ins, deletions: del, modified_at: mt }
            }

            _ => continue,
        };

        files.push(entry);
    }

    files.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(files)
}

/// All diff operations use --no-optional-locks to avoid holding index.lock.
fn best_diff_readonly(cwd: &str, gdo: Option<&str>, path: &str, x: char, y: char) -> Option<String> {
    if y == 'M' || y == 'D' {
        if let Ok(d) = git_readonly(&["diff", "--", path], cwd, gdo) {
            if !d.trim().is_empty() { return Some(d); }
        }
    }
    if matches!(x, 'M' | 'A' | 'D' | 'R' | 'C') {
        if let Ok(d) = git_readonly(&["diff", "--cached", "--", path], cwd, gdo) {
            if !d.trim().is_empty() { return Some(d); }
        }
    }
    if let Ok(d) = git_readonly(&["diff", "HEAD", "--", path], cwd, gdo) {
        if !d.trim().is_empty() { return Some(d); }
    }
    None
}

fn synthetic_new(cwd: &str, path: &str) -> String {
    let full = std::path::Path::new(cwd).join(path);
    if !full.is_file() { return String::new(); }
    let content = std::fs::read_to_string(&full).unwrap_or_default();
    let lines: Vec<&str> = content.lines().collect();
    let count = lines.len();
    let mut d = format!(
        "diff --git a/{path} b/{path}\nnew file mode 100644\n\
         --- /dev/null\n+++ b/{path}\n@@ -0,0 +1,{count} @@\n"
    );
    for l in &lines { d.push('+'); d.push_str(l); d.push('\n'); }
    d
}

fn stat(diff: &str) -> (i32, i32) {
    let (mut ins, mut del) = (0i32, 0i32);
    for l in diff.lines() {
        if      l.starts_with('+') && !l.starts_with("+++") { ins += 1; }
        else if l.starts_with('-') && !l.starts_with("---") { del += 1; }
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