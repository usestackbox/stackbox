// src-tauri/src/memory/mod.rs

pub mod schema;
pub mod store;

pub use schema::{
    Memory, MT_GOAL, MT_SESSION, MT_BLOCKER, MT_FAILURE,
    MT_ENVIRONMENT, MT_CODEBASE, MT_GIT, MT_GENERAL,
    SCOPE_LOCAL, SCOPE_MACHINE, SCOPE_GLOBAL,
    DECAY_NEVER, DECAY_SESSION,
    decay_for_type, importance_for_type, infer_type_from_tags,
    agent_type_from_name, dedup_threshold, now_ms,
};
pub use store::{
    init, is_ready,
    memory_add, memory_add_full, memory_add_typed, memory_add_with_embedding,
    memories_for_runbox, memories_for_branch, memories_by_tag,
    memories_by_type, active_blockers, machine_scope_memories,
    resolve_blocker,
    find_semantic_duplicate, memories_ann_search,
    branches_for_runbox, tags_for_runbox,
    memory_delete, memories_delete_for_runbox,
    memory_pin, memory_update, memory_update_tags, memory_move_branch,
    memories_search_global,
};