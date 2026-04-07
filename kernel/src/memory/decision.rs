// src/memory/decision.rs
// Supercontext V3 — LOCKED memory enforcement.
//
// LOCKED memories are set by humans and represent absolute rules the agent
// must never violate. This module enforces that contract:
//
//   • is_locked()            — check if a single memory is LOCKED
//   • assert_not_locked()    — return Err if the memory is LOCKED (use before delete/update)
//   • locked_rules_block()   — format the LOCKED section for agent context injection
//   • enforce_no_overwrite() — refuse if key already exists as LOCKED

use crate::memory::schema::{Memory, LEVEL_LOCKED};

/// Returns true if this memory is a LOCKED rule.
pub fn is_locked(m: &Memory) -> bool {
    m.effective_level() == LEVEL_LOCKED && !m.resolved
}

/// Guard for delete and update operations.
/// Returns Err with a human-readable message if the memory is LOCKED.
/// Call this before any mutation of a memory retrieved from the store.
pub fn assert_not_locked(m: &Memory) -> Result<(), String> {
    if is_locked(m) {
        return Err(format!(
            "LOCKED memory cannot be modified or deleted: [{}] {}",
            m.id,
            &m.content.chars().take(60).collect::<String>()
        ));
    }
    Ok(())
}

/// Check whether a proposed new content string conflicts with an existing
/// LOCKED memory by key match.
///
/// Keys are the `key=value` prefix extracted from content — see `extract_key()`
/// in schema.rs. Two memories with the same non-empty key represent the same
/// fact; if the existing one is LOCKED the new one must be refused.
///
/// Returns Err if a LOCKED memory with the same key already exists.
pub fn enforce_no_overwrite(proposed_key: &str, locked: &[Memory]) -> Result<(), String> {
    if proposed_key.is_empty() {
        return Ok(());
    }
    for m in locked {
        if !is_locked(m) {
            continue;
        }
        if m.key == proposed_key {
            return Err(format!(
                "LOCKED rule already exists for key '{}': {}",
                proposed_key,
                &m.content.chars().take(80).collect::<String>()
            ));
        }
    }
    Ok(())
}

/// Build the LOCKED rules block for injection into agent context files.
/// Returns an empty string if there are no locked memories.
///
/// Format (markdown, for embedding inside CLAUDE.md / AGENTS.md / etc.):
/// ```
/// ## LOCKED Rules — Never Violate
/// These rules are set by the project owner and are absolute.
///
/// 1. rule text
/// 2. rule text
/// ```
pub fn locked_rules_block(locked: &[Memory]) -> String {
    let rules: Vec<&Memory> = locked.iter().filter(|m| is_locked(m)).collect();
    if rules.is_empty() {
        return String::new();
    }

    let mut out = String::from(
        "## LOCKED Rules — Never Violate\n\
         These rules are set by the project owner and are absolute.\n\
         Violating them is not permitted under any circumstances.\n\n",
    );
    for (i, m) in rules.iter().enumerate() {
        out.push_str(&format!("{}. {}\n", i + 1, m.content.trim()));
    }
    out.push('\n');
    out
}

/// Validate LOCKED memory integrity across a set of memories.
/// Returns a list of violation descriptions, empty if all is well.
/// A LOCKED memory with resolved=true is a violation — they must never expire.
pub fn audit_locked_integrity(memories: &[Memory]) -> Vec<String> {
    memories
        .iter()
        .filter(|m| m.effective_level() == LEVEL_LOCKED && m.resolved)
        .map(|m| {
            format!(
                "INTEGRITY VIOLATION: LOCKED memory resolved=true [{}]: {}",
                m.id,
                &m.content.chars().take(60).collect::<String>()
            )
        })
        .collect()
}
