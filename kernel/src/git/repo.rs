// src/git/repo.rs
//
// Git repository and worktree management.
//
// DESIGN:
//   Worktree = temporary workspace, lives inside {cwd}/.worktrees/{name}
//   Branch   = permanent record, survives after worktree is removed
//
//   Worktree name: stackbox-wt-{runbox_short}-{session_short}-{slug}
//   Branch name:   stackbox/{runbox_short}/{slug}
//
//   remove_worktree_only() removes the worktree directory but KEEPS the branch.
//   The branch is deleted only when the user explicitly merges or deletes it.

use std::path::Path;

// ─────────────────────────────────────────────────────────────────────────────
// Git directory helpers
// ─────────────────────────────────────────────────────────────────────────────

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

    let _ = std::process::Command::new("git")
        .args(["commit", "--allow-empty", "-m", "stackbox: init"])
        .current_dir(cwd)
        .output();

    eprintln!("[git] real repo initialised at {cwd}");
    Ok(())
}

/// Returns true if the `.git` file at `path` is a stale worktree pointer
/// (i.e. the gitdir it references no longer exists on disk).
fn is_stale_worktree_pointer(dot_git: &Path) -> bool {
    let Ok(content) = std::fs::read_to_string(dot_git) else { return false };
    let Some(gitdir) = content.trim().strip_prefix("gitdir:") else { return false };
    !Path::new(gitdir.trim()).exists()
}

pub fn ensure_git_repo(cwd: &str, runbox_id: &str) -> Result<String, String> {
    let dot_git = Path::new(cwd).join(".git");

    if dot_git.is_dir() {
        return Ok(dot_git.to_string_lossy().to_string());
    }

    if dot_git.is_file() {
        if is_stale_worktree_pointer(&dot_git) {
            eprintln!("[git] removing stale worktree pointer at {}", dot_git.display());
            let _ = std::fs::remove_file(&dot_git);
        } else {
            return Ok(dot_git.to_string_lossy().to_string());
        }
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

fn agent_slug(agent_kind: &str) -> String {
    agent_kind
        .to_lowercase()
        .replace(' ', "-")
        .replace('_', "-")
}

#[derive(Debug, Clone)]
pub struct WorktreeInfo {
    pub path:   String,
    pub branch: String,
    pub is_new: bool,
}

/// Ensure .worktrees/ is in .gitignore so git doesn't track runtime directories.
fn ensure_worktrees_gitignored(cwd: &str) {
    let gi = Path::new(cwd).join(".gitignore");
    let content = std::fs::read_to_string(&gi).unwrap_or_default();
    if !content.contains(".worktrees/") {
        let separator = if content.ends_with('\n') || content.is_empty() { "" } else { "\n" };
        let _ = std::fs::write(&gi, format!("{content}{separator}.worktrees/\n"));
        eprintln!("[git] added .worktrees/ to .gitignore");
    }
}

/// Create (or reattach) a git worktree for an agent session.
///
/// Worktree location: {cwd}/.worktrees/stackbox-wt-{runbox_short}-{session_short}-{slug}
/// Branch:            stackbox/{runbox_short}/{slug}  ← persists after worktree removed
///
/// session_id makes the worktree name unique per session — if the same agent runs
/// twice on the same runbox the names never collide.
pub fn ensure_worktree(
    cwd:        &str,
    runbox_id:  &str,
    session_id: &str,
    agent_kind: &str,
) -> Option<WorktreeInfo> {
    if !Path::new(cwd).join(".git").is_dir() {
        eprintln!("[git] no real .git at {cwd} — skipping worktree creation");
        return None;
    }

    let runbox_short  = &runbox_id[..runbox_id.len().min(8)];
    let session_short = &session_id[..session_id.len().min(6)];
    let slug          = agent_slug(agent_kind);

    // Branch is permanent — one per runbox+slug combo.
    let branch  = format!("stackbox/{runbox_short}/{slug}");
    // Worktree is per-session — dies when the PTY exits.
    let wt_name = format!("stackbox-wt-{runbox_short}-{session_short}-{slug}");

    let wt_dir  = Path::new(cwd).join(".worktrees");
    std::fs::create_dir_all(&wt_dir).ok();
    ensure_worktrees_gitignored(cwd);

    let wt_path = wt_dir.join(&wt_name);
    let wt_str  = wt_path.to_str()?.to_string();

    if wt_path.exists() {
        // Crash recovery — same session reattaching after unexpected exit.
        eprintln!("[git] worktree already exists (crash recovery): {wt_str}");
        return Some(WorktreeInfo { path: wt_str, branch, is_new: false });
    }

    // Try: create branch + worktree together.
    let out = std::process::Command::new("git")
        .args(["worktree", "add", "-b", &branch, &wt_str, "HEAD"])
        .current_dir(cwd)
        .output()
        .ok()?;

    if out.status.success() {
        eprintln!("[git] worktree created: {wt_str} on new branch {branch}");
        return Some(WorktreeInfo { path: wt_str, branch, is_new: true });
    }

    // Branch already exists from a previous session — reattach worktree to it.
    let out2 = std::process::Command::new("git")
        .args(["worktree", "add", &wt_str, &branch])
        .current_dir(cwd)
        .output()
        .ok()?;

    if out2.status.success() {
        eprintln!("[git] worktree reattached to existing branch: {wt_str} → {branch}");
        return Some(WorktreeInfo { path: wt_str, branch, is_new: false });
    }

    eprintln!(
        "[git] worktree add failed: {}",
        String::from_utf8_lossy(&out2.stderr).trim()
    );
    None
}

/// Find the worktree path if it already exists on disk.
/// Used for lightweight queries when we don't want to create.
pub fn get_worktree_if_exists(
    cwd:        &str,
    runbox_id:  &str,
    session_id: &str,
    agent_kind: &str,
) -> Option<String> {
    let runbox_short  = &runbox_id[..runbox_id.len().min(8)];
    let session_short = &session_id[..session_id.len().min(6)];
    let slug          = agent_slug(agent_kind);
    let wt_name       = format!("stackbox-wt-{runbox_short}-{session_short}-{slug}");
    let wt_path       = Path::new(cwd).join(".worktrees").join(&wt_name);
    if wt_path.exists() {
        wt_path.to_str().map(str::to_string)
    } else {
        None
    }
}

/// Find the main git repository root from inside a worktree.
fn main_repo_for_worktree(wt_path: &str) -> std::path::PathBuf {
    let dot_git = Path::new(wt_path).join(".git");
    if let Ok(content) = std::fs::read_to_string(&dot_git) {
        if let Some(gitdir_line) = content.trim().strip_prefix("gitdir:") {
            let gitdir = Path::new(gitdir_line.trim());
            // gitdir → /main/.git/worktrees/name  →  parent×2 = /main/.git  →  parent×3 = /main
            if let Some(main_git) = gitdir.parent().and_then(|p| p.parent()) {
                if let Some(main_root) = main_git.parent() {
                    if main_root.is_dir() {
                        return main_root.to_path_buf();
                    }
                }
            }
        }
    }
    // Fallback: parent of the .worktrees/ directory
    Path::new(wt_path)
        .parent()  // .worktrees/
        .and_then(|p| p.parent())  // project root
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from("."))
}

/// Remove the worktree directory ONLY — the branch is kept intact.
/// Call this when a PTY session ends (natural exit or user kill).
/// The branch lives until the user explicitly merges or deletes it.
pub fn remove_worktree_only(wt_path: &str) {
    if !Path::new(wt_path).exists() { return; }

    let repo_root = main_repo_for_worktree(wt_path);

    let _ = std::process::Command::new("git")
        .args(["worktree", "remove", "--force", wt_path])
        .current_dir(&repo_root)
        .output();

    let _ = std::process::Command::new("git")
        .args(["worktree", "prune"])
        .current_dir(&repo_root)
        .output();

    eprintln!("[git] worktree removed (branch kept): {wt_path}");
}

/// Remove worktree AND delete the branch. Used for hard cancel / cleanup.
/// Prefer remove_worktree_only() in normal session-end flow.
pub fn remove_worktree(wt_path: &str) {
    remove_worktree_only(wt_path);
    // Branch deletion is handled explicitly by commands when user requests it.
    eprintln!("[git] worktree removed: {wt_path}");
}

/// Delete a branch that has been merged or is no longer needed.
pub fn delete_branch(cwd: &str, branch: &str, force: bool) -> Result<(), String> {
    if !branch.starts_with("stackbox/") {
        return Err(format!("can only delete stackbox/* branches, got: {branch}"));
    }
    let flag = if force { "-D" } else { "-d" };
    let out = std::process::Command::new("git")
        .args(["branch", flag, branch])
        .current_dir(cwd)
        .output()
        .map_err(|e| e.to_string())?;

    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    eprintln!("[git] branch deleted: {branch}");
    Ok(())
}

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