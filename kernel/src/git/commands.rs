// src/git/commands.rs
//
// Tauri commands for git operations exposed to frontend + MCP.
//
// REMOVED: git_push_pr, git_pull_merged, git_pr_view, git_pr_merge, git_push
//   (GitHub / PR workflow replaced by local branch merge)
//
// ADDED: git_merge_branch, git_delete_branch, git_branch_log,
//        git_branch_status, git_agent_branches

use super::{
    diff::{clear_cache_for, diff_for_commit, diff_live, LiveDiffFile},
    log::{log_for_runbox, log_range, GitCommit},
    repo::{
        delete_branch, ensure_git_repo, ensure_worktree, expand_home, git, git_dir_opt, has_git,
        init_real_repo, list_worktrees, remove_worktree_only, WorktreeEntry,
    },
};
use crate::{db, state::AppState};
use tauri::Emitter;

// ─────────────────────────────────────────────────────────────────────────────
// Result types
// ─────────────────────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct GitEnsureResult {
    pub is_new: bool,
    pub worktree_path: Option<String>,
    pub branch: Option<String>,
    pub worktree_new: bool,
}

#[derive(serde::Serialize)]
pub struct BranchStatus {
    pub ahead: usize,
    pub behind: usize,
    pub has_conflicts: bool,
}

// ─────────────────────────────────────────────────────────────────────────────
// git_ensure — called by agent via MCP at session start
// ─────────────────────────────────────────────────────────────────────────────

/// Ensure git repo + worktree exist for this agent session.
/// Persists branch record to the database.
#[tauri::command]
pub async fn git_ensure(
    cwd: String,
    runbox_id: String,
    session_id: Option<String>,
    agent_kind: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<GitEnsureResult, String> {
    let cwd = expand_home(&cwd);
    let is_new = !has_git(&cwd, &runbox_id);
    ensure_git_repo(&cwd, &runbox_id)?;

    let kind = agent_kind.as_deref().unwrap_or("shell");
    let sid = session_id.as_deref().unwrap_or(&runbox_id);

    let wt = ensure_worktree(&cwd, &runbox_id, sid, kind);

    let worktree_path = wt.as_ref().map(|w| w.path.clone());
    let branch = wt.as_ref().map(|w| w.branch.clone());
    let worktree_new = wt.as_ref().map(|w| w.is_new).unwrap_or(false);

    if let Some(ref w) = wt {
        let _ =
            db::branches::record_branch_start(&state.db, &runbox_id, sid, kind, &w.branch, &w.path);
    }

    let short = &runbox_id[..runbox_id.len().min(8)];
    match &worktree_path {
        Some(p) => eprintln!("[git_ensure] {kind}/{short} → worktree: {p}"),
        None => eprintln!("[git_ensure] {kind}/{short} → no worktree"),
    }

    Ok(GitEnsureResult {
        is_new,
        worktree_path,
        branch,
        worktree_new,
    })
}

/// Lightweight query — get the worktree path for an already-running agent.
#[tauri::command]
pub async fn git_agent_worktree(
    cwd: String,
    runbox_id: String,
    session_id: Option<String>,
    agent_kind: Option<String>,
) -> Result<Option<String>, String> {
    let kind = agent_kind.as_deref().unwrap_or("shell");
    let sid = session_id.as_deref().unwrap_or(&runbox_id);
    Ok(ensure_worktree(&cwd, &runbox_id, sid, kind).map(|w| w.path))
}

// ─────────────────────────────────────────────────────────────────────────────
// git_commit — stage all + commit
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn git_commit(worktree_path: String, message: String) -> Result<String, String> {
    commit_direct(&worktree_path, &message)
}

pub fn commit_direct(worktree_path: &str, message: &str) -> Result<String, String> {
    let add = std::process::Command::new("git")
        .args(["add", "-A"])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !add.status.success() {
        return Err(String::from_utf8_lossy(&add.stderr).to_string());
    }

    let out = std::process::Command::new("git")
        .args(["commit", "-m", message])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        if stderr.contains("nothing to commit") {
            return Ok("nothing to commit".to_string());
        }
        return Err(stderr);
    }

    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent branch commands — the new workflow (no GitHub, no PRs)
// ─────────────────────────────────────────────────────────────────────────────

/// List all agent branches for a runbox, from the DB.
/// Returns all branches including done/merged ones so the frontend can show history.
#[tauri::command]
pub async fn git_agent_branches(
    runbox_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<db::branches::AgentBranch>, String> {
    db::branches::list_for_runbox(&state.db, &runbox_id).map_err(|e| e.to_string())
}

/// Merge a stackbox agent branch into the current branch using --no-ff.
/// Only stackbox/* branches can be merged through this command.
/// Updates the branch status in the DB to 'merged'.
#[tauri::command]
pub async fn git_merge_branch(
    cwd: String,
    branch: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    if !branch.starts_with("stackbox/") {
        return Err(format!("can only merge stackbox/* branches, got: {branch}"));
    }

    // Verify the branch exists
    let check = std::process::Command::new("git")
        .args(["rev-parse", "--verify", &branch])
        .current_dir(&cwd)
        .output()
        .map_err(|e| e.to_string())?;

    if !check.status.success() {
        return Err(format!("branch '{branch}' not found"));
    }

    let msg = format!("merge agent work from {branch}");
    let out = std::process::Command::new("git")
        .args(["merge", "--no-ff", "-m", &msg, &branch])
        .current_dir(&cwd)
        .output()
        .map_err(|e| e.to_string())?;

    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }

    db::branches::record_branch_merged(&state.db, &branch).map_err(|e| e.to_string())?;

    eprintln!("[git] merged branch: {branch}");
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Delete a stackbox/* branch.
/// Uses -d (safe) by default; set force=true for -D.
/// Updates DB status to 'deleted'.
#[tauri::command]
pub async fn git_delete_branch(
    cwd: String,
    branch: String,
    force: Option<bool>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    delete_branch(&cwd, &branch, force.unwrap_or(false))?;

    db::branches::record_branch_deleted(&state.db, &branch).map_err(|e| e.to_string())?;

    Ok(())
}

/// Commits on an agent branch that are not yet on main.
#[tauri::command]
pub async fn git_branch_log(
    cwd: String,
    branch: String,
    base: Option<String>,
) -> Result<Vec<GitCommit>, String> {
    let base = base.as_deref().unwrap_or("main");
    let range = format!("{base}..{branch}");
    log_range(&cwd, &range)
}

/// How many commits ahead/behind a branch is vs main, and whether it conflicts.
#[tauri::command]
pub async fn git_branch_status(
    cwd: String,
    branch: String,
    base: Option<String>,
) -> Result<BranchStatus, String> {
    let base = base.as_deref().unwrap_or("main");

    let count_commits = |range: &str| -> usize {
        std::process::Command::new("git")
            .args(["rev-list", "--count", range])
            .current_dir(&cwd)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse().ok())
            .unwrap_or(0)
    };

    let ahead = count_commits(&format!("{base}..{branch}"));
    let behind = count_commits(&format!("{branch}..{base}"));

    // Quick conflict check via merge-tree (no actual merge)
    let merge_base_out = std::process::Command::new("git")
        .args(["merge-base", base, &branch])
        .current_dir(&cwd)
        .output()
        .ok();

    let has_conflicts = if let Some(out) = merge_base_out {
        if out.status.success() {
            let merge_base = String::from_utf8_lossy(&out.stdout).trim().to_string();
            std::process::Command::new("git")
                .args(["merge-tree", &merge_base, base, &branch])
                .current_dir(&cwd)
                .output()
                .ok()
                .map(|o| String::from_utf8_lossy(&o.stdout).contains("<<<<<<<"))
                .unwrap_or(false)
        } else {
            false
        }
    } else {
        false
    };

    Ok(BranchStatus {
        ahead,
        behind,
        has_conflicts,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Basic git commands (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

/// Cheap check — just tests whether a .git directory (or file, for worktrees) exists.
/// Does NOT require any commits, so it reliably detects a freshly `git init`-ed repo
/// unlike `git_current_branch` which fails on an unborn HEAD.
#[tauri::command]
pub async fn git_is_repo(cwd: String) -> Result<bool, String> {
    let real = expand_home(&cwd);
    let git_path = std::path::Path::new(&real).join(".git");
    Ok(git_path.exists())
}

#[tauri::command]
pub async fn git_init(cwd: String) -> Result<(), String> {
    init_real_repo(&expand_home(&cwd))
}

#[tauri::command]
pub async fn git_log_for_runbox(cwd: String, runbox_id: String) -> Result<Vec<GitCommit>, String> {
    log_for_runbox(&cwd, &runbox_id)
}

#[tauri::command]
pub async fn git_diff_for_commit(
    cwd: String,
    runbox_id: String,
    hash: String,
) -> Result<String, String> {
    diff_for_commit(&cwd, &runbox_id, &hash)
}

#[tauri::command]
pub async fn git_diff_live(cwd: String, runbox_id: String) -> Result<Vec<LiveDiffFile>, String> {
    diff_live(&cwd, &runbox_id)
}

// ─────────────────────────────────────────────────────────────────────────────
// Worktree management (UI commands)
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn git_worktree_create(
    cwd: String,
    branch: String,
    wt_name: String,
) -> Result<String, String> {
    let cwd = expand_home(&cwd);
    let cwd_path = std::path::Path::new(&cwd);

    if !cwd_path.join(".git").exists() {
        init_real_repo(&cwd)?;
    }

    let wt_dir = cwd_path.join(".worktrees");
    std::fs::create_dir_all(&wt_dir).map_err(|e| e.to_string())?;
    let wt_path = wt_dir.join(&wt_name);
    let wt_str = wt_path.to_str().ok_or("non-UTF8 path")?;

    if wt_path.exists() {
        return Ok(wt_str.to_string());
    }

    let out = std::process::Command::new("git")
        .args(["worktree", "add", "-b", &branch, wt_str, "HEAD"])
        .current_dir(&cwd)
        .output()
        .map_err(|e| e.to_string())?;

    if out.status.success() {
        return Ok(wt_str.to_string());
    }

    let out2 = std::process::Command::new("git")
        .args(["worktree", "add", wt_str, &branch])
        .current_dir(&cwd)
        .output()
        .map_err(|e| e.to_string())?;

    if out2.status.success() {
        return Ok(wt_str.to_string());
    }

    Err(String::from_utf8_lossy(&out2.stderr).trim().to_string())
}

#[tauri::command]
pub async fn git_worktree_remove(wt_path: String) -> Result<(), String> {
    remove_worktree_only(&wt_path);
    Ok(())
}

#[tauri::command]
pub async fn git_worktree_list(cwd: String) -> Result<Vec<FullWorktreeEntry>, String> {
    let out = std::process::Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .current_dir(&cwd)
        .output()
        .map_err(|e| e.to_string())?;

    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }

    let text = String::from_utf8_lossy(&out.stdout);
    let mut entries = Vec::new();
    let mut path = String::new();
    let mut branch = String::new();
    let mut head = String::new();
    let mut is_bare = false;
    let mut is_locked = false;
    let mut first = true;

    for line in text.lines() {
        if line.is_empty() {
            if !path.is_empty() {
                entries.push(FullWorktreeEntry {
                    path: path.clone(),
                    branch: branch.clone(),
                    head: head.clone(),
                    is_main: first,
                    is_bare,
                    is_locked,
                });
                path.clear();
                branch.clear();
                head.clear();
                is_bare = false;
                is_locked = false;
                first = false;
            }
        } else if let Some(v) = line.strip_prefix("worktree ") {
            path = v.into();
        } else if let Some(v) = line.strip_prefix("HEAD ") {
            head = v.into();
        } else if let Some(v) = line.strip_prefix("branch refs/heads/") {
            branch = v.into();
        } else if line == "bare" {
            is_bare = true;
        } else if line == "locked" {
            is_locked = true;
        }
    }
    if !path.is_empty() {
        entries.push(FullWorktreeEntry {
            path,
            branch,
            head,
            is_main: first,
            is_bare,
            is_locked,
        });
    }

    Ok(entries)
}

#[tauri::command]
pub async fn git_worktree_list_stackbox(cwd: String) -> Result<Vec<WorktreeEntry>, String> {
    Ok(list_worktrees(&cwd))
}

#[derive(serde::Serialize)]
pub struct FullWorktreeEntry {
    pub path: String,
    pub branch: String,
    pub head: String,
    pub is_main: bool,
    pub is_bare: bool,
    pub is_locked: bool,
}

#[tauri::command]
pub async fn git_current_branch(cwd: String) -> Result<String, String> {
    let real = expand_home(&cwd);
    let out = std::process::Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(&real)
        .output()
        .map_err(|e| e.to_string())?;

    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Ok(String::new())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Commit / stage
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn git_stage_and_commit(
    app: tauri::AppHandle,
    cwd: String,
    runbox_id: String,
    message: String,
) -> Result<String, String> {
    if message.trim().is_empty() {
        return Err("commit message cannot be empty".into());
    }

    let gdo_owned = git_dir_opt(&cwd, &runbox_id);
    let gdo: Option<&str> = gdo_owned.as_deref();

    git(&["add", "-A"], &cwd, gdo)?;

    let status = git(&["status", "--porcelain"], &cwd, gdo).unwrap_or_default();
    if status.trim().is_empty() {
        return Err("nothing to commit — working tree clean".into());
    }

    let out = git(&["commit", "-m", message.trim()], &cwd, gdo)?;
    let hash = git(&["rev-parse", "--short", "HEAD"], &cwd, gdo).unwrap_or_default();
    let short = hash.trim();
    let summary = out.lines().next().unwrap_or("").trim().to_string();

    clear_cache_for(&cwd);
    let fresh = diff_live(&cwd, &runbox_id).unwrap_or_default();
    let _ = app.emit("git:live-diff", &fresh);

    Ok(format!("[{short}] {summary}"))
}

#[tauri::command]
pub async fn git_stage_file(cwd: String, runbox_id: String, path: String) -> Result<(), String> {
    let gdo_owned = git_dir_opt(&cwd, &runbox_id);
    let gdo: Option<&str> = gdo_owned.as_deref();
    git(&["add", &path], &cwd, gdo)?;
    Ok(())
}

#[tauri::command]
pub async fn git_unstage_file(cwd: String, runbox_id: String, path: String) -> Result<(), String> {
    let gdo_owned = git_dir_opt(&cwd, &runbox_id);
    let gdo: Option<&str> = gdo_owned.as_deref();
    if git(&["restore", "--staged", &path], &cwd, gdo).is_err() {
        git(&["rm", "--cached", &path], &cwd, gdo)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn git_discard_file(cwd: String, runbox_id: String, path: String) -> Result<(), String> {
    let gdo_owned = git_dir_opt(&cwd, &runbox_id);
    let gdo: Option<&str> = gdo_owned.as_deref();
    if git(&["restore", "--worktree", "--", &path], &cwd, gdo).is_ok() {
        return Ok(());
    }
    git(&["checkout", "--", &path], &cwd, gdo)?;
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Misc
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn git_watch_start(
    app: tauri::AppHandle,
    cwd: String,
    runbox_id: String,
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
    pub path: String,
    pub status: String,
}

#[tauri::command]
pub async fn git_conflicts(cwd: String) -> Result<Vec<ConflictFile>, String> {
    let out = std::process::Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(&cwd)
        .output()
        .map_err(|e| e.to_string())?;

    if !out.status.success() {
        return Ok(vec![]);
    }

    Ok(String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|line| {
            if line.len() < 4 {
                return None;
            }
            let status = &line[..2];
            let conflict = matches!(status, "UU" | "AA" | "DD" | "AU" | "UA" | "DU" | "UD");
            if !conflict {
                return None;
            }
            Some(ConflictFile {
                path: line[3..].trim().to_string(),
                status: status.to_string(),
            })
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

    if !out.status.success() {
        return Ok(vec![]);
    }

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

    if out.status.success() {
        return Ok(());
    }
    let err = String::from_utf8_lossy(&out.stderr).trim().to_string();

    let out2 = std::process::Command::new("git")
        .args(["checkout", "-b", &branch, &format!("origin/{branch}")])
        .current_dir(&cwd)
        .output()
        .map_err(|e| e.to_string())?;

    if out2.status.success() {
        return Ok(());
    }
    Err(err)
}

#[tauri::command]
pub async fn git_rename_branch(
    cwd: String,
    old_name: String,
    new_name: String,
) -> Result<(), String> {
    let out = std::process::Command::new("git")
        .args(["branch", "-m", &old_name, &new_name])
        .current_dir(&cwd)
        .output()
        .map_err(|e| e.to_string())?;

    if out.status.success() {
        return Ok(());
    }
    Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
}

#[tauri::command]
pub async fn git_diff_between_worktrees(cwd: String, other_cwd: String) -> Result<String, String> {
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

    let cur = get_head(&cwd)?;
    let other = get_head(&other_cwd)?;

    if cur == other {
        return Ok("Worktrees are at the same commit — no differences.".into());
    }

    let stat = std::process::Command::new("git")
        .args(["diff", "--stat", &cur, &other])
        .current_dir(&cwd)
        .output()
        .map_err(|e| e.to_string())?;

    let diff = std::process::Command::new("git")
        .args(["diff", &cur, &other])
        .current_dir(&cwd)
        .output()
        .map_err(|e| e.to_string())?;

    let stat_str = String::from_utf8_lossy(&stat.stdout).trim().to_string();
    let full = String::from_utf8_lossy(&diff.stdout);
    let lines: Vec<&str> = full.lines().collect();
    let capped = if lines.len() > 200 {
        format!(
            "{}\n\n… ({} more lines)",
            lines[..200].join("\n"),
            lines.len() - 200
        )
    } else {
        full.to_string()
    };

    if stat_str.is_empty() && capped.trim().is_empty() {
        return Ok("No text differences found.".into());
    }

    Ok(format!("{stat_str}\n\n{capped}"))
}
