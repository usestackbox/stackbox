// src-tauri/src/git/repo.rs

use std::path::Path;

pub fn git_dir_for(cwd: &str, runbox_id: &str) -> String {
    let dot_git = Path::new(cwd).join(".git");
    if dot_git.exists() {
        return dot_git.to_string_lossy().to_string();
    }
    dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("stackbox").join("git").join(runbox_id)
        .to_string_lossy()
        .to_string()
}

pub fn has_git(cwd: &str, runbox_id: &str) -> bool {
    Path::new(cwd).join(".git").exists()
        || Path::new(&git_dir_for(cwd, runbox_id)).exists()
}

pub fn git(args: &[&str], cwd: &str, git_dir: Option<&str>) -> Result<String, String> {
    let mut cmd = std::process::Command::new("git");
    if let Some(gd) = git_dir {
        let abs_gd  = std::fs::canonicalize(gd).unwrap_or_else(|_| Path::new(gd).to_path_buf());
        let abs_cwd = std::fs::canonicalize(cwd).unwrap_or_else(|_| Path::new(cwd).to_path_buf());
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

pub fn git_dir_opt(cwd: &str, runbox_id: &str) -> Option<String> {
    let dot_git = Path::new(cwd).join(".git");
    // Real .git directory — no override needed
    if dot_git.is_dir() { return None; }
    // Worktree .git file — points back to main repo, let git resolve it natively
    if dot_git.is_file() { return None; }
    // Shadow repo (no .git at all)
    let shadow = git_dir_for(cwd, runbox_id);
    if Path::new(&shadow).exists() { Some(shadow) } else { None }
}

pub fn ensure_git_repo(cwd: &str, runbox_id: &str) -> Result<String, String> {
    let dot_git = Path::new(cwd).join(".git");
    if dot_git.is_dir() { return Ok(dot_git.to_string_lossy().to_string()); }
    if dot_git.is_file() { let _ = std::fs::remove_file(&dot_git); }

    let shadow      = git_dir_for(cwd, runbox_id);
    let shadow_head = Path::new(&shadow).join("HEAD");
    if shadow_head.exists() { return Ok(shadow); }

    std::fs::create_dir_all(&shadow).map_err(|e| format!("mkdir shadow: {e}"))?;
    std::process::Command::new("git").args(["init", "--bare"]).current_dir(&shadow)
        .output().map_err(|e| format!("git init --bare: {e}"))?;
    std::process::Command::new("git").args(["config", "core.worktree", cwd]).current_dir(&shadow)
        .output().map_err(|e| format!("git config: {e}"))?;
    git(&["add", "-A"], cwd, Some(&shadow)).ok();
    git(&["commit", "--allow-empty", "-m", "stackbox: initial snapshot"], cwd, Some(&shadow)).ok();

    eprintln!("[git] shadow repo created at {shadow}");
    Ok(shadow)
}

/// Auto-create an isolated worktree for a runbox agent session.
/// Returns None if cwd has no real .git (shadow repos don't support worktrees).
pub fn ensure_worktree(cwd: &str, runbox_id: &str) -> Option<String> {
    if !Path::new(cwd).join(".git").exists() { return None; }

    let short   = &runbox_id[..runbox_id.len().min(8)];
    let branch  = format!("stackbox/{short}");
    let parent  = Path::new(cwd).parent()?;
    let wt_path = parent.join(format!("stackbox-wt-{short}"));
    let wt_str  = wt_path.to_str()?.to_string();

    if wt_path.exists() { return Some(wt_str); }

    let out = std::process::Command::new("git")
        .args(["worktree", "add", "-b", &branch, &wt_str, "HEAD"])
        .current_dir(cwd).output().ok()?;

    if out.status.success() {
        eprintln!("[git] worktree created: {wt_str} on branch {branch}");
        return Some(wt_str);
    }

    // Branch may already exist
    let out2 = std::process::Command::new("git")
        .args(["worktree", "add", &wt_str, &branch])
        .current_dir(cwd).output().ok()?;

    if out2.status.success() { Some(wt_str) } else {
        eprintln!("[git] worktree add failed: {}", String::from_utf8_lossy(&out2.stderr).trim());
        None
    }
}

/// Remove a worktree. Safe to call even if already removed.
pub fn remove_worktree(wt_path: &str) {
    if !Path::new(wt_path).exists() { return; }
    let _ = std::process::Command::new("git")
        .args(["worktree", "remove", "--force", wt_path]).output();
    let _ = std::process::Command::new("git").args(["worktree", "prune"]).output();
}