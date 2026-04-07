// src-tauri/src/commands/memory.rs
// Supercontext V3 — Tauri commands.
// V2 commands kept for panel backward compat.
// V3 adds: memory_add_locked, memory_list_by_level, memory_expire_temporary.

use crate::memory;

async fn ensure_init() -> Result<(), String> {
    if memory::is_ready() {
        return Ok(());
    }
    Err("memory db not initialised — call init() first".to_string())
}

// ── V1 compat commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn memory_add(
    runbox_id: String,
    session_id: String,
    content: String,
) -> Result<memory::Memory, String> {
    ensure_init().await?;
    memory::memory_add(&runbox_id, &session_id, &content).await
}

#[tauri::command]
pub async fn memory_add_full(
    runbox_id: String,
    session_id: String,
    content: String,
    branch: Option<String>,
    commit_type: Option<String>,
    tags: Option<String>,
    parent_id: Option<String>,
    agent_name: Option<String>,
) -> Result<memory::Memory, String> {
    ensure_init().await?;
    memory::memory_add_full(
        &runbox_id,
        &session_id,
        &content,
        branch.as_deref().unwrap_or("main"),
        commit_type.as_deref().unwrap_or("memory"),
        tags.as_deref().unwrap_or(""),
        parent_id.as_deref().unwrap_or(""),
        agent_name.as_deref().unwrap_or("human"),
    )
    .await
}

#[tauri::command]
pub async fn memory_list(runbox_id: String) -> Result<Vec<memory::Memory>, String> {
    ensure_init().await?;
    memory::memories_for_runbox(&runbox_id).await
}

#[tauri::command]
pub async fn memory_list_branch(
    runbox_id: String,
    branch: String,
) -> Result<Vec<memory::Memory>, String> {
    ensure_init().await?;
    memory::memories_for_branch(&runbox_id, &branch).await
}

#[tauri::command]
pub async fn memory_branches(runbox_id: String) -> Result<Vec<String>, String> {
    ensure_init().await?;
    memory::branches_for_runbox(&runbox_id).await
}

#[tauri::command]
pub async fn memory_tags(runbox_id: String) -> Result<Vec<String>, String> {
    ensure_init().await?;
    memory::tags_for_runbox(&runbox_id).await
}

#[tauri::command]
pub async fn memory_list_by_tag(
    runbox_id: String,
    tag: String,
) -> Result<Vec<memory::Memory>, String> {
    ensure_init().await?;
    memory::memories_by_tag(&runbox_id, &tag).await
}

#[tauri::command]
pub async fn memory_delete(id: String) -> Result<(), String> {
    ensure_init().await?;
    memory::memory_delete(&id).await
}

#[tauri::command]
pub async fn memory_pin(id: String, pinned: bool) -> Result<(), String> {
    ensure_init().await?;
    memory::memory_pin(&id, pinned).await
}

#[tauri::command]
pub async fn memory_update(id: String, content: String) -> Result<(), String> {
    ensure_init().await?;
    memory::memory_update(&id, &content).await
}

#[tauri::command]
pub async fn memory_update_tags(id: String, tags: String) -> Result<(), String> {
    ensure_init().await?;
    memory::memory_update_tags(&id, &tags).await
}

#[tauri::command]
pub async fn memory_move_branch(id: String, branch: String) -> Result<(), String> {
    ensure_init().await?;
    memory::memory_move_branch(&id, &branch).await
}

#[tauri::command]
pub async fn memory_delete_for_runbox(runbox_id: String) -> Result<(), String> {
    ensure_init().await?;
    memory::memories_delete_for_runbox(&runbox_id).await
}

#[tauri::command]
pub async fn memory_search_global(
    query: String,
    limit: Option<usize>,
) -> Result<Vec<memory::Memory>, String> {
    ensure_init().await?;
    memory::memories_search_global(&query, limit.unwrap_or(50)).await
}

// ── V2 commands ────────────────────────────────────────────────────────────────

/// Write a typed V2 memory from the frontend panel.
#[tauri::command]
pub async fn memory_add_typed_cmd(
    runbox_id: String,
    session_id: String,
    content: String,
    memory_type: String,
    scope: Option<String>,
    tags: Option<String>,
    agent_name: Option<String>,
) -> Result<memory::Memory, String> {
    ensure_init().await?;
    let mt = memory_type.as_str();
    let importance = memory::importance_for_type(mt);
    let decay_at = memory::decay_for_type(mt);
    let scope_str = scope.as_deref().unwrap_or("local");
    let an = agent_name.as_deref().unwrap_or("human");
    let at = memory::agent_type_from_name(an);
    let extra = tags.as_deref().unwrap_or("");
    let full_tags = if extra.is_empty() {
        mt.to_string()
    } else {
        format!("{mt},{extra}")
    };

    let result = memory::memory_add_typed(
        &runbox_id,
        &session_id,
        &content,
        "main",
        "memory",
        &full_tags,
        "",
        an,
        mt,
        importance,
        false,
        decay_at,
        scope_str,
        &at,
    )
    .await?;

    crate::agent::injector::invalidate_cache(&runbox_id).await;
    crate::agent::globals::emit_memory_added(&runbox_id);
    Ok(result)
}

/// Get memories filtered by V2 type — for legacy panel tabs.
#[tauri::command]
pub async fn memory_list_by_type(
    runbox_id: String,
    memory_type: String,
) -> Result<Vec<memory::Memory>, String> {
    ensure_init().await?;
    memory::memories_by_type(&runbox_id, &memory_type).await
}

/// Get active (unresolved) blockers.
#[tauri::command]
pub async fn memory_active_blockers(runbox_id: String) -> Result<Vec<memory::Memory>, String> {
    ensure_init().await?;
    memory::active_blockers(&runbox_id).await
}

/// Resolve a blocker — marks resolved + writes failure.
#[tauri::command]
pub async fn memory_resolve_blocker(
    runbox_id: String,
    session_id: String,
    agent_name: String,
    blocker_description: String,
    fix: String,
) -> Result<(), String> {
    ensure_init().await?;
    let result = memory::resolve_blocker(
        &runbox_id,
        &session_id,
        &agent_name,
        &blocker_description,
        &fix,
    )
    .await?;
    crate::agent::injector::invalidate_cache(&runbox_id).await;
    crate::agent::globals::emit_memory_added(&runbox_id);
    Ok(result)
}

/// Get the injector context block for display in the panel (V3 path).
#[tauri::command]
pub async fn memory_get_context(runbox_id: String, task: Option<String>) -> Result<String, String> {
    ensure_init().await?;
    // Panel has no agent_id — pass empty string (no TEMPORARY filter)
    Ok(
        crate::agent::injector::build_context_v3(&runbox_id, task.as_deref().unwrap_or(""), "")
            .await,
    )
}

/// Confirm an env fact is still valid — resets unverified flag.
#[tauri::command]
pub async fn memory_confirm_env(id: String) -> Result<(), String> {
    ensure_init().await?;
    crate::agent::scorer::confirm_env_fact(&id).await
}

/// Manually trigger decay prune (for testing / admin).
#[tauri::command]
pub async fn memory_decay_prune() -> Result<String, String> {
    ensure_init().await?;
    crate::agent::scorer::decay_prune().await;
    Ok("decay prune complete".to_string())
}

// ── V3 commands ────────────────────────────────────────────────────────────────

/// Add a LOCKED rule (user/panel only — agents cannot call this).
#[tauri::command]
pub async fn memory_add_locked(
    runbox_id: String,
    session_id: String,
    content: String,
) -> Result<memory::Memory, String> {
    ensure_init().await?;
    let result = memory::add_locked(&runbox_id, &session_id, &content).await?;
    crate::agent::injector::invalidate_cache(&runbox_id).await;
    crate::agent::globals::emit_memory_added(&runbox_id);
    Ok(result)
}

/// Get memories filtered by V3 level — for V3 panel tabs (LOCKED/PREFERRED/TEMPORARY/SESSION).
#[tauri::command]
pub async fn memory_list_by_level(
    runbox_id: String,
    level: String,
) -> Result<Vec<memory::Memory>, String> {
    ensure_init().await?;
    memory::memories_by_level(&runbox_id, &level).await
}

/// Get LOCKED memories for a runbox.
#[tauri::command]
pub async fn memory_list_locked(runbox_id: String) -> Result<Vec<memory::Memory>, String> {
    ensure_init().await?;
    memory::locked_memories(&runbox_id).await
}

/// Get TEMPORARY memories for a specific agent in this session.
#[tauri::command]
pub async fn memory_list_temporary_for_agent(
    runbox_id: String,
    agent_id: String,
) -> Result<Vec<memory::Memory>, String> {
    ensure_init().await?;
    memory::memories_by_level_for_agent(&runbox_id, memory::LEVEL_TEMPORARY, &agent_id).await
}

/// Expire all TEMPORARY memories for an agent (called on session end or manually).
#[tauri::command]
pub async fn memory_expire_temporary(runbox_id: String, agent_id: String) -> Result<(), String> {
    ensure_init().await?;
    memory::expire_temporary_for_agent(&runbox_id, &agent_id).await?;
    crate::agent::injector::invalidate_cache(&runbox_id).await;
    crate::agent::globals::emit_memory_added(&runbox_id);
    Ok(())
}

/// Write an atomic fact via remember() — for panel manual remember.
#[tauri::command]
pub async fn memory_remember(
    runbox_id: String,
    session_id: String,
    agent_id: String,
    agent_name: String,
    content: String,
    level: String,
) -> Result<memory::Memory, String> {
    ensure_init().await?;
    let result = memory::remember(
        &runbox_id,
        &session_id,
        &agent_id,
        &agent_name,
        &content,
        &level,
    )
    .await?;
    crate::agent::injector::invalidate_cache(&runbox_id).await;
    crate::agent::globals::emit_memory_added(&runbox_id);
    Ok(result)
}
