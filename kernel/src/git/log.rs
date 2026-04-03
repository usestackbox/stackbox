// src-tauri/src/git/log.rs

use serde::{Deserialize, Serialize};
use super::repo::{git, git_dir_opt};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitCommit {
    pub hash:       String,
    pub short_hash: String,
    pub message:    String,
    pub date:       String,
    pub author:     String,
}

pub fn log_for_runbox(cwd: &str, runbox_id: &str) -> Result<Vec<GitCommit>, String> {
    let gdo_owned = git_dir_opt(cwd, runbox_id);
    let gdo: Option<&str> = gdo_owned.as_deref();

    let log = git(
        &["log", "--pretty=format:%H|%h|%s|%ai|%an", "--no-merges", "-50"],
        cwd, gdo,
    ).unwrap_or_default();

    Ok(log.lines()
        .filter(|l| !l.is_empty())
        .filter_map(|l| {
            let p: Vec<&str> = l.splitn(5, '|').collect();
            if p.len() < 5 { return None; }
            Some(GitCommit {
                hash:       p[0].to_string(),
                short_hash: p[1].to_string(),
                message:    p[2].to_string(),
                date:       p[3].to_string(),
                author:     p[4].to_string(),
            })
        })
        .collect())
}
