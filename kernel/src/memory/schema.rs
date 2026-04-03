// src-tauri/src/memory/schema.rs
// Supercontext V3 — 4-level system: LOCKED / PREFERRED / TEMPORARY / SESSION
// Additive over V2. V2 types (goal/blocker/etc.) kept for migration + legacy reads.

use arrow_array::{FixedSizeListArray, Float32Array};
use arrow_schema::{DataType, Field, Schema};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

pub const EMBEDDING_DIM: i32 = 768;

// ── V3 levels ─────────────────────────────────────────────────────────────────
pub const LEVEL_LOCKED:    &str = "LOCKED";    // user-only, never expires, enforced
pub const LEVEL_PREFERRED: &str = "PREFERRED"; // agent or user, 6-month decay, key-versioned
pub const LEVEL_TEMPORARY: &str = "TEMPORARY"; // agent-private, session expiry
pub const LEVEL_SESSION:   &str = "SESSION";   // end-of-session summary, last 3 per agent

// ── V2 types (kept for migration + legacy reads) ──────────────────────────────
pub const MT_GOAL:        &str = "goal";
pub const MT_SESSION:     &str = "session";
pub const MT_BLOCKER:     &str = "blocker";
pub const MT_FAILURE:     &str = "failure";
pub const MT_ENVIRONMENT: &str = "environment";
pub const MT_CODEBASE:    &str = "codebase";
pub const MT_GIT:         &str = "git";
pub const MT_GENERAL:     &str = "general";

// ── Scopes ────────────────────────────────────────────────────────────────────
pub const SCOPE_LOCAL:   &str = "local";
pub const SCOPE_MACHINE: &str = "machine";
pub const SCOPE_GLOBAL:  &str = "global";

// ── Decay sentinels ───────────────────────────────────────────────────────────
pub const DECAY_NEVER:   i64 = -1;
pub const DECAY_SESSION: i64 = 0; // expires when session ends

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

// ── V3 level helpers ──────────────────────────────────────────────────────────

pub fn importance_for_level(level: &str) -> i32 {
    match level {
        LEVEL_LOCKED    => 100,
        LEVEL_SESSION   => 80,
        LEVEL_PREFERRED => 90,
        LEVEL_TEMPORARY => 60,
        _ => 50,
    }
}

pub fn decay_for_level(level: &str) -> i64 {
    let six_months = 180 * 86_400_000i64;
    match level {
        LEVEL_LOCKED    => DECAY_NEVER,
        LEVEL_PREFERRED => now_ms() + six_months,
        LEVEL_TEMPORARY => DECAY_SESSION,
        LEVEL_SESSION   => DECAY_NEVER, // count-based pruning, not time
        _ => now_ms() + 30 * 86_400_000,
    }
}

/// Derive V3 level from a V2 memory_type (for migration + legacy rows).
pub fn level_from_memory_type(mt: &str) -> &'static str {
    match mt {
        MT_GOAL                     => LEVEL_LOCKED,
        MT_FAILURE | MT_ENVIRONMENT
        | MT_CODEBASE | MT_GENERAL  => LEVEL_PREFERRED,
        MT_BLOCKER                  => LEVEL_TEMPORARY,
        MT_SESSION                  => LEVEL_SESSION,
        MT_GIT                      => LEVEL_PREFERRED, // low importance, kept
        _                           => LEVEL_PREFERRED,
    }
}

/// Build agent_id from agent_type + session_id.
/// Format: "{agent_type}:{session_id}"
pub fn make_agent_id(agent_type: &str, session_id: &str) -> String {
    format!("{agent_type}:{session_id}")
}

/// Extract a short key from content for PREFERRED key-based versioning.
/// "port=3456"           → "port"
/// "node=v18 working"    → "node"
/// "python not available" → "python"
/// Falls back to first 20 chars if no pattern found.
pub fn extract_key(content: &str) -> String {
    let t = content.trim();

    // "key=value" pattern
    if let Some(eq) = t.find('=') {
        let k = t[..eq].trim().to_lowercase();
        if k.len() >= 2 && k.len() <= 30 && k.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
            return k;
        }
    }

    // First word if short enough to be a key
    let first = t.split_whitespace().next().unwrap_or("").to_lowercase();
    let first_clean: String = first.chars().filter(|c| c.is_alphanumeric() || *c == '-').collect();
    if first_clean.len() >= 2 && first_clean.len() <= 30 {
        return first_clean;
    }

    // Fallback: first 20 chars normalised
    t.chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .take(20)
        .collect::<String>()
        .to_lowercase()
}

// ── V2 compat helpers (used in migration + legacy store paths) ────────────────

pub fn decay_for_type(memory_type: &str) -> i64 {
    let day = 86_400_000i64;
    match memory_type {
        MT_FAILURE | MT_GOAL => DECAY_NEVER,
        MT_BLOCKER           => DECAY_SESSION,
        MT_SESSION           => now_ms() + 90 * day,
        MT_ENVIRONMENT       => now_ms() + 180 * day,
        MT_CODEBASE          => now_ms() + 7 * day,
        MT_GIT               => now_ms() + 90 * day,
        MT_GENERAL           => now_ms() + 7 * day,
        _                    => now_ms() + 30 * day,
    }
}

pub fn importance_for_type(memory_type: &str) -> i32 {
    match memory_type {
        MT_GOAL | MT_FAILURE => 100,
        MT_BLOCKER           => 95,
        MT_ENVIRONMENT       => 90,
        MT_CODEBASE          => 85,
        MT_SESSION           => 80,
        MT_GENERAL           => 50,
        MT_GIT               => 40,
        _                    => 50,
    }
}

pub fn infer_type_from_tags(tags: &str) -> &'static str {
    let t = tags.to_lowercase();
    if t.contains("goal")        { return MT_GOAL; }
    if t.contains("session")     { return MT_SESSION; }
    if t.contains("blocker")     { return MT_BLOCKER; }
    if t.contains("failure")     { return MT_FAILURE; }
    if t.contains("environment") || t.split(',').any(|p| p.trim() == "env") {
        return MT_ENVIRONMENT;
    }
    if t.contains("codebase")    { return MT_CODEBASE; }
    if t.contains("git-history") { return MT_GIT; }
    MT_GENERAL
}

pub fn agent_type_from_name(agent_name: &str) -> String {
    let n = agent_name.to_lowercase();
    if n.contains("claude")   { return "claude-code".into(); }
    if n.contains("codex")    { return "codex".into(); }
    if n.contains("gemini")   { return "gemini".into(); }
    if n.contains("cursor")   { return "cursor".into(); }
    if n.contains("copilot")  { return "copilot".into(); }
    if n.contains("opencode") { return "opencode".into(); }
    if n == "git"             { return "git".into(); }
    if n == "human" || n.is_empty() { return "human".into(); }
    n
}

pub fn dedup_threshold(memory_type: &str) -> f32 {
    match memory_type {
        MT_FAILURE | MT_BLOCKER => 0.85,
        MT_CODEBASE             => 0.70,
        MT_ENVIRONMENT          => 2.0,
        _                       => 0.80,
    }
}

// ── Memory struct ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Memory {
    // V1 fields
    pub id:          String,
    pub runbox_id:   String,
    pub session_id:  String,
    pub content:     String,
    pub pinned:      bool,
    pub timestamp:   i64,
    pub branch:      String,
    pub commit_type: String,
    pub tags:        String,
    pub parent_id:   String,
    pub agent_name:  String,
    // V2 fields
    pub memory_type: String,
    pub importance:  i32,
    pub resolved:    bool,
    pub decay_at:    i64,
    pub scope:       String,
    pub agent_type:  String,
    // V3 fields
    pub level:       String, // LOCKED | PREFERRED | TEMPORARY | SESSION
    pub agent_id:    String, // "{agent_type}:{session_id}" for TEMPORARY isolation
    pub key:         String, // extracted key for PREFERRED versioning
}

impl Memory {
    pub fn tag_list(&self) -> Vec<&str> {
        self.tags.split(',').map(str::trim).filter(|s| !s.is_empty()).collect()
    }

    pub fn effective_type(&self) -> &str {
        if !self.memory_type.is_empty() && self.memory_type != MT_GENERAL {
            return &self.memory_type;
        }
        infer_type_from_tags(&self.tags)
    }

    /// Effective level — V3 field if set, derived from memory_type otherwise.
    pub fn effective_level(&self) -> &str {
        if !self.level.is_empty() {
            return &self.level;
        }
        level_from_memory_type(self.effective_type())
    }

    pub fn is_active(&self) -> bool {
        if self.resolved { return false; }
        match self.decay_at {
            DECAY_NEVER | DECAY_SESSION => true,
            ts => ts > now_ms(),
        }
    }

    pub fn is_stale_blocker(&self) -> bool {
        self.effective_type() == MT_BLOCKER
            && !self.resolved
            && (now_ms() - self.timestamp) > 30 * 86_400_000
    }

    pub fn env_unverified(&self) -> bool {
        self.effective_type() == MT_ENVIRONMENT
            && (now_ms() - self.timestamp) > 30 * 86_400_000
    }

    /// Human-readable age for injection headers ("2h ago", "1d ago", etc.)
    pub fn age_label(&self) -> String {
        let ms = now_ms() - self.timestamp;
        if ms < 0 { return "just now".into(); }
        let mins  = ms / 60_000;
        let hours = ms / 3_600_000;
        let days  = ms / 86_400_000;
        if mins < 2   { "just now".into() }
        else if mins < 60  { format!("{mins}m ago") }
        else if hours < 24 { format!("{hours}h ago") }
        else               { format!("{days}d ago") }
    }
}

// ── V3 schema (additive — includes all V2 + V3 fields) ───────────────────────

pub fn memory_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("id",          DataType::Utf8,    false),
        Field::new("runbox_id",   DataType::Utf8,    false),
        Field::new("session_id",  DataType::Utf8,    false),
        Field::new("content",     DataType::Utf8,    false),
        Field::new("pinned",      DataType::Boolean, false),
        Field::new("timestamp",   DataType::Int64,   false),
        Field::new("branch",      DataType::Utf8,    false),
        Field::new("commit_type", DataType::Utf8,    false),
        Field::new("tags",        DataType::Utf8,    false),
        Field::new("parent_id",   DataType::Utf8,    false),
        Field::new("agent_name",  DataType::Utf8,    false),
        // V2
        Field::new("memory_type", DataType::Utf8,    false),
        Field::new("importance",  DataType::Int32,   false),
        Field::new("resolved",    DataType::Boolean, false),
        Field::new("decay_at",    DataType::Int64,   false),
        Field::new("scope",       DataType::Utf8,    false),
        Field::new("agent_type",  DataType::Utf8,    false),
        // V3
        Field::new("level",       DataType::Utf8,    false),
        Field::new("agent_id",    DataType::Utf8,    false),
        Field::new("key",         DataType::Utf8,    false),
        Field::new(
            "vector",
            DataType::FixedSizeList(
                Arc::new(Field::new("item", DataType::Float32, true)),
                EMBEDDING_DIM,
            ),
            true,
        ),
    ]))
}

pub fn null_vector() -> Result<Arc<FixedSizeListArray>, String> {
    FixedSizeListArray::try_new(
        Arc::new(Field::new("item", DataType::Float32, true)),
        EMBEDDING_DIM,
        Arc::new(Float32Array::from(vec![0f32; EMBEDDING_DIM as usize])),
        None,
    )
    .map(Arc::new)
    .map_err(|e| e.to_string())
}