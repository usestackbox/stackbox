// src-tauri/src/git/commands.rs

use super::{
    diff::{diff_for_commit, diff_live, LiveDiffFile},
    log::{log_for_runbox, GitCommit},
    repo::{ensure_git_repo, ensure_worktree, git, git_dir_opt, has_git, remove_worktree},
};

#[tauri::command]
pub async fn git_ensure(cwd: String, runbox_id: String) -> Result<bool, String> {
    let had = has_git(&cwd, &runbox_id);
    ensure_git_repo(&cwd, &runbox_id)?;
    Ok(!had)
}

#[tauri::command]
pub async fn git_log_for_runbox(cwd: String, runbox_id: String) -> Result<Vec<GitCommit>, String> {
    log_for_runbox(&cwd, &runbox_id)
}

#[tauri::command]
pub async fn git_diff_for_commit(
    cwd: String, runbox_id: String, hash: String,
) -> Result<String, String> {
    diff_for_commit(&cwd, &runbox_id, &hash)
}

#[tauri::command]
pub async fn git_diff_live(cwd: String, runbox_id: String) -> Result<Vec<LiveDiffFile>, String> {
    diff_live(&cwd, &runbox_id)
}

#[tauri::command]
pub async fn git_worktree_create(
    cwd: String, branch: String, wt_name: String,
) -> Result<String, String> {
    let cwd_path = std::path::Path::new(&cwd);
    if !cwd_path.join(".git").exists() {
        return Err("No .git found — init a repo first.".to_string());
    }
    let parent  = cwd_path.parent().ok_or("cwd has no parent")?;
    let wt_path = parent.join(format!("stackbox-wt-{wt_name}"));
    let wt_str  = wt_path.to_str().ok_or("non-UTF8 path")?;

    if wt_path.exists() { return Ok(wt_str.to_string()); }

    let out = std::process::Command::new("git")
        .args(["worktree", "add", "-b", &branch, wt_str, "HEAD"])
        .current_dir(&cwd).output().map_err(|e| e.to_string())?;

    if out.status.success() { Ok(wt_str.to_string()) }
    else { Err(String::from_utf8_lossy(&out.stderr).trim().to_string()) }
}

#[tauri::command]
pub async fn git_worktree_remove(wt_path: String) -> Result<(), String> {
    remove_worktree(&wt_path);
    Ok(())
}

#[tauri::command]
pub async fn git_current_branch(cwd: String) -> Result<String, String> {
    let out = std::process::Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(&cwd).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Ok(String::new())
    }
}

#[tauri::command]
pub async fn git_stage_and_commit(
    cwd: String, runbox_id: String, message: String,
) -> Result<String, String> {
    if message.trim().is_empty() { return Err("commit message cannot be empty".to_string()); }
    let gdo_owned = git_dir_opt(&cwd, &runbox_id);
    let gdo: Option<&str> = gdo_owned.as_deref();
    git(&["add", "-A"], &cwd, gdo)?;
    let out   = git(&["commit", "-m", message.trim()], &cwd, gdo)?;
    let hash  = git(&["rev-parse", "--short", "HEAD"], &cwd, gdo).unwrap_or_default();
    let short = hash.trim();
    let summary = out.lines().next().unwrap_or("").trim().to_string();
    Ok(format!("[{short}] {summary}"))
}
