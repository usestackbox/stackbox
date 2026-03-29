// src-tauri/src/git/commands.rs

use tauri::Emitter;
use super::{
    diff::{diff_for_commit, diff_live, clear_cache_for, LiveDiffFile},
    log::{log_for_runbox, GitCommit},
    repo::{ensure_git_repo, git, git_dir_opt, has_git, init_real_repo, remove_worktree},
};

#[tauri::command]
pub async fn git_ensure(cwd: String, runbox_id: String) -> Result<bool, String> {
    let had = has_git(&cwd, &runbox_id);
    ensure_git_repo(&cwd, &runbox_id)?;
    Ok(!had)
}

#[tauri::command]
pub async fn git_init(cwd: String) -> Result<(), String> {
    init_real_repo(&cwd)
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

    // Derive prefix from the actual workspace/folder name
    // e.g. cwd = /projects/my-app  →  folder_name = "my-app"
    // Final worktree folder = /projects/my-app-feature
    let folder_name = cwd_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("worktree");

    // Auto-init if no .git exists — no manual git init needed
    if !cwd_path.join(".git").exists() {
        init_real_repo(&cwd).map_err(|e| format!("auto git init failed: {e}"))?;
    }

    let parent  = cwd_path.parent().ok_or("cwd has no parent")?;

    // {workspace-name}-{user-supplied-name}
    // e.g. my-app-feature, my-app-hotfix, my-app-bugfix
    let wt_path = parent.join(format!("{folder_name}-{wt_name}"));
    let wt_str  = wt_path.to_str().ok_or("non-UTF8 path")?;

    // Already exists — idempotent
    if wt_path.exists() { return Ok(wt_str.to_string()); }

    // Try creating with a new branch
    let out = std::process::Command::new("git")
        .args(["worktree", "add", "-b", &branch, wt_str, "HEAD"])
        .current_dir(&cwd)
        .output()
        .map_err(|e| e.to_string())?;

    if out.status.success() {
        eprintln!("[git] worktree created: {wt_str} on branch {branch}");
        return Ok(wt_str.to_string());
    }

    // Branch already exists — try without -b
    let out2 = std::process::Command::new("git")
        .args(["worktree", "add", wt_str, &branch])
        .current_dir(&cwd)
        .output()
        .map_err(|e| e.to_string())?;

    if out2.status.success() {
        eprintln!("[git] worktree attached: {wt_str} on existing branch {branch}");
        return Ok(wt_str.to_string());
    }

    Err(String::from_utf8_lossy(&out2.stderr).trim().to_string())
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
        .current_dir(&cwd)
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Ok(String::new())
    }
}

#[tauri::command]
pub async fn git_stage_and_commit(
    app:       tauri::AppHandle,
    cwd:       String,
    runbox_id: String,
    message:   String,
) -> Result<String, String> {
    if message.trim().is_empty() { return Err("commit message cannot be empty".to_string()); }

    let gdo_owned = git_dir_opt(&cwd, &runbox_id);
    let gdo: Option<&str> = gdo_owned.as_deref();

    git(&["add", "-A"], &cwd, gdo)?;

    let status = git(&["status", "--porcelain"], &cwd, gdo).unwrap_or_default();
    if status.trim().is_empty() {
        return Err("nothing to commit — working tree clean".to_string());
    }

    let out     = git(&["commit", "-m", message.trim()], &cwd, gdo)?;
    let hash    = git(&["rev-parse", "--short", "HEAD"], &cwd, gdo).unwrap_or_default();
    let short   = hash.trim();
    let summary = out.lines().next().unwrap_or("").trim().to_string();

    eprintln!("[git] committed in {cwd}: [{short}] {summary}");

    clear_cache_for(&cwd);
    let fresh = diff_live(&cwd, &runbox_id).unwrap_or_default();
    let _ = app.emit("git:live-diff", &fresh);

    Ok(format!("[{short}] {summary}"))
}

#[tauri::command]
pub async fn git_push(cwd: String, runbox_id: String) -> Result<String, String> {
    let gdo_owned = git_dir_opt(&cwd, &runbox_id);
    let gdo: Option<&str> = gdo_owned.as_deref();

    let branch = git(&["rev-parse", "--abbrev-ref", "HEAD"], &cwd, gdo).unwrap_or_default();
    let branch = branch.trim();
    if branch.is_empty() || branch == "HEAD" {
        return Err("Not on a named branch — cannot push.".to_string());
    }

    let remotes = git(&["remote"], &cwd, gdo).unwrap_or_default();
    if !remotes.lines().any(|l| l.trim() == "origin") {
        return Err("No remote 'origin' configured.".to_string());
    }

    match git(&["push", "origin", branch], &cwd, gdo) {
        Ok(out) => {
            eprintln!("[git] pushed {branch} to origin");
            Ok(out.trim().lines().last().unwrap_or("Pushed.").to_string())
        }
        Err(e) => {
            if e.contains("no upstream") || e.contains("--set-upstream") {
                git(&["push", "--set-upstream", "origin", branch], &cwd, gdo)?;
                Ok(format!("Branch '{branch}' pushed and upstream set."))
            } else {
                Err(e)
            }
        }
    }
}

#[tauri::command]
pub async fn git_stage_file(
    cwd: String, runbox_id: String, path: String,
) -> Result<(), String> {
    let gdo_owned = git_dir_opt(&cwd, &runbox_id);
    let gdo: Option<&str> = gdo_owned.as_deref();
    git(&["add", &path], &cwd, gdo)?;
    Ok(())
}

#[tauri::command]
pub async fn git_unstage_file(
    cwd: String, runbox_id: String, path: String,
) -> Result<(), String> {
    let gdo_owned = git_dir_opt(&cwd, &runbox_id);
    let gdo: Option<&str> = gdo_owned.as_deref();
    let r = git(&["restore", "--staged", &path], &cwd, gdo);
    if r.is_err() {
        git(&["rm", "--cached", &path], &cwd, gdo)?;
    }
    Ok(())
}

#[derive(serde::Serialize)]
pub struct WorktreeEntry {
    pub path:      String,
    pub branch:    String,
    pub head:      String,
    pub is_main:   bool,
    pub is_bare:   bool,
    pub is_locked: bool,
}

#[tauri::command]
pub async fn git_worktree_list(cwd: String) -> Result<Vec<WorktreeEntry>, String> {
    let out = std::process::Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .current_dir(&cwd)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut entries: Vec<WorktreeEntry> = Vec::new();
    let mut path      = String::new();
    let mut branch    = String::new();
    let mut head      = String::new();
    let mut is_bare   = false;
    let mut is_locked = false;
    let mut first     = true;
    for line in text.lines() {
        if line.is_empty() {
            if !path.is_empty() {
                entries.push(WorktreeEntry {
                    path: path.clone(), branch: branch.clone(),
                    head: head.clone(), is_main: first, is_bare, is_locked,
                });
                path.clear(); branch.clear(); head.clear();
                is_bare = false; is_locked = false; first = false;
            }
        } else if let Some(v) = line.strip_prefix("worktree ")          { path   = v.to_string(); }
          else if let Some(v) = line.strip_prefix("HEAD ")              { head   = v.to_string(); }
          else if let Some(v) = line.strip_prefix("branch refs/heads/") { branch = v.to_string(); }
          else if line == "bare"   { is_bare   = true; }
          else if line == "locked" { is_locked = true; }
    }
    if !path.is_empty() {
        entries.push(WorktreeEntry { path, branch, head, is_main: first, is_bare, is_locked });
    }
    Ok(entries)
}

#[tauri::command]
pub async fn git_watch_start(
    app: tauri::AppHandle, cwd: String, runbox_id: String,
) -> Result<(), String> {
    crate::git::watcher::start_watch(app, cwd, runbox_id);
    Ok(())
}

#[tauri::command]
pub async fn git_watch_stop(cwd: String) -> Result<(), String> {
    crate::git::watcher::stop_watch(&cwd);
    Ok(())
}

#[derive(serde::Serialize)]
pub struct ConflictFile {
    pub path:   String,
    pub status: String,
}

#[tauri::command]
pub async fn git_conflicts(cwd: String) -> Result<Vec<ConflictFile>, String> {
    let out = std::process::Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(&cwd)
        .output()
        .map_err(|e| e.to_string())?;

    if !out.status.success() { return Ok(vec![]); }

    Ok(String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|line| {
            if line.len() < 4 { return None; }
            let status = &line[..2];
            let is_conflict = matches!(status, "UU"|"AA"|"DD"|"AU"|"UA"|"DU"|"UD");
            if !is_conflict { return None; }
            Some(ConflictFile { path: line[3..].trim().to_string(), status: status.to_string() })
        })
        .collect())
}

#[tauri::command]
pub async fn git_branches(cwd: String) -> Result<Vec<String>, String> {
    let out = std::process::Command::new("git")
        .args(["branch", "-a", "--format=%(refname:short)"])
        .current_dir(&cwd)
        .output()
        .map_err(|e| e.to_string())?;

    if !out.status.success() { return Ok(vec![]); }

    Ok(String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty() && !l.contains("HEAD"))
        .collect())
}

#[tauri::command]
pub async fn git_checkout(cwd: String, branch: String) -> Result<(), String> {
    let out = std::process::Command::new("git")
        .args(["checkout", &branch])
        .current_dir(&cwd)
        .output()
        .map_err(|e| e.to_string())?;

    if out.status.success() { return Ok(()); }

    let err = String::from_utf8_lossy(&out.stderr).trim().to_string();

    let out2 = std::process::Command::new("git")
        .args(["checkout", "-b", &branch, &format!("origin/{branch}")])
        .current_dir(&cwd)
        .output()
        .map_err(|e| e.to_string())?;

    if out2.status.success() { return Ok(()); }

    Err(err)
}

#[tauri::command]
pub async fn git_diff_between_worktrees(
    cwd:       String,
    other_cwd: String,
) -> Result<String, String> {
    let get_head = |dir: &str| -> Result<String, String> {
        let out = std::process::Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(dir)
            .output()
            .map_err(|e| e.to_string())?;
        if out.status.success() {
            Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
        } else {
            Err(format!("could not get HEAD of {dir}"))
        }
    };

    let cur_hash   = get_head(&cwd)?;
    let other_hash = get_head(&other_cwd)?;

    if cur_hash == other_hash {
        return Ok("Worktrees are at the same commit — no differences.".to_string());
    }

    let stat_out = std::process::Command::new("git")
        .args(["diff", "--stat", &cur_hash, &other_hash])
        .current_dir(&cwd)
        .output()
        .map_err(|e| e.to_string())?;
    let stat = String::from_utf8_lossy(&stat_out.stdout).trim().to_string();

    let diff_out = std::process::Command::new("git")
        .args(["diff", &cur_hash, &other_hash])
        .current_dir(&cwd)
        .output()
        .map_err(|e| e.to_string())?;

    let full  = String::from_utf8_lossy(&diff_out.stdout);
    let lines: Vec<&str> = full.lines().collect();
    let capped = if lines.len() > 200 {
        format!("{}\n\n… ({} more lines — use git diff in terminal for full output)",
            lines[..200].join("\n"), lines.len() - 200)
    } else {
        full.to_string()
    };

    if stat.is_empty() && capped.trim().is_empty() {
        return Ok("No text differences found (binary files or identical content).".to_string());
    }

    Ok(format!("{}\n\n{}", stat, capped))
}