// src-tauri/src/commands/memory.rs

use crate::memory;

#[tauri::command]
pub async fn memory_add(runbox_id: String, session_id: String, content: String) -> Result<memory::Memory, String> {
    memory::memory_add(&runbox_id, &session_id, &content).await
}

#[tauri::command]
pub async fn memory_list(runbox_id: String) -> Result<Vec<memory::Memory>, String> {
    memory::memories_for_runbox(&runbox_id).await
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
pub async fn memory_delete_for_runbox(runbox_id: String) -> Result<(), String> {
    memory::memories_delete_for_runbox(&runbox_id).await
}
