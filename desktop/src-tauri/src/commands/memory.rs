// src-tauri/src/commands/memory.rs

use crate::memory;

#[tauri::command]
pub async fn memory_add(
    runbox_id:  String,
    session_id: String,
    content:    String,
) -> Result<memory::Memory, String> {
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
    agent_name:  Option<String>,   // ← was missing
) -> Result<memory::Memory, String> {
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
    memory::memories_for_runbox(&runbox_id).await
}

#[tauri::command]
pub async fn memory_list_branch(
    runbox_id: String,
    branch:    String,
) -> Result<Vec<memory::Memory>, String> {
    memory::memories_for_branch(&runbox_id, &branch).await
}

#[tauri::command]
pub async fn memory_branches(runbox_id: String) -> Result<Vec<String>, String> {
    memory::branches_for_runbox(&runbox_id).await
}

#[tauri::command]
pub async fn memory_tags(runbox_id: String) -> Result<Vec<String>, String> {
    memory::tags_for_runbox(&runbox_id).await
}

#[tauri::command]
pub async fn memory_list_by_tag(
    runbox_id: String,
    tag:       String,
) -> Result<Vec<memory::Memory>, String> {
    memory::memories_by_tag(&runbox_id, &tag).await
}

#[tauri::command]
pub async fn memory_delete(id: String) -> Result<(), String> {
    memory::memory_delete(&id).await
}

#[tauri::command]
pub async fn memory_pin(id: String, pinned: bool) -> Result<(), String> {
    memory::memory_pin(&id, pinned).await
}

#[tauri::command]
pub async fn memory_update(id: String, content: String) -> Result<(), String> {
    memory::memory_update(&id, &content).await
}

#[tauri::command]
pub async fn memory_update_tags(id: String, tags: String) -> Result<(), String> {
    memory::memory_update_tags(&id, &tags).await
}

#[tauri::command]
pub async fn memory_move_branch(id: String, branch: String) -> Result<(), String> {
    memory::memory_move_branch(&id, &branch).await
}

#[tauri::command]
pub async fn memory_delete_for_runbox(runbox_id: String) -> Result<(), String> {
    memory::memories_delete_for_runbox(&runbox_id).await
}