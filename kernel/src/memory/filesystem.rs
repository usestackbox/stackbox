// src-tauri/src/memory/filesystem.rs
//
// GCC + Letta integration — flat file memory layout at {cwd}/memory/
//
// Every remember() call syncs in-memory state to /memory/ in the RunBox
// filesystem and auto-commits via git. Humans and agents can `cat /memory/`
// directly — no MCP tool or API call needed.
//
// Layout:
//   {cwd}/memory/
//     structured.toml    ← PREFERRED memories (key = "value")
//     locked.toml        ← LOCKED rules (priority-ranked)
//     main.md            ← GCC global roadmap (milestones + goals)
//     metadata.yaml      ← project architecture (written on spawn)
//     sessions/          ← SESSION summaries as {agent}-{ts}.md
//     insights/          ← long PREFERRED facts as {key}.md
//     .git/              ← full history of every memory change
//
// Rules:
//   - sync_to_fs() is always fast (file writes only, no LanceDB calls)
//   - commit_memory_async() fires in a background thread — never blocks
//   - ensure_memory_repo() is idempotent — safe to call on every spawn
//   - write_metadata_yaml() is called from workspace::context on spawn
//   - write_main_md() is called when user sets a goal or hits a milestone

use crate::memory::{Memory, LEVEL_LOCKED, LEVEL_PREFERRED, LEVEL_SESSION};
use std::path::{Path, PathBuf};

// ── Path helpers ──────────────────────────────────────────────────────────────

/// Root /memory/ directory for a RunBox workspace.
pub fn memory_dir(cwd: &str) -> PathBuf {
    Path::new(cwd).join("memory")
}

// ── Repo init ─────────────────────────────────────────────────────────────────

/// Ensure /memory/ exists with a git repo inside.
/// Idempotent — safe to call on every agent spawn.
pub fn ensure_memory_repo(cwd: &str) -> Result<(), String> {
    let dir = memory_dir(cwd);
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir memory: {e}"))?;

    // Already initialised
    if dir.join(".git").exists() {
        return Ok(());
    }

    let out = std::process::Command::new("git")
        .args(["init"])
        .current_dir(&dir)
        .output()
        .map_err(|e| format!("git init: {e}"))?;

    if !out.status.success() {
        return Err(format!(
            "git init failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }

    // .gitignore — exclude the sentinel file from history
    std::fs::write(dir.join(".gitignore"), ".last_defrag\n").ok();

    // README so the repo has a real initial commit
    std::fs::write(
        dir.join("README.md"),
        "# Memory\n\nManaged by Stackbox. Every change is a git commit.\n",
    )
    .map_err(|e| format!("write README: {e}"))?;

    let _ = std::process::Command::new("git")
        .args(["add", "-A"])
        .current_dir(&dir)
        .output();

    let _ = std::process::Command::new("git")
        .args(["commit", "-m", "stackbox: init memory repo"])
        .current_dir(&dir)
        .env("GIT_AUTHOR_NAME", "Stackbox")
        .env("GIT_AUTHOR_EMAIL", "memory@stackbox.local")
        .env("GIT_COMMITTER_NAME", "Stackbox")
        .env("GIT_COMMITTER_EMAIL", "memory@stackbox.local")
        .output();

    eprintln!("[memory::fs] init memory repo at {}", dir.display());
    Ok(())
}

// ── Flat file sync ─────────────────────────────────────────────────────────────

/// Sync a snapshot of all memories for a runbox to flat files in /memory/.
/// Called after every remember() write. Purely additive file writes — fast.
pub async fn sync_to_fs(runbox_id: &str, cwd: &str, memories: &[Memory]) {
    if cwd.is_empty() {
        return;
    }
    let dir = memory_dir(cwd);
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }

    // ── Build all content strings on the async side (no blocking) ────────────

    // ── structured.toml — PREFERRED key=value facts ───────────────────────────
    let structured_toml = {
        let preferred: Vec<_> = memories
            .iter()
            .filter(|m| m.effective_level() == LEVEL_PREFERRED && m.is_active() && !m.resolved)
            .collect();

        let mut key_map: std::collections::BTreeMap<String, (i64, String)> =
            std::collections::BTreeMap::new();
        for m in &preferred {
            let k = if m.key.is_empty() {
                crate::memory::extract_key(&m.content)
            } else {
                m.key.clone()
            };
            let entry = key_map.entry(k).or_insert((0, String::new()));
            if m.timestamp > entry.0 {
                *entry = (m.timestamp, m.content.trim().to_string());
            }
        }

        let mut toml = String::from(
            "# Stackbox structured facts\n\
             # Auto-generated — agents and humans may edit this file\n\
             # Key-versioned: writing a new value for an existing key replaces it\n\n",
        );
        for (k, (_, v)) in &key_map {
            let v_clean = v.replace('\\', "\\\\").replace('"', "\\\"");
            toml.push_str(&format!("{k} = \"{v_clean}\"\n"));
        }
        toml
    };

    // ── locked.toml — LOCKED rules, priority-ranked ───────────────────────────
    let locked_toml = {
        let mut locked: Vec<_> = memories
            .iter()
            .filter(|m| m.effective_level() == LEVEL_LOCKED && !m.resolved)
            .collect();
        locked.sort_by(|a, b| b.importance.cmp(&a.importance));

        let mut toml = String::from(
            "# LOCKED rules — never violate these\n\
             # Set by the user only. Agents must obey unconditionally.\n\n",
        );
        for (i, l) in locked.iter().enumerate() {
            let v = l.content.trim().replace('\\', "\\\\").replace('"', "\\\"");
            toml.push_str(&format!("rule_{i} = \"{v}\"\n"));
        }
        toml
    };

    // ── sessions/ content ─────────────────────────────────────────────────────
    let session_files: Vec<(String, String)> = memories
        .iter()
        .filter(|m| m.effective_level() == LEVEL_SESSION && !m.resolved)
        .map(|s| {
            let agent_type = s.agent_id.split(':').next().unwrap_or("agent");
            let ts = s.timestamp;
            let filename = format!("{agent_type}-{ts}.md");
            let content = format!(
                "# Session Summary\n\nagent: {}\nrunbox: {}\ntime: {} ({})\n\n{}\n",
                agent_type,
                runbox_id,
                ts,
                s.age_label(),
                s.content.trim()
            );
            (filename, content)
        })
        .collect();

    // ── insights/ content ─────────────────────────────────────────────────────
    let insight_files: Vec<(String, String)> = memories
        .iter()
        .filter(|m| {
            m.effective_level() == LEVEL_PREFERRED
                && m.is_active()
                && !m.resolved
                && m.content.len() > 80
        })
        .map(|m| {
            let k = if m.key.is_empty() {
                crate::memory::extract_key(&m.content)
            } else {
                m.key.clone()
            };
            let filename = format!("{k}.md");
            let content = format!(
                "# {k}\n\nagent: {}\ntime: {}\n\n{}\n",
                m.agent_name,
                m.age_label(),
                m.content.trim()
            );
            (filename, content)
        })
        .collect();

    // ── Flush to disk off the executor thread ─────────────────────────────────
    tokio::task::spawn_blocking(move || {
        let _ = std::fs::write(dir.join("structured.toml"), structured_toml);
        let _ = std::fs::write(dir.join("locked.toml"), locked_toml);

        // sessions/
        let sessions_dir = dir.join("sessions");
        std::fs::create_dir_all(&sessions_dir).ok();

        // Prune old session files beyond cap (keep 10)
        let mut existing: Vec<_> = std::fs::read_dir(&sessions_dir)
            .ok()
            .map(|rd| {
                rd.filter_map(|e| e.ok())
                    .filter(|e| e.path().extension().map(|x| x == "md").unwrap_or(false))
                    .collect()
            })
            .unwrap_or_default();
        existing.sort_by_key(|e: &std::fs::DirEntry| e.metadata().and_then(|m| m.modified()).ok());
        if existing.len() > 10 {
            for old in &existing[..existing.len() - 10] {
                std::fs::remove_file(old.path()).ok();
            }
        }

        for (filename, content) in session_files {
            let path = sessions_dir.join(&filename);
            if !path.exists() {
                let _ = std::fs::write(path, content);
            }
        }

        // insights/
        let insights_dir = dir.join("insights");
        std::fs::create_dir_all(&insights_dir).ok();
        for (filename, content) in insight_files {
            let _ = std::fs::write(insights_dir.join(filename), content);
        }
    });
}

// ── Git commit ─────────────────────────────────────────────────────────────────

/// Stage all changes in /memory/ and commit with an auto-generated message.
/// Fires in a background thread — never blocks the caller.
/// Message convention: "{agent_name}: {content_preview}"
pub fn commit_memory_async(cwd: &str, message: String) {
    if cwd.is_empty() {
        return;
    }
    let dir = memory_dir(cwd);

    // Lazy init — ensures the repo exists before committing
    if !dir.join(".git").exists() {
        if ensure_memory_repo(cwd).is_err() {
            return;
        }
    }

    std::thread::spawn(move || {
        // Only commit if there's actually something staged
        let status = std::process::Command::new("git")
            .args(["status", "--porcelain"])
            .current_dir(&dir)
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default();

        if status.is_empty() {
            return;
        }

        let _ = std::process::Command::new("git")
            .args(["add", "-A"])
            .current_dir(&dir)
            .output();

        let msg = if message.len() > 72 {
            format!("{}…", &message[..71])
        } else {
            message.clone()
        };

        let result = std::process::Command::new("git")
            .args(["commit", "-m", &msg])
            .current_dir(&dir)
            .env("GIT_AUTHOR_NAME", "Stackbox")
            .env("GIT_AUTHOR_EMAIL", "memory@stackbox.local")
            .env("GIT_COMMITTER_NAME", "Stackbox")
            .env("GIT_COMMITTER_EMAIL", "memory@stackbox.local")
            .output();

        match result {
            Ok(o) if o.status.success() => {
                eprintln!("[memory::fs] commit: {msg}");
            }
            Ok(o) => {
                let err = String::from_utf8_lossy(&o.stderr).trim().to_string();
                if !err.contains("nothing to commit") {
                    eprintln!("[memory::fs] commit failed: {err}");
                }
            }
            Err(e) => eprintln!("[memory::fs] commit error: {e}"),
        }
    });
}

// ── main.md — GCC global roadmap ──────────────────────────────────────────────

/// Write/update main.md — the global project roadmap shared across all agents.
/// Called on COMMIT (milestone reached) or when user sets a new goal via LOCKED.
pub fn write_main_md(cwd: &str, content: &str) -> Result<(), String> {
    let dir = memory_dir(cwd);
    std::fs::create_dir_all(&dir).ok();

    let full = format!(
        "# Project Roadmap\n\n\
         _Managed by Stackbox. Edit freely — all agents read this file._\n\n\
         {}\n",
        content.trim()
    );
    std::fs::write(dir.join("main.md"), &full).map_err(|e| format!("write main.md: {e}"))
}

/// Read main.md. Returns empty string if the file doesn't exist yet.
pub fn read_main_md(cwd: &str) -> String {
    std::fs::read_to_string(memory_dir(cwd).join("main.md")).unwrap_or_default()
}

// ── metadata.yaml — GCC project architecture ──────────────────────────────────

/// Write metadata.yaml — file responsibilities, dep graph, module interfaces,
/// env config, arch decisions.
/// Called from workspace::context::build() on every agent spawn.
pub fn write_metadata_yaml(cwd: &str, content: &str) -> Result<(), String> {
    let dir = memory_dir(cwd);
    std::fs::create_dir_all(&dir).ok();
    std::fs::write(dir.join("metadata.yaml"), content)
        .map_err(|e| format!("write metadata.yaml: {e}"))
}

/// Read metadata.yaml. Returns empty string if not present.
pub fn read_metadata_yaml(cwd: &str) -> String {
    std::fs::read_to_string(memory_dir(cwd).join("metadata.yaml")).unwrap_or_default()
}
