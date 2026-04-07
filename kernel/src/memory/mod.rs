// src-tauri/src/memory/mod.rs
// Supercontext V3 — exports all V2 + V3 public API.
// GCC+Letta additions: filesystem sync, sleep-time jobs.

pub mod decision;
pub mod filesystem; // ← NEW: flat file sync + git commits
pub mod schema;
pub mod sleep; // ← NEW: boot_init, reflection, defrag
pub mod store; // ← V3: LOCKED memory enforcement

pub use schema::{
    agent_type_from_name,
    decay_for_type,
    extract_key,
    importance_for_type,
    infer_type_from_tags,
    make_agent_id,
    now_ms,
    Memory,
    // Decay sentinels
    DECAY_NEVER, // Helpers
    // V3 levels
    LEVEL_LOCKED,
    LEVEL_PREFERRED,
    LEVEL_SESSION,
    LEVEL_TEMPORARY,
    MT_BLOCKER,
    MT_CODEBASE,
    MT_ENVIRONMENT,
    MT_FAILURE,
    MT_GENERAL,
    // V2 types (kept for migration + legacy panel reads)
    MT_GOAL,
    MT_SESSION,
    // Scopes
    SCOPE_MACHINE,
};
pub use store::{
    active_blockers,
    add_locked,
    branches_for_runbox,
    expire_temporary_for_agent,
    fetch_one,
    init,
    is_ready,
    locked_memories,
    memories_by_level,
    memories_by_level_for_agent,
    memories_by_tag,
    memories_by_type,
    memories_delete_for_runbox,
    memories_for_branch,
    memories_for_runbox,
    memories_search_global,
    // V2 operations (backward compat)
    memory_add,
    memory_add_full,
    memory_add_typed,
    memory_delete,
    memory_move_branch,
    memory_pin,
    memory_update,
    memory_update_tags,
    // V3 operations
    remember,
    resolve_blocker,
    session_log,
    session_summary,
    tags_for_runbox,
};
