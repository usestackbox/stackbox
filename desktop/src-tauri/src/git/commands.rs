// src-tauri/src/git/commands.rs

use tauri::Emitter;
use super::{
    diff::{diff_for_commit, diff_live, clear_cache_for, LiveDiffFile},
    log::{log_for_runbox, GitCommit},
    repo::{ensure_git_repo, ensure_worktree, git, git_dir_opt, has_git, init_real_repo, remove_worktree},
};

/// Returned by git_ensure so the frontend/agent knows:
///   - whether git was freshly initialised this call
///   - the worktree path the agent should use for ALL its file operations
#[derive(serde::Serialize)]
pub struct GitEnsureResult {
    /// true if the git repo was created for the first time right now
    pub is_new:        bool,
    /// The isolated worktree path for this agent, e.g. /projects/stackbox-wt-abc123
    /// None only when the cwd has no real .git yet (shadow-repo path — no worktrees possible)
    pub worktree_path: Option<String>,
    /// The branch name inside the worktree, e.g. "stackbox/abc123"
    pub branch:        Option<String>,
}

/// Called once when an agent (runbox) starts.
///
/// 1. Ensures a git repo exists at `cwd` (creates shadow repo if needed).
/// 2. Eagerly creates an isolated worktree for this agent if a real .git exists.
/// 3. Returns the worktree path so the agent knows exactly where to work.
#[tauri::command]
pub async fn git_ensure(cwd: String, runbox_id: String) -> Result<GitEnsureResult, String> {
    let is_new = !has_git(&cwd, &runbox_id);
    ensure_git_repo(&cwd, &runbox_id)?;

    let worktree_path = ensure_worktree(&cwd, &runbox_id);

    let short  = &runbox_id[..runbox_id.len().min(8)];
    let branch = worktree_path.as_ref().map(|_| format!("stackbox/{short}"));

    if let Some(ref wt) = worktree_path {
        eprintln!("[git_ensure] agent {short} → worktree: {wt}");
    } else {
        eprintln!("[git_ensure] agent {short} → no worktree (shadow repo or no .git)");
    }

    Ok(GitEnsureResult { is_new, worktree_path, branch })
}

/// Lightweight query — returns the worktree path for an agent that is already running.
/// Use this when a second terminal connects to an existing agent so it can
/// navigate to the same worktree without calling git_ensure again.
#[tauri::command]
pub async fn git_agent_worktree(cwd: String, runbox_id: String) -> Result<Option<String>, String> {
    Ok(ensure_worktree(&cwd, &runbox_id))
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

// ─────────────────────────────────────────────────────────────────────────────
// PR — push branch + open PR via gh CLI
// ─────────────────────────────────────────────────────────────────────────────

/// Returned by git_push_pr and git_pull_merged so the frontend always gets
/// a structured response it can display.
#[derive(serde::Serialize)]
pub struct PrResult {
    /// The PR URL (GitHub) or remote branch compare URL (fallback)
    pub url:       String,
    /// The branch that was pushed / merged
    pub branch:    String,
    /// true = real PR was created/found, false = only branch was pushed
    pub is_pr:     bool,
    /// Human-readable status line for the frontend to display
    pub status:    String,
}

/// Push the agent's worktree branch and open a Pull Request via the `gh` CLI.
///
/// Flow:
///   1. Determine the current branch (must be stackbox/*)
///   2. Push to origin (set upstream on first push)
///   3. Create PR via `gh pr create` if gh is installed
///   4. If PR already exists, return the existing URL
///   5. If gh is not installed, return a GitHub compare URL as fallback
#[tauri::command]
pub async fn git_push_pr(
    cwd:         String,
    runbox_id:   String,
    title:       Option<String>,
    body:        Option<String>,
    base_branch: Option<String>,
) -> Result<PrResult, String> {
    let gdo_owned = git_dir_opt(&cwd, &runbox_id);
    let gdo: Option<&str> = gdo_owned.as_deref();

    // ── 1. Determine current branch ──────────────────────────────────────────
    let branch = git(&["rev-parse", "--abbrev-ref", "HEAD"], &cwd, gdo)
        .unwrap_or_default();
    let branch = branch.trim().to_string();

    if branch.is_empty() || branch == "HEAD" {
        return Err("Not on a named branch — cannot push PR.".to_string());
    }

    // ── 2. Guard: only create PRs from agent branches ────────────────────────
    if !branch.starts_with("stackbox/") {
        return Err(format!(
            "PRs are only created from agent branches (stackbox/*). Current branch: {branch}"
        ));
    }

    // ── 3. Push the branch ───────────────────────────────────────────────────
    let remotes = git(&["remote"], &cwd, gdo).unwrap_or_default();
    if !remotes.lines().any(|l| l.trim() == "origin") {
        return Err("No remote 'origin' configured. Add a remote first.".to_string());
    }

    let push_result = git(&["push", "origin", &branch], &cwd, gdo);
    if let Err(e) = push_result {
        if e.contains("no upstream") || e.contains("--set-upstream") {
            git(&["push", "--set-upstream", "origin", &branch], &cwd, gdo)?;
        } else {
            return Err(format!("push failed: {e}"));
        }
    }
    eprintln!("[git_push_pr] pushed branch {branch}");

    // ── 4. Build PR title/body ────────────────────────────────────────────────
    let base = base_branch.as_deref().unwrap_or("main");

    let pr_title = title.unwrap_or_else(|| {
        branch
            .strip_prefix("stackbox/")
            .map(|s| format!("stackbox: {s}"))
            .unwrap_or_else(|| branch.clone())
    });

    let pr_body = body.unwrap_or_else(|| {
        format!("Automated PR from Stackbox agent branch `{branch}`.")
    });

    // ── 5. Try gh CLI ─────────────────────────────────────────────────────────
    let gh_available = std::process::Command::new("gh")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if !gh_available {
        let remote_url = git(&["remote", "get-url", "origin"], &cwd, gdo)
            .unwrap_or_default();
        let remote_url = remote_url.trim();
        let https_url = remote_url
            .replace("git@github.com:", "https://github.com/")
            .trim_end_matches(".git")
            .to_string();
        let compare_url = if https_url.contains("github.com") {
            format!("{https_url}/compare/{base}...{branch}?expand=1")
        } else {
            https_url
        };
        eprintln!("[git_push_pr] gh CLI not found — returning compare URL");
        return Ok(PrResult {
            url:    compare_url,
            branch,
            is_pr:  false,
            status: "Branch pushed. Open the URL to create a PR manually.".to_string(),
        });
    }

    // Run: gh pr create
    let gh_out = std::process::Command::new("gh")
        .args(["pr", "create",
               "--title", &pr_title,
               "--body",  &pr_body,
               "--base",  base,
               "--head",  &branch])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("gh exec: {e}"))?;

    if gh_out.status.success() {
        let url = String::from_utf8_lossy(&gh_out.stdout).trim().to_string();
        eprintln!("[git_push_pr] PR created: {url}");
        return Ok(PrResult {
            url,
            branch,
            is_pr:  true,
            status: "PR created.".to_string(),
        });
    }

    let err = String::from_utf8_lossy(&gh_out.stderr).trim().to_string();

    // PR already exists — return existing URL
    if err.contains("already exists") {
        let view_out = std::process::Command::new("gh")
            .args(["pr", "view", &branch, "--json", "url", "--jq", ".url"])
            .current_dir(&cwd)
            .output()
            .map_err(|e| format!("gh pr view: {e}"))?;
        let url = String::from_utf8_lossy(&view_out.stdout).trim().to_string();
        eprintln!("[git_push_pr] PR already open: {url}");
        return Ok(PrResult {
            url,
            branch,
            is_pr:  true,
            status: "PR already open.".to_string(),
        });
    }

    Err(format!("gh pr create failed: {err}"))
}

/// Pull the merged changes back into the worktree after a PR is merged.
///
/// Flow:
///   1. Fetch latest from origin
///   2. Check if the agent's branch is merged (via gh pr view, or merge-base fallback)
///   3. If merged: checkout base branch + pull
///   4. Return status so the frontend can update the UI
#[tauri::command]
pub async fn git_pull_merged(
    cwd:         String,
    runbox_id:   String,
    base_branch: Option<String>,
) -> Result<PrResult, String> {
    let gdo_owned = git_dir_opt(&cwd, &runbox_id);
    let gdo: Option<&str> = gdo_owned.as_deref();

    let base = base_branch.as_deref().unwrap_or("main");

    // ── 1. Determine current branch ──────────────────────────────────────────
    let branch = git(&["rev-parse", "--abbrev-ref", "HEAD"], &cwd, gdo)
        .unwrap_or_default();
    let branch = branch.trim().to_string();

    // ── 2. Fetch ──────────────────────────────────────────────────────────────
    git(&["fetch", "origin"], &cwd, gdo)?;

    // ── 3. Check merge status ─────────────────────────────────────────────────
    let gh_available = std::process::Command::new("gh")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    let (is_merged, pr_url) = if gh_available && branch.starts_with("stackbox/") {
        // Ask gh for PR state
        let state_out = std::process::Command::new("gh")
            .args(["pr", "view", &branch, "--json", "state,url", "--jq", "[.state, .url] | @tsv"])
            .current_dir(&cwd)
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default();

        let mut parts = state_out.splitn(2, '\t');
        let state = parts.next().unwrap_or("").to_uppercase();
        let url   = parts.next().unwrap_or("").to_string();
        (state == "MERGED", url)
    } else {
        // Fallback: check if agent branch tip is an ancestor of origin/base
        let merged = git(
            &["merge-base", "--is-ancestor",
              &format!("origin/{branch}"),
              &format!("origin/{base}")],
            &cwd, gdo,
        ).is_ok();
        (merged, String::new())
    };

    if !is_merged {
        return Ok(PrResult {
            url:    pr_url,
            branch,
            is_pr:  true,
            status: "PR is not merged yet. Nothing pulled.".to_string(),
        });
    }

    // ── 4. Checkout base and pull ─────────────────────────────────────────────
    git(&["checkout", base], &cwd, gdo)?;
    git(&["pull", "origin", base], &cwd, gdo)?;

    eprintln!("[git_pull_merged] pulled {base} after merge of {branch}");

    Ok(PrResult {
        url:    pr_url,
        branch,
        is_pr:  true,
        status: format!("Merged. Worktree is now on '{base}' with latest changes."),
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Worktree management
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn git_worktree_create(
    cwd: String, branch: String, wt_name: String,
) -> Result<String, String> {
    let cwd_path = std::path::Path::new(&cwd);

    let folder_name = cwd_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("worktree");

    if !cwd_path.join(".git").exists() {
        init_real_repo(&cwd).map_err(|e| format!("auto git init failed: {e}"))?;
    }

    let parent  = cwd_path.parent().ok_or("cwd has no parent")?;
    let wt_path = parent.join(format!("{folder_name}-{wt_name}"));
    let wt_str  = wt_path.to_str().ok_or("non-UTF8 path")?;

    if wt_path.exists() { return Ok(wt_str.to_string()); }

    let out = std::process::Command::new("git")
        .args(["worktree", "add", "-b", &branch, wt_str, "HEAD"])
        .current_dir(&cwd)
        .output()
        .map_err(|e| e.to_string())?;

    if out.status.success() {
        eprintln!("[git] worktree created: {wt_str} on branch {branch}");
        return Ok(wt_str.to_string());
    }

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

// ─────────────────────────────────────────────────────────────────────────────
// Commit / push / stage
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Worktree list / watch / conflicts / branches / checkout / diff
// ─────────────────────────────────────────────────────────────────────────────

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