// src-tauri/src/memory/schema.rs
// Supercontext V2 — additive over V1.
// New fields: memory_type, importance, resolved, decay_at, scope, agent_type

use arrow_array::{FixedSizeListArray, Float32Array};
use arrow_schema::{DataType, Field, Schema};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

pub const EMBEDDING_DIM: i32 = 768; // nomic-embed-text Week 3. V1 was 512.

pub const MT_GOAL:        &str = "goal";
pub const MT_SESSION:     &str = "session";
pub const MT_BLOCKER:     &str = "blocker";
pub const MT_FAILURE:     &str = "failure";
pub const MT_ENVIRONMENT: &str = "environment";
pub const MT_CODEBASE:    &str = "codebase";
pub const MT_GIT:         &str = "git";
pub const MT_GENERAL:     &str = "general"; // migration state only — 7d expiry

pub const SCOPE_LOCAL:   &str = "local";
pub const SCOPE_MACHINE: &str = "machine";
pub const SCOPE_GLOBAL:  &str = "global";

pub const DECAY_NEVER:   i64 = -1;
pub const DECAY_SESSION: i64 = 0;

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

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

/// Per-type ANN cosine dedup threshold. Week 3 uses these.
/// Values > 1.0 mean "never use ANN — use exact match instead".
pub fn dedup_threshold(memory_type: &str) -> f32 {
    match memory_type {
        MT_FAILURE | MT_BLOCKER => 0.85,
        MT_CODEBASE             => 0.70,
        MT_ENVIRONMENT          => 2.0, // exact key match only
        _                       => 0.80,
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Memory {
    // V1
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
    // V2
    pub memory_type: String,
    pub importance:  i32,
    pub resolved:    bool,
    pub decay_at:    i64,
    pub scope:       String,
    pub agent_type:  String,
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

    pub fn is_active(&self) -> bool {
        if self.resolved && self.effective_type() == MT_BLOCKER { return false; }
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
}

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
        Field::new("memory_type", DataType::Utf8,    false),
        Field::new("importance",  DataType::Int32,   false),
        Field::new("resolved",    DataType::Boolean, false),
        Field::new("decay_at",    DataType::Int64,   false),
        Field::new("scope",       DataType::Utf8,    false),
        Field::new("agent_type",  DataType::Utf8,    false),
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