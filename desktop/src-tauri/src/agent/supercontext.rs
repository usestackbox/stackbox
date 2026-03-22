// src-tauri/src/agent/supercontext.rs
// Supercontext V2 — git ingest + auto session summary + 6-type classification.

use crate::{memory, git::log::log_for_runbox};

// ── Git cold ingest ───────────────────────────────────────────────────────────

pub async fn git_cold_ingest(runbox_id: &str, cwd: &str) {
    match memory::memories_by_tag(runbox_id, "git-history").await {
        Ok(existing) if !existing.is_empty() => return,
        _ => {}
    }

    ingest_file_ownership(runbox_id, cwd).await;

    let commits = match log_for_runbox(cwd, runbox_id) {
        Ok(c) => c,
        Err(e) => { eprintln!("[supercontext] git log failed: {e}"); return; }
    };
    if commits.is_empty() { return; }

    eprintln!("[supercontext] ingesting {} commits for {runbox_id}", commits.len());

    for commit in &commits {
        let msg = commit.message.trim();
        if msg.is_empty() { continue; }
        let lower = msg.to_lowercase();
        if lower == "initial commit" || lower == "init" || lower == "wip" { continue; }

        let commit_type = if lower.starts_with("feat") || lower.starts_with("add") { "checkpoint" }
            else { "memory" };

        let content = format!(
            "[git] {msg} ({}  by {})",
            &commit.date[..10.min(commit.date.len())],
            commit.author.split('<').next().unwrap_or(&commit.author).trim()
        );

        let _ = memory::memory_add_typed(
            runbox_id, "git-ingest", &content,
            "main", commit_type, "git-history,git",
            &commit.hash, "git",
            memory::MT_GIT, memory::importance_for_type(memory::MT_GIT), false,
            memory::decay_for_type(memory::MT_GIT),
            memory::SCOPE_LOCAL, "git",
        ).await;
    }

    crate::agent::globals::emit_memory_added(runbox_id);
}

async fn ingest_file_ownership(runbox_id: &str, cwd: &str) {
    use crate::git::repo::git;
    let shortlog = match git(&["shortlog", "-sn", "--no-merges", "-20"], cwd, None) {
        Ok(s) => s, Err(_) => return,
    };
    if shortlog.trim().is_empty() { return; }
    let summary = format!("[git] Top contributors: {}",
        shortlog.lines().filter_map(|l| {
            let t = l.trim();
            if let Some(p) = t.find(|c: char| c.is_whitespace()) {
                let count = t[..p].trim(); let name = t[p..].trim();
                if !name.is_empty() { Some(format!("{} ({})", name, count)) } else { None }
            } else { None }
        }).take(5).collect::<Vec<_>>().join(", ")
    );
    let _ = memory::memory_add_typed(
        runbox_id, "git-ingest", &summary,
        "main", "memory", "git-history,git-ownership,git",
        "", "git",
        memory::MT_GIT, 40, false,
        memory::decay_for_type(memory::MT_GIT),
        memory::SCOPE_LOCAL, "git",
    ).await;
}

// ── Auto session summary fallback ─────────────────────────────────────────────
// Called on session-end Tauri event if agent didn't write a session summary.
// Generates weak-signal summary from recent workspace events.
// Agent-written summary always takes priority.

pub async fn auto_session_summary(
    runbox_id:  &str,
    session_id: &str,
    agent_name: &str,
    db:         &crate::db::Db,
) {
    // Skip if agent already wrote a session summary this session
    let existing = memory::memories_for_runbox(runbox_id).await.unwrap_or_default();
    let has_session_summary = existing.iter().any(|m| {
        m.effective_type() == memory::MT_SESSION && m.session_id == session_id
    });
    if has_session_summary { return; }

    // Build from last 20 workspace events
    let events = crate::db::events::events_recent(db, runbox_id, 20)
        .unwrap_or_default();
    if events.is_empty() { return; }

    let mut lines: Vec<String> = Vec::new();
    let mut files_changed: Vec<String> = Vec::new();
    let mut commands_run:  Vec<String> = Vec::new();

    for evt in &events {
        match evt.event_type.as_str() {
            "FileChanged" => {
                if let Ok(p) = serde_json::from_str::<serde_json::Value>(&evt.payload_json) {
                    if let Some(path) = p.get("path").and_then(|v| v.as_str()) {
                        files_changed.push(path.to_string());
                    }
                }
            }
            "CommandExecuted" => {
                if let Ok(p) = serde_json::from_str::<serde_json::Value>(&evt.payload_json) {
                    if let Some(cmd) = p.get("command").and_then(|v| v.as_str()) {
                        let cmd_short: String = cmd.chars().take(60).collect();
                        commands_run.push(cmd_short);
                    }
                }
            }
            _ => {}
        }
    }

    files_changed.dedup(); commands_run.dedup();

    if !files_changed.is_empty() {
        let sample: Vec<_> = files_changed.iter().take(5).collect();
        lines.push(format!("Files changed: {}", sample.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ")));
    }
    if !commands_run.is_empty() {
        let sample: Vec<_> = commands_run.iter().take(3).collect();
        lines.push(format!("Commands run: {}", sample.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(" · ")));
    }
    lines.push("[auto-generated — agent session summary not written]".to_string());

    if lines.is_empty() { return; }

    let content = lines.join("\n");
    let agent_type = memory::agent_type_from_name(agent_name);

    let _ = memory::memory_add_typed(
        runbox_id, session_id, &content,
        "main", "memory", "session,auto-summary",
        "", agent_name,
        memory::MT_SESSION, 60, false, // lower importance — auto-generated
        memory::decay_for_type(memory::MT_SESSION),
        memory::SCOPE_LOCAL, &agent_type,
    ).await;

    crate::agent::globals::emit_memory_added(runbox_id);
    eprintln!("[supercontext] auto session summary written for {session_id}");
}

// ── Conflict checker (V1 compat) ──────────────────────────────────────────────

pub async fn conflict_tag(runbox_id: &str, content: &str) -> String {
    let existing = match memory::memories_for_runbox(runbox_id).await {
        Ok(m) => m, Err(_) => return String::new(),
    };
    if existing.is_empty() { return String::new(); }
    let new_words = word_set(content);
    if new_words.len() < 4 { return String::new(); }
    for mem in existing.iter().take(50) {
        let ratio = content.len() as f64 / mem.content.len().max(1) as f64;
        if ratio < 0.25 || ratio > 4.0 { continue; }
        let old_words = word_set(&mem.content);
        let overlap   = new_words.intersection(&old_words).count();
        let sim = overlap as f64 / new_words.len().max(old_words.len()) as f64;
        if sim > 0.60 { return "conflict:possible".to_string(); }
    }
    String::new()
}

fn word_set(s: &str) -> std::collections::HashSet<String> {
    s.split_whitespace()
        .map(|w| w.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect::<String>())
        .filter(|w| w.len() >= 3)
        .collect()
}

// ── Save classified (called from pty/detection.rs) ────────────────────────────

pub async fn save_classified(
    runbox_id:  &str,
    session_id: &str,
    agent_name: &str,
    kind:       &str, // "failure" | "blocker" | "environment" | "codebase" | "goal" | "session" | "decision"
    content:    &str,
) {
    // decision folds into failure
    let memory_type = match kind {
        "decision"    => memory::MT_FAILURE,
        "preference"  => memory::MT_ENVIRONMENT,
        "failure"     => memory::MT_FAILURE,
        "blocker"     => memory::MT_BLOCKER,
        "environment" => memory::MT_ENVIRONMENT,
        "codebase"    => memory::MT_CODEBASE,
        "goal"        => memory::MT_GOAL,
        "session"     => memory::MT_SESSION,
        _             => memory::MT_GENERAL,
    };

    let importance = memory::importance_for_type(memory_type);
    let decay_at   = memory::decay_for_type(memory_type);
    let agent_type = memory::agent_type_from_name(agent_name);

    // Conflict check for general/failure types
    let mut tags = memory_type.to_string();
    if memory_type == memory::MT_FAILURE || memory_type == memory::MT_GENERAL {
        let extra = conflict_tag(runbox_id, content).await;
        if !extra.is_empty() { tags.push(','); tags.push_str(&extra); }
    }

    match memory::memory_add_typed(
        runbox_id, session_id, content,
        "main", "memory", &tags, "", agent_name,
        memory_type, importance, false, decay_at,
        memory::SCOPE_LOCAL, &agent_type,
    ).await {
        Ok(_) => {
            crate::agent::globals::emit_memory_added(runbox_id);
            if memory_type == memory::MT_FAILURE || memory_type == memory::MT_BLOCKER {
                crate::agent::globals::emit_event(
                    "supercontext:failure",
                    serde_json::json!({ "runbox_id": runbox_id, "content": content, "type": memory_type }),
                );
            }
            // Invalidate injector cache on new write
            let rb = runbox_id.to_string();
            tauri::async_runtime::spawn(async move {
                crate::agent::injector::invalidate_cache(&rb).await;
            });
        }
        Err(e) => eprintln!("[supercontext] save_classified failed: {e}"),
    }
}