// src-tauri/src/memory/mod.rs
// Supercontext V3 — exports all V2 + V3 public API.
// GCC+Letta additions: filesystem sync, sleep-time jobs.

pub mod schema;
pub mod store;
pub mod filesystem; // ← NEW: flat file sync + git commits
pub mod sleep;      // ← NEW: boot_init, reflection, defrag

pub use schema::{
    Memory,
    // V3 levels
    LEVEL_LOCKED, LEVEL_PREFERRED, LEVEL_TEMPORARY, LEVEL_SESSION,
    // V2 types (kept for migration + legacy panel reads)
    MT_GOAL, MT_SESSION, MT_BLOCKER, MT_FAILURE,
    MT_ENVIRONMENT, MT_CODEBASE, MT_GIT, MT_GENERAL,
    // Scopes
    SCOPE_LOCAL, SCOPE_MACHINE, SCOPE_GLOBAL,
    // Decay sentinels
    DECAY_NEVER, DECAY_SESSION,
    // Helpers
    decay_for_type, importance_for_type, infer_type_from_tags,
    agent_type_from_name, dedup_threshold, now_ms,
    decay_for_level, importance_for_level, level_from_memory_type,
    make_agent_id, extract_key,
};
pub use store::{
    init, is_ready,
    // V3 operations
    remember, session_log, session_summary, add_locked,
    expire_temporary_for_agent, locked_memories,
    memories_by_level, memories_by_level_for_agent,
    // V2 operations (backward compat)
    memory_add, memory_add_full, memory_add_typed, memory_add_with_embedding,
    memories_for_runbox, memories_for_branch, memories_by_tag,
    memories_by_type, active_blockers, machine_scope_memories,
    resolve_blocker,
    find_semantic_duplicate, memories_ann_search,
    branches_for_runbox, tags_for_runbox,
    memory_delete, memories_delete_for_runbox,
    memory_pin, memory_update, memory_update_tags, memory_move_branch,
    memories_search_global, fetch_one,
};