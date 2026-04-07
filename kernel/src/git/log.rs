// src-tauri/src/git/log.rs

use super::repo::{git, git_dir_opt};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitCommit {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub date: String,
    pub author: String,
}

/// Return commits for an arbitrary git range, e.g. "main..stackbox/abc123/claude".
/// Used by git_branch_log to show commits not yet on main.
pub fn log_range(cwd: &str, range: &str) -> Result<Vec<GitCommit>, String> {
    let out = std::process::Command::new("git")
        .args([
            "log",
            "--pretty=format:%H|%h|%s|%ai|%an",
            "--no-merges",
            range,
        ])
        .current_dir(cwd)
        .output()
        .map_err(|e| e.to_string())?;

    let text = String::from_utf8_lossy(&out.stdout);
    Ok(text
        .lines()
        .filter(|l| !l.is_empty())
        .filter_map(|l| {
            let p: Vec<&str> = l.splitn(5, '|').collect();
            if p.len() < 5 {
                return None;
            }
            Some(GitCommit {
                hash: p[0].to_string(),
                short_hash: p[1].to_string(),
                message: p[2].to_string(),
                date: p[3].to_string(),
                author: p[4].to_string(),
            })
        })
        .collect())
}

pub fn log_for_runbox(cwd: &str, runbox_id: &str) -> Result<Vec<GitCommit>, String> {
    let gdo_owned = git_dir_opt(cwd, runbox_id);
    let gdo: Option<&str> = gdo_owned.as_deref();

    let log = git(
        &[
            "log",
            "--pretty=format:%H|%h|%s|%ai|%an",
            "--no-merges",
            "-50",
        ],
        cwd,
        gdo,
    )
    .unwrap_or_default();

    Ok(log
        .lines()
        .filter(|l| !l.is_empty())
        .filter_map(|l| {
            let p: Vec<&str> = l.splitn(5, '|').collect();
            if p.len() < 5 {
                return None;
            }
            Some(GitCommit {
                hash: p[0].to_string(),
                short_hash: p[1].to_string(),
                message: p[2].to_string(),
                date: p[3].to_string(),
                author: p[4].to_string(),
            })
        })
        .collect())
}
