// src/git/commands.rs
//
// Tauri commands for git operations exposed to frontend + MCP.
// Agents call worktree lifecycle commands (git_ensure, git_commit, git_push_pr,
// git_worktree_delete) via MCP to manage their own isolated branches.

use tauri::Emitter;
use super::{
    diff::{diff_for_commit, diff_live, clear_cache_for, LiveDiffFile},
    log::{log_for_runbox, GitCommit},
    repo::{
        delete_worktree, ensure_git_repo, ensure_worktree, git, git_dir_opt,
        has_git, init_real_repo, list_worktrees, remove_worktree,
        WorktreeEntry,
    },
};
use crate::{db, state::AppState};

// ─────────────────────────────────────────────────────────────────────────────
// Result types
// ─────────────────────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct GitEnsureResult {
    pub is_new:        bool,
    pub worktree_path: Option<String>,
    pub branch:        Option<String>,
    pub worktree_new:  bool,
}

#[derive(serde::Serialize)]
pub struct PushPrResult {
    pub pr_url: String,
    pub branch: String,
    pub pushed: bool,
    /// Legacy field — same as pr_url, kept for frontend compatibility.
    pub url:    String,
    pub is_pr:  bool,
    pub status: String,
}

// ─────────────────────────────────────────────────────────────────────────────
// git_ensure — called by agent via MCP at session start
// ─────────────────────────────────────────────────────────────────────────────

/// Ensure git repo + worktree exist for this agent session.
/// Persists worktree path and branch to the database.
#[tauri::command]
pub async fn git_ensure(
    cwd:        String,
    runbox_id:  String,
    agent_kind: Option<String>,
    state:      tauri::State<'_, AppState>,
) -> Result<GitEnsureResult, String> {
    let is_new   = !has_git(&cwd, &runbox_id);
    ensure_git_repo(&cwd, &runbox_id)?;

    let kind = agent_kind.as_deref().unwrap_or("shell");
    let wt   = ensure_worktree(&cwd, &runbox_id, kind);

    let worktree_path = wt.as_ref().map(|w| w.path.clone());
    let branch        = wt.as_ref().map(|w| w.branch.clone());
    let worktree_new  = wt.as_ref().map(|w| w.is_new).unwrap_or(false);

    // Persist to DB
    if let Some(ref w) = wt {
        db::runboxes::runbox_set_worktree(
            &state.db,
            &runbox_id,
            kind,
            Some(w.path.as_str()),
            Some(w.branch.as_str()),
        )
        .map_err(|e| e.to_string())?;
    }

    let short = &runbox_id[..runbox_id.len().min(8)];
    match &worktree_path {
        Some(p) => eprintln!("[git_ensure] {kind}/{short} → worktree: {p}"),
        None    => eprintln!("[git_ensure] {kind}/{short} → no worktree"),
    }

    Ok(GitEnsureResult { is_new, worktree_path, branch, worktree_new })
}

/// Lightweight query — get the worktree path for an already-running agent.
/// Use when a second terminal connects to an existing runbox.
#[tauri::command]
pub async fn git_agent_worktree(
    cwd:        String,
    runbox_id:  String,
    agent_kind: Option<String>,
) -> Result<Option<String>, String> {
    let kind = agent_kind.as_deref().unwrap_or("shell");
    Ok(ensure_worktree(&cwd, &runbox_id, kind).map(|w| w.path))
}

// ─────────────────────────────────────────────────────────────────────────────
// git_commit — stage all + commit (called by agent after completing work)
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn git_commit(
    worktree_path: String,
    message:       String,
) -> Result<String, String> {
    commit_direct(&worktree_path, &message)
}

/// Non-command helper callable from MCP tools dispatcher.
pub fn commit_direct(worktree_path: &str, message: &str) -> Result<String, String> {
    // Stage all
    let add = std::process::Command::new("git")
        .args(["add", "-A"])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !add.status.success() {
        return Err(String::from_utf8_lossy(&add.stderr).to_string());
    }

    // Commit
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
// git_push_pr — push branch + open PR via gh CLI
// ─────────────────────────────────────────────────────────────────────────────

/// Push the agent's worktree branch and open a Pull Request via gh CLI.
/// Saves the PR url to the database so the webhook handler can match events.
#[tauri::command]
pub async fn git_push_pr(
    cwd:         String,
    runbox_id:   String,
    title:       Option<String>,
    body:        Option<String>,
    base_branch: Option<String>,
    state:       tauri::State<'_, AppState>,
) -> Result<PushPrResult, String> {
    let result = push_pr_direct(
        &cwd,
        &runbox_id,
        title,
        body,
        base_branch,
        &state.db,
    ).await?;
    Ok(result)
}

/// Non-command helper callable from MCP tools dispatcher.
/// Takes `&db::Db` so it can be used from McpState.db without needing full AppState.
pub async fn push_pr_direct(
    cwd:         &str,
    runbox_id:   &str,
    title:       Option<String>,
    body:        Option<String>,
    base_branch: Option<String>,
    db:          &crate::db::Db,
) -> Result<PushPrResult, String> {
    let gdo_owned = git_dir_opt(cwd, runbox_id);
    let gdo: Option<&str> = gdo_owned.as_deref();

    // ── Current branch ───────────────────────────────────────────────────────
    let branch = git(&["rev-parse", "--abbrev-ref", "HEAD"], cwd, gdo)
        .unwrap_or_default()
        .trim()
        .to_string();

    if branch.is_empty() || branch == "HEAD" {
        return Err("Not on a named branch — cannot push PR.".into());
    }
    if !branch.starts_with("stackbox/") {
        return Err(format!(
            "PRs are only created from stackbox/* branches. Current: {branch}"
        ));
    }

    // ── Push ─────────────────────────────────────────────────────────────────
    let remotes = git(&["remote"], cwd, gdo).unwrap_or_default();
    if !remotes.lines().any(|l| l.trim() == "origin") {
        return Err("No remote 'origin' configured. Add a remote first.".into());
    }

    let pushed = if let Err(e) = git(&["push", "origin", &branch], cwd, gdo) {
        if e.contains("no upstream") || e.contains("--set-upstream") {
            git(&["push", "--set-upstream", "origin", &branch], cwd, gdo)?;
            true
        } else {
            return Err(format!("push failed: {e}"));
        }
    } else {
        true
    };

    let base     = base_branch.as_deref().unwrap_or("main");
    let pr_title = title.unwrap_or_else(|| {
        branch.strip_prefix("stackbox/")
            .map(|s| format!("stackbox: {s}"))
            .unwrap_or_else(|| branch.clone())
    });
    let pr_body = body.unwrap_or_else(|| {
        format!("Automated PR from Stackbox agent branch `{branch}`.")
    });

    // ── gh CLI ────────────────────────────────────────────────────────────────
    let gh_ok = std::process::Command::new("gh")
        .arg("--version").output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if !gh_ok {
        // Fallback: return GitHub compare URL
        let remote_url = git(&["remote", "get-url", "origin"], cwd, gdo)
            .unwrap_or_default();
        let https = remote_url.trim()
            .replace("git@github.com:", "https://github.com/")
            .trim_end_matches(".git")
            .to_string();
        let compare = if https.contains("github.com") {
            format!("{https}/compare/{base}...{branch}?expand=1")
        } else {
            https
        };
        return Ok(PushPrResult {
            pr_url: compare.clone(),
            url:    compare.clone(),
            branch,
            pushed,
            is_pr:  false,
            status: "Branch pushed. Open the URL to create a PR manually.".into(),
        });
    }

    // gh pr create
    let out = std::process::Command::new("gh")
        .args(["pr", "create",
               "--title", &pr_title,
               "--body",  &pr_body,
               "--base",  base,
               "--head",  &branch])
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("gh exec: {e}"))?;

    let pr_url = if out.status.success() {
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();

        // PR already exists — fetch its URL
        if err.contains("already exists") {
            let view = std::process::Command::new("gh")
                .args(["pr", "view", &branch, "--json", "url", "--jq", ".url"])
                .current_dir(cwd)
                .output()
                .map_err(|e| format!("gh pr view: {e}"))?;
            String::from_utf8_lossy(&view.stdout).trim().to_string()
        } else {
            return Err(format!("gh pr create failed: {err}"));
        }
    };

    eprintln!("[git] PR opened: {pr_url} for runbox {runbox_id}");

    // ── Persist to DB ─────────────────────────────────────────────────────────
    db::runboxes::runbox_set_pr(db, runbox_id, &pr_url)
        .map_err(|e| e.to_string())?;
    db::runboxes::runbox_set_status(db, runbox_id, "pr_open")
        .map_err(|e| e.to_string())?;

    Ok(PushPrResult {
        url:    pr_url.clone(),
        pr_url,
        branch,
        pushed,
        is_pr:  true,
        status: "PR created.".into(),
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// git_worktree_delete — clean up after PR merged / task cancelled
// ─────────────────────────────────────────────────────────────────────────────

/// Delete the agent's worktree and branch. Called after PR merge or cancellation.
#[tauri::command]
pub async fn git_worktree_delete(
    cwd:        String,
    runbox_id:  String,
    agent_kind: Option<String>,
    force:      Option<bool>,   // true = force delete (PR cancelled)
    state:      tauri::State<'_, AppState>,
) -> Result<(), String> {
    let kind        = agent_kind.as_deref().unwrap_or("shell");
    let safe_delete = !force.unwrap_or(false);

    delete_worktree(&cwd, &runbox_id, kind, safe_delete)?;

    db::runboxes::runbox_delete_worktree(&state.db, &runbox_id)
        .map_err(|e| e.to_string())?;

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Pull merged
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn git_pull_merged(
    cwd:         String,
    runbox_id:   String,
    base_branch: Option<String>,
) -> Result<PushPrResult, String> {
    let gdo_owned = git_dir_opt(&cwd, &runbox_id);
    let gdo: Option<&str> = gdo_owned.as_deref();
    let base = base_branch.as_deref().unwrap_or("main");

    let branch = git(&["rev-parse", "--abbrev-ref", "HEAD"], &cwd, gdo)
        .unwrap_or_default()
        .trim()
        .to_string();

    git(&["fetch", "origin"], &cwd, gdo)?;

    let gh_ok = std::process::Command::new("gh")
        .arg("--version").output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    let (is_merged, pr_url) = if gh_ok && branch.starts_with("stackbox/") {
        let out = std::process::Command::new("gh")
            .args(["pr", "view", &branch, "--json", "state,url", "--jq", "[.state,.url]|@tsv"])
            .current_dir(&cwd)
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default();
        let mut parts = out.splitn(2, '\t');
        let state_str = parts.next().unwrap_or("").to_uppercase();
        let url   = parts.next().unwrap_or("").to_string();
        (state_str == "MERGED", url)
    } else {
        let merged = git(
            &["merge-base", "--is-ancestor",
              &format!("origin/{branch}"),
              &format!("origin/{base}")],
            &cwd, gdo,
        ).is_ok();
        (merged, String::new())
    };

    if !is_merged {
        return Ok(PushPrResult {
            url: pr_url.clone(), pr_url,
            branch, pushed: false,
            is_pr: true,
            status: "PR not merged yet.".into(),
        });
    }

    git(&["checkout", base], &cwd, gdo)?;
    git(&["pull", "origin", base], &cwd, gdo)?;

    Ok(PushPrResult {
        url: pr_url.clone(), pr_url,
        branch, pushed: true,
        is_pr: true,
        status: format!("Merged. Now on '{base}' with latest changes."),
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Basic git commands
// ─────────────────────────────────────────────────────────────────────────────

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
// Worktree management (UI commands)
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn git_worktree_create(
    cwd: String, branch: String, wt_name: String,
) -> Result<String, String> {
    let cwd_path = std::path::Path::new(&cwd);

    let folder = cwd_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("worktree");

    if !cwd_path.join(".git").exists() {
        init_real_repo(&cwd)?;
    }

    let parent  = cwd_path.parent().ok_or("cwd has no parent")?;
    let wt_path = parent.join(format!("{folder}-{wt_name}"));
    let wt_str  = wt_path.to_str().ok_or("non-UTF8 path")?;

    if wt_path.exists() { return Ok(wt_str.to_string()); }

    // Try create new branch + worktree
    let out = std::process::Command::new("git")
        .args(["worktree", "add", "-b", &branch, wt_str, "HEAD"])
        .current_dir(&cwd)
        .output()
        .map_err(|e| e.to_string())?;

    if out.status.success() { return Ok(wt_str.to_string()); }

    // Branch exists — attach
    let out2 = std::process::Command::new("git")
        .args(["worktree", "add", wt_str, &branch])
        .current_dir(&cwd)
        .output()
        .map_err(|e| e.to_string())?;

    if out2.status.success() { return Ok(wt_str.to_string()); }

    Err(String::from_utf8_lossy(&out2.stderr).trim().to_string())
}

#[tauri::command]
pub async fn git_worktree_remove(wt_path: String) -> Result<(), String> {
    remove_worktree(&wt_path);
    Ok(())
}

/// List all worktrees including non-stackbox ones (for the worktree manager UI).
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
    let mut entries   = Vec::new();
    let mut path      = String::new();
    let mut branch    = String::new();
    let mut head      = String::new();
    let mut is_bare   = false;
    let mut is_locked = false;
    let mut first     = true;

    for line in text.lines() {
        if line.is_empty() {
            if !path.is_empty() {
                entries.push(FullWorktreeEntry {
                    path: path.clone(), branch: branch.clone(),
                    head: head.clone(), is_main: first,
                    is_bare, is_locked,
                });
                path.clear(); branch.clear(); head.clear();
                is_bare = false; is_locked = false; first = false;
            }
        } else if let Some(v) = line.strip_prefix("worktree ")          { path   = v.into(); }
          else if let Some(v) = line.strip_prefix("HEAD ")              { head   = v.into(); }
          else if let Some(v) = line.strip_prefix("branch refs/heads/") { branch = v.into(); }
          else if line == "bare"   { is_bare   = true; }
          else if line == "locked" { is_locked = true; }
    }
    if !path.is_empty() {
        entries.push(FullWorktreeEntry { path, branch, head, is_main: first, is_bare, is_locked });
    }

    Ok(entries)
}

/// List only stackbox-managed worktrees.
#[tauri::command]
pub async fn git_worktree_list_stackbox(cwd: String) -> Result<Vec<WorktreeEntry>, String> {
    Ok(list_worktrees(&cwd))
}

#[derive(serde::Serialize)]
pub struct FullWorktreeEntry {
    pub path:      String,
    pub branch:    String,
    pub head:      String,
    pub is_main:   bool,
    pub is_bare:   bool,
    pub is_locked: bool,
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
// Commit / stage / push
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn git_stage_and_commit(
    app:       tauri::AppHandle,
    cwd:       String,
    runbox_id: String,
    message:   String,
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

    let out  = git(&["commit", "-m", message.trim()], &cwd, gdo)?;
    let hash = git(&["rev-parse", "--short", "HEAD"], &cwd, gdo).unwrap_or_default();
    let short   = hash.trim();
    let summary = out.lines().next().unwrap_or("").trim().to_string();

    clear_cache_for(&cwd);
    let fresh = diff_live(&cwd, &runbox_id).unwrap_or_default();
    let _ = app.emit("git:live-diff", &fresh);

    Ok(format!("[{short}] {summary}"))
}

#[tauri::command]
pub async fn git_push(cwd: String, runbox_id: String) -> Result<String, String> {
    let gdo_owned = git_dir_opt(&cwd, &runbox_id);
    let gdo: Option<&str> = gdo_owned.as_deref();

    let branch = git(&["rev-parse", "--abbrev-ref", "HEAD"], &cwd, gdo)
        .unwrap_or_default()
        .trim()
        .to_string();

    if branch.is_empty() || branch == "HEAD" {
        return Err("Not on a named branch — cannot push.".into());
    }

    let remotes = git(&["remote"], &cwd, gdo).unwrap_or_default();
    if !remotes.lines().any(|l| l.trim() == "origin") {
        return Err("No remote 'origin' configured.".into());
    }

    match git(&["push", "origin", &branch], &cwd, gdo) {
        Ok(out) => Ok(out.trim().lines().last().unwrap_or("Pushed.").to_string()),
        Err(e) => {
            if e.contains("no upstream") || e.contains("--set-upstream") {
                git(&["push", "--set-upstream", "origin", &branch], &cwd, gdo)?;
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
    if git(&["restore", "--staged", &path], &cwd, gdo).is_err() {
        git(&["rm", "--cached", &path], &cwd, gdo)?;
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Misc
// ─────────────────────────────────────────────────────────────────────────────

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
            let conflict = matches!(status, "UU"|"AA"|"DD"|"AU"|"UA"|"DU"|"UD");
            if !conflict { return None; }
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
    cwd: String, other_cwd: String,
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

    let cur   = get_head(&cwd)?;
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
    let full     = String::from_utf8_lossy(&diff.stdout);
    let lines: Vec<&str> = full.lines().collect();
    let capped = if lines.len() > 200 {
        format!("{}\n\n… ({} more lines)",
            lines[..200].join("\n"), lines.len() - 200)
    } else {
        full.to_string()
    };

    if stat_str.is_empty() && capped.trim().is_empty() {
        return Ok("No text differences found.".into());
    }

    Ok(format!("{stat_str}\n\n{capped}"))
}

// ─────────────────────────────────────────────────────────────────────────────
// NEW COMMANDS
// ─────────────────────────────────────────────────────────────────────────────

// ── Discard working-tree changes for a single file ───────────────────────────

/// Discards unstaged changes for a single file.
/// Tries `git restore --worktree` (Git ≥ 2.23) then falls back to `git checkout --`.
#[tauri::command]
pub async fn git_discard_file(
    cwd: String, runbox_id: String, path: String,
) -> Result<(), String> {
    let gdo_owned = git_dir_opt(&cwd, &runbox_id);
    let gdo: Option<&str> = gdo_owned.as_deref();
    // First try restore (Git ≥ 2.23)
    if git(&["restore", "--worktree", "--", &path], &cwd, gdo).is_ok() {
        return Ok(());
    }
    // Fallback for older Git
    git(&["checkout", "--", &path], &cwd, gdo)?;
    Ok(())
}

// ── PR detail types ───────────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Default)]
pub struct PrDetails {
    pub title:      String,
    pub body:       String,
    pub number:     u64,
    pub state:      String,      // OPEN | MERGED | CLOSED
    pub url:        String,
    pub mergeable:  String,      // MERGEABLE | CONFLICTING | UNKNOWN
    pub author:     String,
    pub created_at: String,
    pub reviews:    Vec<PrReview>,
    pub checks:     Vec<PrCheck>,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct PrReview {
    pub author: String,
    pub state:  String,   // APPROVED | CHANGES_REQUESTED | COMMENTED
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct PrCheck {
    pub name:       String,
    pub status:     String,   // SUCCESS | FAILURE | PENDING | IN_PROGRESS | SKIPPED
    pub conclusion: String,
}

// ── git_pr_view — fetch PR details via gh CLI ─────────────────────────────────

/// Fetches full PR details for the current branch via `gh pr view --json ...`.
/// Returns an error string if no PR exists or gh CLI is not installed.
#[tauri::command]
pub async fn git_pr_view(cwd: String) -> Result<PrDetails, String> {
    let fields = "title,body,number,state,url,mergeable,author,createdAt,reviews,statusCheckRollup";
    let out = std::process::Command::new("gh")
        .args(["pr", "view", "--json", fields])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("gh not found: {e}"))?;

    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }

    let raw: serde_json::Value = serde_json::from_slice(&out.stdout)
        .map_err(|e| e.to_string())?;

    let reviews = raw["reviews"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|r| PrReview {
            author: r["author"]["login"].as_str().unwrap_or("").to_string(),
            state:  r["state"].as_str().unwrap_or("").to_string(),
        })
        .collect();

    let checks = raw["statusCheckRollup"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|c| PrCheck {
            name:       c["name"].as_str()
                            .or_else(|| c["context"].as_str())
                            .unwrap_or("check")
                            .to_string(),
            status:     c["status"].as_str().unwrap_or("UNKNOWN").to_string(),
            conclusion: c["conclusion"].as_str()
                            .or_else(|| c["state"].as_str())
                            .unwrap_or("")
                            .to_string(),
        })
        .collect();

    Ok(PrDetails {
        title:      raw["title"].as_str().unwrap_or("").to_string(),
        body:       raw["body"].as_str().unwrap_or("").to_string(),
        number:     raw["number"].as_u64().unwrap_or(0),
        state:      raw["state"].as_str().unwrap_or("").to_string(),
        url:        raw["url"].as_str().unwrap_or("").to_string(),
        mergeable:  raw["mergeable"].as_str().unwrap_or("UNKNOWN").to_string(),
        author:     raw["author"]["login"].as_str().unwrap_or("").to_string(),
        created_at: raw["createdAt"].as_str().unwrap_or("").to_string(),
        reviews,
        checks,
    })
}

// ── git_pr_merge — merge the open PR via gh CLI ───────────────────────────────

/// Squash-merges the current branch PR and deletes the remote branch.
#[tauri::command]
pub async fn git_pr_merge(cwd: String) -> Result<String, String> {
    let out = std::process::Command::new("gh")
        .args(["pr", "merge", "--squash", "--delete-branch"])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("gh not found: {e}"))?;

    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }

    Ok("Merged and branch deleted.".to_string())
}