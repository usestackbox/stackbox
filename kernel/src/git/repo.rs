// src/git/repo.rs
//
// Git repository and worktree management.
//
// Worktree naming convention:
//   stackbox-wt-{runbox_short}-{agent_slug}
//
// Key design:
//   - runbox_id is ALWAYS the unique key (one per terminal)
//   - agent_kind is cosmetic only (readable folder names)
//   - 3 Claude instances = 3 different runbox_ids = 3 different worktrees, no collision

use std::path::Path;

// ─────────────────────────────────────────────────────────────────────────────
// Git directory helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Returns the git dir for a runbox.
/// If .git exists in cwd → use it.
/// Otherwise → shadow repo in ~/.local/share/stackbox/git/{runbox_id}
pub fn git_dir_for(cwd: &str, runbox_id: &str) -> String {
    let dot_git = Path::new(cwd).join(".git");
    if dot_git.exists() {
        return dot_git.to_string_lossy().to_string();
    }
    dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("stackbox")
        .join("git")
        .join(runbox_id)
        .to_string_lossy()
        .to_string()
}

/// Returns Some(shadow_dir) if this cwd uses a shadow repo, None if it has a real .git
pub fn git_dir_opt(cwd: &str, runbox_id: &str) -> Option<String> {
    let dot_git = Path::new(cwd).join(".git");
    if dot_git.is_dir()  { return None; }
    if dot_git.is_file() { return None; } // worktree pointer file
    let shadow = git_dir_for(cwd, runbox_id);
    if Path::new(&shadow).exists() { Some(shadow) } else { None }
}

pub fn has_git(cwd: &str, runbox_id: &str) -> bool {
    Path::new(cwd).join(".git").exists()
        || Path::new(&git_dir_for(cwd, runbox_id)).exists()
}

// ─────────────────────────────────────────────────────────────────────────────
// Git command runner
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Repo initialisation
// ─────────────────────────────────────────────────────────────────────────────

pub fn init_real_repo(cwd: &str) -> Result<(), String> {
    let out = std::process::Command::new("git")
        .args(["init"])
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("git init: {e}"))?;

    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }

    // Set local identity if no global identity configured
    let has_global_email = std::process::Command::new("git")
        .args(["config", "--global", "user.email"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if !has_global_email {
        let _ = std::process::Command::new("git")
            .args(["config", "user.email", "stackbox@local"])
            .current_dir(cwd).output();
        let _ = std::process::Command::new("git")
            .args(["config", "user.name", "Stackbox"])
            .current_dir(cwd).output();
    }

    // Initial empty commit so worktrees can branch off HEAD
    let _ = std::process::Command::new("git")
        .args(["commit", "--allow-empty", "-m", "stackbox: init"])
        .current_dir(cwd)
        .output();

    eprintln!("[git] real repo initialised at {cwd}");
    Ok(())
}

/// Ensure a git repo exists at cwd.
/// - If real .git exists → return as-is
/// - If shadow repo exists → return shadow path
/// - Otherwise → create shadow bare repo
pub fn ensure_git_repo(cwd: &str, runbox_id: &str) -> Result<String, String> {
    let dot_git = Path::new(cwd).join(".git");

    if dot_git.is_dir() {
        return Ok(dot_git.to_string_lossy().to_string());
    }
    if dot_git.is_file() {
        // worktree pointer — remove stale file if it points nowhere
        let _ = std::fs::remove_file(&dot_git);
    }

    let shadow      = git_dir_for(cwd, runbox_id);
    let shadow_head = Path::new(&shadow).join("HEAD");
    if shadow_head.exists() {
        return Ok(shadow);
    }

    std::fs::create_dir_all(&shadow).map_err(|e| format!("mkdir shadow: {e}"))?;

    std::process::Command::new("git")
        .args(["init", "--bare"])
        .current_dir(&shadow)
        .output()
        .map_err(|e| format!("git init --bare: {e}"))?;

    std::process::Command::new("git")
        .args(["config", "core.worktree", cwd])
        .current_dir(&shadow)
        .output()
        .map_err(|e| format!("git config: {e}"))?;

    git(&["add", "-A"], cwd, Some(&shadow)).ok();
    git(&["commit", "--allow-empty", "-m", "stackbox: initial snapshot"], cwd, Some(&shadow)).ok();

    eprintln!("[git] shadow repo created at {shadow}");
    Ok(shadow)
}

// ─────────────────────────────────────────────────────────────────────────────
// Worktree management
// ─────────────────────────────────────────────────────────────────────────────

/// Slugify agent kind for use in folder/branch names.
fn agent_slug(agent_kind: &str) -> String {
    agent_kind
        .to_lowercase()
        .replace(' ', "-")
        .replace('_', "-")
}

/// Worktree info returned to callers.
#[derive(Debug, Clone)]
pub struct WorktreeInfo {
    /// Absolute path to the worktree directory
    pub path:   String,
    /// Branch name, e.g. "stackbox/a1b2c3d4"
    pub branch: String,
    /// Whether it was freshly created (false = already existed)
    pub is_new: bool,
}

/// Create (or return existing) an isolated git worktree for one agent session.
///
/// Naming: `stackbox-wt-{runbox_short}-{agent_slug}` / `stackbox/{runbox_short}`
/// Idempotent — safe to call multiple times.
/// Returns None when cwd has no real .git directory.
pub fn ensure_worktree(cwd: &str, runbox_id: &str, agent_kind: &str) -> Option<WorktreeInfo> {
    if !Path::new(cwd).join(".git").is_dir() {
        eprintln!("[git] no real .git at {cwd} — skipping worktree creation");
        return None;
    }

    let short  = &runbox_id[..runbox_id.len().min(8)];
    let slug   = agent_slug(agent_kind);
    let branch = format!("stackbox/{short}");
    let name   = format!("stackbox-wt-{short}-{slug}");
    let parent = Path::new(cwd).parent()?;
    let wt_path = parent.join(&name);
    let wt_str  = wt_path.to_str()?.to_string();

    // Already exists — return immediately
    if wt_path.exists() {
        eprintln!("[git] worktree exists: {wt_str}");
        return Some(WorktreeInfo { path: wt_str, branch, is_new: false });
    }

    // Attempt 1: create new branch + worktree
    let out = std::process::Command::new("git")
        .args(["worktree", "add", "-b", &branch, &wt_str, "HEAD"])
        .current_dir(cwd)
        .output()
        .ok()?;

    if out.status.success() {
        eprintln!("[git] worktree created: {wt_str} on branch {branch}");
        return Some(WorktreeInfo { path: wt_str, branch, is_new: true });
    }

    // Attempt 2: branch already exists (agent restarted) — reattach without -b
    let out2 = std::process::Command::new("git")
        .args(["worktree", "add", &wt_str, &branch])
        .current_dir(cwd)
        .output()
        .ok()?;

    if out2.status.success() {
        eprintln!("[git] worktree reattached: {wt_str} on existing branch {branch}");
        return Some(WorktreeInfo { path: wt_str, branch, is_new: false });
    }

    eprintln!(
        "[git] worktree add failed: {}",
        String::from_utf8_lossy(&out2.stderr).trim()
    );
    None
}

/// Get worktree path if it already exists on disk (no creation).
pub fn get_worktree_if_exists(cwd: &str, runbox_id: &str, agent_kind: &str) -> Option<String> {
    let short   = &runbox_id[..runbox_id.len().min(8)];
    let slug    = agent_slug(agent_kind);
    let name    = format!("stackbox-wt-{short}-{slug}");
    let parent  = Path::new(cwd).parent()?;
    let wt_path = parent.join(&name);
    if wt_path.exists() {
        wt_path.to_str().map(str::to_string)
    } else {
        None
    }
}

/// Remove a worktree — idempotent, safe if already removed.
pub fn remove_worktree(wt_path: &str) {
    if !Path::new(wt_path).exists() { return; }

    let _ = std::process::Command::new("git")
        .args(["worktree", "remove", "--force", wt_path])
        .output();

    let _ = std::process::Command::new("git")
        .args(["worktree", "prune"])
        .output();

    eprintln!("[git] worktree removed: {wt_path}");
}

/// Delete worktree folder + branch after a PR is merged or task cancelled.
///
/// `safe_delete = true`  → `git branch -d` (fails if branch not merged — safe)
/// `safe_delete = false` → `git branch -D` (force delete — for cancelled tasks)
pub fn delete_worktree(
    cwd:         &str,
    runbox_id:   &str,
    agent_kind:  &str,
    safe_delete: bool,
) -> Result<(), String> {
    let short   = &runbox_id[..runbox_id.len().min(8)];
    let slug    = agent_slug(agent_kind);
    let branch  = format!("stackbox/{short}");
    let name    = format!("stackbox-wt-{short}-{slug}");
    let parent  = Path::new(cwd).parent().ok_or("no parent directory")?;
    let wt_str  = parent.join(&name).to_string_lossy().to_string();

    // 1. Remove worktree (detaches from git's tracking list)
    let rm_out = std::process::Command::new("git")
        .args(["worktree", "remove", "--force", &wt_str])
        .current_dir(cwd)
        .output()
        .map_err(|e| e.to_string())?;

    if !rm_out.status.success() {
        // Folder may already be gone — prune stale entries and continue
        let _ = std::process::Command::new("git")
            .args(["worktree", "prune"])
            .current_dir(cwd)
            .output();
    }

    // 2. Delete the branch
    let flag = if safe_delete { "-d" } else { "-D" };
    let br_out = std::process::Command::new("git")
        .args(["branch", flag, &branch])
        .current_dir(cwd)
        .output()
        .map_err(|e| e.to_string())?;

    if !br_out.status.success() {
        eprintln!(
            "[git] branch delete warning: {}",
            String::from_utf8_lossy(&br_out.stderr)
        );
    }

    eprintln!("[git] worktree deleted: {wt_str}, branch: {branch}");
    Ok(())
}

/// List all stackbox worktrees for a given workspace (cwd).
/// Returns only worktrees whose folder name starts with "stackbox-wt-".
pub fn list_worktrees(cwd: &str) -> Vec<WorktreeEntry> {
    let out = std::process::Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .current_dir(cwd)
        .output();

    let Ok(out) = out else { return vec![] };
    if !out.status.success() { return vec![]; }

    let text = String::from_utf8_lossy(&out.stdout);
    let mut entries: Vec<WorktreeEntry> = Vec::new();
    let mut path   = String::new();
    let mut branch = String::new();
    let mut head   = String::new();

    for line in text.lines() {
        if line.is_empty() {
            if !path.is_empty() {
                let folder = Path::new(&path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("");
                if folder.starts_with("stackbox-wt-") {
                    entries.push(WorktreeEntry {
                        path: path.clone(),
                        branch: branch.clone(),
                        head: head.clone(),
                    });
                }
                path.clear(); branch.clear(); head.clear();
            }
        } else if let Some(v) = line.strip_prefix("worktree ")          { path   = v.to_string(); }
          else if let Some(v) = line.strip_prefix("HEAD ")              { head   = v.to_string(); }
          else if let Some(v) = line.strip_prefix("branch refs/heads/") { branch = v.to_string(); }
    }

    // flush last entry
    if !path.is_empty() {
        let folder = Path::new(&path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        if folder.starts_with("stackbox-wt-") {
            entries.push(WorktreeEntry { path, branch, head });
        }
    }

    entries
}

#[derive(Debug, serde::Serialize)]
pub struct WorktreeEntry {
    pub path:   String,
    pub branch: String,
    pub head:   String,
}