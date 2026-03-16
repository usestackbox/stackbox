// src-tauri/src/git/diff.rs

use serde::{Deserialize, Serialize};
use super::repo::{git, git_dir_opt};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LiveDiffFile {
    pub path:        String,
    pub change_type: String,
    pub diff:        String,
    pub insertions:  i32,
    pub deletions:   i32,
    pub modified_at: u64,
}

pub fn diff_live(cwd: &str, runbox_id: &str) -> Result<Vec<LiveDiffFile>, String> {
    let gdo_owned = git_dir_opt(cwd, runbox_id);
    let gdo: Option<&str> = gdo_owned.as_deref();

    let mut diff    = git(&["diff", "HEAD"],              cwd, gdo).unwrap_or_default();
    let mut numstat = git(&["diff", "HEAD", "--numstat"], cwd, gdo).unwrap_or_default();

    if diff.trim().is_empty() {
        diff    = git(&["diff", "--cached"],              cwd, gdo).unwrap_or_default();
        numstat = git(&["diff", "--cached", "--numstat"], cwd, gdo).unwrap_or_default();
    }

    if diff.trim().is_empty() {
        let status = git(&["status", "--porcelain"], cwd, gdo).unwrap_or_default();
        return Ok(status.lines()
            .filter(|l| l.trim_start().starts_with("??"))
            .map(|l| {
                let path = l.trim_start_matches("??").trim().to_string();
                LiveDiffFile {
                    diff: format!("diff --git a/{path} b/{path}\nnew file (untracked)"),
                    change_type: "created".to_string(),
                    modified_at: mtime_ms(cwd, &path),
                    insertions: 0, deletions: 0,
                    path,
                }
            })
            .collect());
    }

    Ok(parse_diff(&diff, &numstat, cwd))
}

pub fn diff_for_commit(cwd: &str, runbox_id: &str, hash: &str) -> Result<String, String> {
    let gdo_owned = git_dir_opt(cwd, runbox_id);
    let gdo: Option<&str> = gdo_owned.as_deref();
    git(&["diff", &format!("{hash}~1"), hash], cwd, gdo)
}

fn parse_diff(diff: &str, numstat: &str, cwd: &str) -> Vec<LiveDiffFile> {
    let mut stat_map = std::collections::HashMap::new();
    for line in numstat.lines() {
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        if parts.len() == 3 {
            stat_map.insert(
                parts[2].to_string(),
                (parts[0].parse::<i32>().unwrap_or(0), parts[1].parse::<i32>().unwrap_or(0)),
            );
        }
    }

    let mut files        = Vec::new();
    let mut current_path = String::new();
    let mut current_diff = String::new();
    let mut change_type  = "modified";

    for line in diff.lines() {
        if line.starts_with("diff --git") {
            if !current_path.is_empty() {
                let (ins, del) = stat_map.get(&current_path).copied().unwrap_or((0, 0));
                files.push(LiveDiffFile {
                    path: current_path.clone(), change_type: change_type.to_string(),
                    diff: current_diff.clone(), insertions: ins, deletions: del,
                    modified_at: mtime_ms(cwd, &current_path),
                });
            }
            current_path = line.split(" b/").nth(1).unwrap_or("").to_string();
            current_diff = format!("{line}\n");
            change_type  = "modified";
        } else if line.starts_with("new file mode")     { change_type = "created"; current_diff.push_str(line); current_diff.push('\n'); }
          else if line.starts_with("deleted file mode") { change_type = "deleted"; current_diff.push_str(line); current_diff.push('\n'); }
          else if !current_path.is_empty()              { current_diff.push_str(line); current_diff.push('\n'); }
    }

    if !current_path.is_empty() && !current_diff.trim().is_empty() {
        let (ins, del) = stat_map.get(&current_path).copied().unwrap_or((0, 0));
        files.push(LiveDiffFile {
            path: current_path.clone(), change_type: change_type.to_string(),
            diff: current_diff, insertions: ins, deletions: del,
            modified_at: mtime_ms(cwd, &current_path),
        });
    }
    files
}

fn mtime_ms(cwd: &str, rel_path: &str) -> u64 {
    std::fs::metadata(std::path::Path::new(cwd).join(rel_path))
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
