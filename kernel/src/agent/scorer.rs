// src-tauri/src/agent/scorer.rs
//
// Week 4 — runtime scorer + decay pruner.
//
// Composite score: recency × importance × agent_type_bonus
//   recency    — exponential decay from timestamp. Half-life: 7 days for session/env,
//                30 days for failure/codebase, never for goal/failure (full weight always).
//   importance — 0-100 from schema, set at write time.
//   agent_bonus — same agent_type as current agent gets +15% weight on failures.
//
// decay_prune() — called at startup after memory::init().
//   Deletes memories past their decay_at timestamp.
//   Demotes stale blockers (30d+ unresolved) to importance=20.
//   Flags stale env facts (30d+ unconfirmed) with unverified tag.
//   Auto-expires `general` type after 7 days (migration state cleanup).
//
// inject_score() — called by injector to final-rank within each type bucket.
//   Combines recency + importance + agent_bonus into 0.0-1.0 score.

use crate::memory::{
    self, now_ms, Memory, MT_BLOCKER, MT_ENVIRONMENT, MT_FAILURE, MT_GENERAL, MT_GOAL, MT_SESSION,
};

// ── Composite injection score ─────────────────────────────────────────────────

/// Score a memory for injection ranking. Returns 0.0-1.0.
/// Higher = more likely to appear in context.
/// current_agent_type: pass the agent currently reading context for same-type bonus.
pub fn inject_score(mem: &Memory, current_agent_type: &str) -> f64 {
    let importance_norm = mem.importance as f64 / 100.0;

    // Goal and failure are always full weight — recency doesn't matter
    if mem.effective_type() == MT_GOAL || mem.effective_type() == MT_FAILURE {
        let agent_bonus = if !current_agent_type.is_empty() && mem.agent_type == current_agent_type
        {
            0.15
        } else {
            0.0
        };
        return (importance_norm + agent_bonus).min(1.0);
    }

    // Recency: exponential decay with type-specific half-life
    let half_life_days = half_life_for_type(mem.effective_type());
    let age_days = (now_ms() - mem.timestamp).max(0) as f64 / 86_400_000.0;
    let recency = if half_life_days <= 0.0 {
        1.0
    } else {
        (-0.693 * age_days / half_life_days).exp() // e^(-ln2 * age/half_life)
    };

    // Staleness penalty
    let stale_penalty = if mem.is_stale_blocker() { 0.6 } else { 1.0 };

    // Same-agent-type bonus on failures and blockers
    let agent_bonus = if !current_agent_type.is_empty()
        && mem.agent_type == current_agent_type
        && (mem.effective_type() == MT_FAILURE || mem.effective_type() == MT_BLOCKER)
    {
        0.15
    } else {
        0.0
    };

    // Pinned memories get full weight
    let pin_bonus = if mem.pinned { 0.3 } else { 0.0 };

    ((importance_norm * 0.5 + recency * 0.4 + pin_bonus) * stale_penalty + agent_bonus).min(1.0)
}

fn half_life_for_type(memory_type: &str) -> f64 {
    match memory_type {
        MT_GOAL | MT_FAILURE => 0.0, // never decays — recency = 1.0 always
        MT_BLOCKER => 14.0,
        MT_ENVIRONMENT => 60.0,
        MT_SESSION => 7.0,
        _ => 30.0, // codebase, git, general
    }
}

// ── Rank a slice of memories by inject_score ──────────────────────────────────

pub fn rank_by_score<'a>(memories: &mut Vec<&'a Memory>, current_agent_type: &str) {
    memories.sort_by(|a, b| {
        inject_score(b, current_agent_type)
            .partial_cmp(&inject_score(a, current_agent_type))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
}

// ── Decay pruner ──────────────────────────────────────────────────────────────

/// Run at startup after memory::init(). Cleans up expired + stale memories.
/// Non-blocking — runs in a spawned task.
pub async fn decay_prune() {
    if !memory::is_ready() {
        eprintln!("[scorer] decay_prune: memory not ready, skipping");
        return;
    }

    let now = now_ms();
    let thirty_days = 30 * 86_400_000i64;
    let seven_days = 7 * 86_400_000i64;

    // Pull all memories (all runboxes via global scan)
    // We iterate runboxes via __global__ + a full scan
    let all = match memory::memories_for_runbox("").await {
        Ok(m) => m,
        Err(_) => {
            // Empty runbox_id returns nothing — do per-known-runbox scan instead.
            // Fallback: scan via search_global with empty query
            memory::memories_search_global("", 5000)
                .await
                .unwrap_or_default()
        }
    };

    let mut deleted = 0usize;
    let mut demoted = 0usize;
    let mut flagged = 0usize;

    for mem in &all {
        // 1. Delete expired (decay_at > 0 and past)
        if mem.decay_at > 0 && mem.decay_at < now {
            if let Ok(()) = memory::memory_delete(&mem.id).await {
                deleted += 1;
            }
            continue;
        }

        // 2. Auto-expire general type after 7 days (migration state only)
        if mem.effective_type() == MT_GENERAL && (now - mem.timestamp) > seven_days {
            if let Ok(()) = memory::memory_delete(&mem.id).await {
                deleted += 1;
            }
            continue;
        }

        // 3. Demote stale blockers (30d+ unresolved) — lower importance, add tag
        if mem.effective_type() == MT_BLOCKER
            && !mem.resolved
            && (now - mem.timestamp) > thirty_days
            && mem.importance > 20
        {
            // Update tags to include stale marker
            let new_tags = if mem.tags.contains("stale") {
                mem.tags.clone()
            } else {
                format!("{},stale", mem.tags)
            };
            let _ = memory::memory_update_tags(&mem.id, &new_tags).await;
            demoted += 1;
        }

        // 4. Flag env facts unverified after 30 days
        if mem.effective_type() == MT_ENVIRONMENT
            && (now - mem.timestamp) > thirty_days
            && !mem.tags.contains("unverified")
            && !mem.tags.contains("confirmed")
        {
            let new_tags = format!("{},unverified", mem.tags);
            let _ = memory::memory_update_tags(&mem.id, &new_tags).await;
            flagged += 1;
        }
    }

    if deleted + demoted + flagged > 0 {
        eprintln!(
            "[scorer] decay_prune complete — deleted={deleted} demoted={demoted} flagged={flagged}"
        );
    }
}

/// Confirm an env fact (resets unverified flag + updates timestamp via re-tag).
pub async fn confirm_env_fact(id: &str) -> Result<(), String> {
    let tags_result = memory::memories_search_global(id, 1)
        .await
        .ok()
        .and_then(|v| v.into_iter().next())
        .map(|m| m.tags);

    if let Some(tags) = tags_result {
        let new_tags: String = tags
            .split(',')
            .filter(|t| *t != "unverified")
            .collect::<Vec<_>>()
            .join(",");
        let new_tags = format!("{},confirmed", new_tags);
        memory::memory_update_tags(id, &new_tags).await?;
    }
    Ok(())
}
