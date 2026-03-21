// src-tauri/src/commands/memory.rs

use crate::memory;

/// Non-blocking readiness check.
/// Returns Ok if LanceDB is initialised, or an immediate "not initialised" error
/// so the frontend can retry without the invoke hanging forever.
/// The actual init is handled by the startup spawn in lib.rs.
async fn ensure_init() -> Result<(), String> {
    if memory::is_ready() {
        return Ok(());
    }
    Err("memory db not initialised — call init() first".to_string())
}

#[tauri::command]
pub async fn memory_add(
    runbox_id:  String,
    session_id: String,
    content:    String,
) -> Result<memory::Memory, String> {
    ensure_init().await?;
    memory::memory_add(&runbox_id, &session_id, &content).await
}

#[tauri::command]
pub async fn memory_add_full(
    runbox_id:   String,
    session_id:  String,
    content:     String,
    branch:      Option<String>,
    commit_type: Option<String>,
    tags:        Option<String>,
    parent_id:   Option<String>,
    agent_name:  Option<String>,
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
    ).await
}

#[tauri::command]
pub async fn memory_list(runbox_id: String) -> Result<Vec<memory::Memory>, String> {
    ensure_init().await?;
    memory::memories_for_runbox(&runbox_id).await
}

#[tauri::command]
pub async fn memory_list_branch(
    runbox_id: String,
    branch:    String,
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
    tag:       String,
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
pub async fn memory_search_global(query: String, limit: Option<usize>) -> Result<Vec<memory::Memory>, String> {
    ensure_init().await?;
    memory::memories_search_global(&query, limit.unwrap_or(50)).await
}