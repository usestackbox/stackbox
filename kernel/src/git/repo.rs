// src/git/repo.rs
//
// Git repository helpers.
// Worktree creation: agent calls git_ensure MCP → kernel runs git worktree add.
// Kernel only cleans up worktrees on session end.
//
// Worktree location (outside repo):  ~/calus/<hash>/.worktrees/<agent_kind>-<slug>/
// Branch:                            calus/<agent_kind>/<slug>

use std::path::Path;

// ── Path helpers ──────────────────────────────────────────────────────────────

pub fn expand_home(path: &str) -> String {
    if path == "~" {
        return dirs::home_dir()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or_else(|| path.to_string());
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest).to_string_lossy().to_string();
        }
    }
    path.to_string()
}

// ── Git directory helpers ─────────────────────────────────────────────────────

pub fn git_dir_for(cwd: &str, runbox_id: &str) -> String {
    let dot_git = Path::new(cwd).join(".git");
    if dot_git.exists() {
        return dot_git.to_string_lossy().to_string();
    }
    dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("calus")
        .join("git")
        .join(runbox_id)
        .to_string_lossy()
        .to_string()
}

pub fn git_dir_opt(cwd: &str, runbox_id: &str) -> Option<String> {
    let dot_git = Path::new(cwd).join(".git");
    if dot_git.is_dir() { return None; }
    if dot_git.is_file() { return None; }
    let shadow = git_dir_for(cwd, runbox_id);
    if Path::new(&shadow).exists() { Some(shadow) } else { None }
}

pub fn has_git(cwd: &str, runbox_id: &str) -> bool {
    Path::new(cwd).join(".git").exists() || Path::new(&git_dir_for(cwd, runbox_id)).exists()
}

// ── Git command runner ────────────────────────────────────────────────────────

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

// ── Repo init ─────────────────────────────────────────────────────────────────

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
            .args(["config", "user.email", "calus@local"])
            .current_dir(cwd)
            .output();
        let _ = std::process::Command::new("git")
            .args(["config", "user.name", "Calus"])
            .current_dir(cwd)
            .output();
    }

    let _ = std::process::Command::new("git")
        .args(["commit", "--allow-empty", "-m", "calus: init"])
        .current_dir(cwd)
        .output();

    eprintln!("[git] repo init at {cwd}");
    Ok(())
}

fn is_stale_worktree_pointer(dot_git: &Path) -> bool {
    let Ok(content) = std::fs::read_to_string(dot_git) else { return false; };
    let Some(gitdir) = content.trim().strip_prefix("gitdir:") else { return false; };
    !Path::new(gitdir.trim()).exists()
}

pub fn ensure_git_repo(cwd: &str, runbox_id: &str) -> Result<String, String> {
    let dot_git = Path::new(cwd).join(".git");

    if dot_git.is_dir() {
        return Ok(dot_git.to_string_lossy().to_string());
    }

    if dot_git.is_file() {
        if is_stale_worktree_pointer(&dot_git) {
            eprintln!("[git] removing stale worktree pointer: {}", dot_git.display());
            let _ = std::fs::remove_file(&dot_git);
        } else {
            return Ok(dot_git.to_string_lossy().to_string());
        }
    }

    let shadow = git_dir_for(cwd, runbox_id);
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
    git(&["commit", "--allow-empty", "-m", "calus: initial snapshot"], cwd, Some(&shadow)).ok();

    eprintln!("[git] shadow repo at {shadow}");
    Ok(shadow)
}

// ── Worktree (agent creates via git_ensure MCP) ───────────────────────────────

fn main_repo_for_worktree(wt_path: &str) -> std::path::PathBuf {
    let dot_git = Path::new(wt_path).join(".git");
    if let Ok(content) = std::fs::read_to_string(&dot_git) {
        if let Some(gitdir_line) = content.trim().strip_prefix("gitdir:") {
            let gitdir = Path::new(gitdir_line.trim());
            if let Some(main_git) = gitdir.parent().and_then(|p| p.parent()) {
                if let Some(main_root) = main_git.parent() {
                    if main_root.is_dir() {
                        return main_root.to_path_buf();
                    }
                }
            }
        }
    }
    Path::new(wt_path)
        .ancestors()
        .skip(1)
        .find(|p| p.join(".git").is_dir())
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from("."))
}

#[derive(Debug, Clone)]
pub struct WorktreeResult {
    pub path: String,
    pub branch: String,
    pub is_new: bool,
}

/// Create (or locate) a git worktree for an agent.
///
/// Agent provides `name` — a short task slug e.g. "fix-null-crash".
/// Worktree dir:  ~/calus/<hash>/.worktrees/<agent_kind>-<name>/   (OUTSIDE repo)
/// Branch:        calus/<agent_kind>/<name>
///
/// Returns None if cwd has no git repo or creation fails.
/// Returns existing worktree with is_new=false if already created.
pub fn ensure_worktree(
    cwd: &str,
    _runbox_id: &str,
    name: &str,
    agent_kind: &str,
) -> Option<WorktreeResult> {
    let wt_dir_name = format!("{agent_kind}-{name}");
    let branch      = format!("calus/{agent_kind}/{name}");

    let wt_base = crate::workspace::persistent::worktrees_base(cwd);
    if let Err(e) = std::fs::create_dir_all(&wt_base) {
        eprintln!("[repo] create worktrees base: {e}");
        return None;
    }

    let wt_path = wt_base.join(&wt_dir_name);
    let wt_str  = wt_path.to_string_lossy().to_string();

    if wt_path.exists() {
        return Some(WorktreeResult { path: wt_str, branch, is_new: false });
    }

    // git worktree add -b <branch> <path> HEAD
    let out = std::process::Command::new("git")
        .args(["worktree", "add", "-b", &branch, &wt_str, "HEAD"])
        .current_dir(cwd)
        .output();

    match out {
        Ok(o) if o.status.success() => {
            eprintln!("[repo] worktree created: {wt_str} on {branch}");
            Some(WorktreeResult { path: wt_str, branch, is_new: true })
        }
        Ok(o) => {
            let err = String::from_utf8_lossy(&o.stderr);
            if err.contains("already exists") {
                let out2 = std::process::Command::new("git")
                    .args(["worktree", "add", &wt_str, &branch])
                    .current_dir(cwd)
                    .output();
                if out2.map(|o| o.status.success()).unwrap_or(false) {
                    eprintln!("[repo] worktree attached: {wt_str}");
                    return Some(WorktreeResult { path: wt_str, branch, is_new: false });
                }
            }
            eprintln!("[repo] worktree add failed: {err}");
            None
        }
        Err(e) => {
            eprintln!("[repo] worktree add exec: {e}");
            None
        }
    }
}

/// Remove worktree directory only — branch is kept for review/merge.
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

pub fn remove_worktree(wt_path: &str) {
    remove_worktree_only(wt_path);
}

/// Delete a calus/* branch after merge.
pub fn delete_branch(cwd: &str, branch: &str, force: bool) -> Result<(), String> {
    if !branch.starts_with("calus/") {
        return Err(format!("can only delete calus/* branches, got: {branch}"));
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

/// List all calus/* worktrees for this repo (filters by branch prefix).
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
            if !path.is_empty() && branch.starts_with("calus/") {
                entries.push(WorktreeEntry { path: path.clone(), branch: branch.clone(), head: head.clone() });
            }
            path.clear(); branch.clear(); head.clear();
        } else if let Some(v) = line.strip_prefix("worktree ") {
            path = v.to_string();
        } else if let Some(v) = line.strip_prefix("HEAD ") {
            head = v.to_string();
        } else if let Some(v) = line.strip_prefix("branch refs/heads/") {
            branch = v.to_string();
        }
    }
    if !path.is_empty() && branch.starts_with("calus/") {
        entries.push(WorktreeEntry { path, branch, head });
    }
    entries
}

#[derive(Debug, serde::Serialize)]
pub struct WorktreeEntry {
    pub path: String,
    pub branch: String,
    pub head: String,
}