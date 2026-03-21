// src-tauri/src/agent/supercontext.rs
//
// Supercontext V1 — Git cold ingest + conflict checker.
//
// Git cold ingest:
//   On first spawn for a runbox, reads git log and writes each commit
//   as an episodic memory tagged agent_name="git". Subsequent spawns
//   are skipped — we only ingest once per runbox.
//
// Conflict checker:
//   Before writing any auto-memory, checks existing memories for
//   high word-overlap. If found, tags the new memory "conflict:possible"
//   so the user can review it in the panel.

use crate::{memory, git::log::log_for_runbox};

// ── Git Cold Ingest ───────────────────────────────────────────────────────────

/// Ingest the git log for a runbox into memory. Idempotent — checks first.
pub async fn git_cold_ingest(runbox_id: &str, cwd: &str) {
    // Check if we've already ingested for this runbox
    match memory::memories_by_tag(runbox_id, "git-history").await {
        Ok(existing) if !existing.is_empty() => {
            eprintln!("[supercontext] git ingest already done for {runbox_id}, skipping");
            return;
        }
        _ => {}
    }

    let commits = match log_for_runbox(cwd, runbox_id) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[supercontext] git log failed for {cwd}: {e}");
            return;
        }
    };

    if commits.is_empty() {
        eprintln!("[supercontext] no commits found in {cwd}");
        return;
    }

    eprintln!("[supercontext] ingesting {} commits for {runbox_id}", commits.len());

    // Classify commits by message patterns
    for commit in &commits {
        let msg   = commit.message.trim();
        if msg.is_empty() { continue; }

        let lower = msg.to_lowercase();

        // Skip noise commits
        if lower == "initial commit" || lower == "init" || lower == "wip" { continue; }

        // Detect commit type from message
        let commit_type = if lower.starts_with("fix") || lower.contains("revert") || lower.contains("bug") {
            "memory"  // failures / fixes
        } else if lower.starts_with("feat") || lower.starts_with("add") || lower.contains("implement") {
            "checkpoint"
        } else if lower.starts_with("refactor") || lower.starts_with("chore") || lower.starts_with("docs") {
            "memory"
        } else {
            "memory"
        };

        let content = format!(
            "[git] {msg} ({}  by {})",
            &commit.date[..10.min(commit.date.len())],
            commit.author.split('<').next().unwrap_or(&commit.author).trim()
        );

        let _ = memory::memory_add_full(
            runbox_id,
            "git-ingest",
            &content,
            "main",
            commit_type,
            "git-history",
            &commit.hash,  // parent_id = commit hash for traceability
            "git",
        ).await;
    }

    eprintln!("[supercontext] git ingest complete for {runbox_id}");
    crate::agent::globals::emit_memory_added(runbox_id);
}

// ── Conflict Checker ──────────────────────────────────────────────────────────

/// Check if content conflicts with existing memories.
/// Returns a tag string to append — empty if no conflict detected.
pub async fn conflict_tag(runbox_id: &str, content: &str) -> String {
    let existing = match memory::memories_for_runbox(runbox_id).await {
        Ok(mems) => mems,
        Err(_)   => return String::new(),
    };

    // Skip if too few memories to compare
    if existing.is_empty() { return String::new(); }

    let new_words = word_set(content);
    if new_words.len() < 4 { return String::new(); }

    for mem in existing.iter().take(50) {
        // Only check similar-length memories (±3x)
        let ratio = content.len() as f64 / mem.content.len().max(1) as f64;
        if ratio < 0.25 || ratio > 4.0 { continue; }

        let old_words = word_set(&mem.content);
        let overlap   = new_words.intersection(&old_words).count();
        let similarity = overlap as f64 / new_words.len().max(old_words.len()) as f64;

        // High overlap (>60%) = possible duplicate
        if similarity > 0.60 {
            eprintln!("[supercontext] conflict detected ({:.0}% overlap) with memory {}", similarity * 100.0, &mem.id[..8.min(mem.id.len())]);
            return "conflict:possible".to_string();
        }
    }

    String::new()
}

fn word_set(s: &str) -> std::collections::HashSet<String> {
    s.split_whitespace()
        .map(|w| w.to_lowercase()
            .chars()
            .filter(|c| c.is_alphanumeric())
            .collect::<String>())
        .filter(|w| w.len() >= 3)
        .collect()
}

// ── Auto-save classified memory ───────────────────────────────────────────────

pub async fn save_classified(
    runbox_id:  &str,
    session_id: &str,
    agent_name: &str,
    kind:       &str,    // "decision" | "failure" | "preference"
    content:    &str,
) {
    // Build tags: kind + conflict check
    let mut tags = kind.to_string();
    let extra = conflict_tag(runbox_id, content).await;
    if !extra.is_empty() {
        tags.push(',');
        tags.push_str(&extra);
    }

    let commit_type = match kind {
        "failure"    => "memory",
        "decision"   => "checkpoint",
        "preference" => "memory",
        _            => "memory",
    };

    match memory::memory_add_full(
        runbox_id,
        session_id,
        content,
        "main",
        commit_type,
        &tags,
        "",
        agent_name,
    ).await {
        Ok(_) => {
            crate::agent::globals::emit_memory_added(runbox_id);
            // Broadcast failures cross-pane
            if kind == "failure" {
                crate::agent::globals::emit_event(
                    "supercontext:failure",
                    serde_json::json!({
                        "runbox_id": runbox_id,
                        "content":   content,
                    }),
                );
            }
        }
        Err(e) => eprintln!("[supercontext] save_classified failed: {e}"),
    }
}