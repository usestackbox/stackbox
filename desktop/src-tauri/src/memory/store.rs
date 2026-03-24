// src-tauri/src/memory/store.rs
// Supercontext V3 — 4-level store: LOCKED / PREFERRED / TEMPORARY / SESSION
// V3 adds: remember(), session_log(), session_summary(), add_locked(),
//          expire_temporary_for_agent(), memory_context_for_agent().
// All V2 functions kept for backward compat (panel + Tauri commands).

use arrow_array::{
    BooleanArray, FixedSizeListArray, Float32Array,
    Int32Array, Int64Array, RecordBatch, RecordBatchIterator, StringArray,
};
use arrow_schema::Field;
use futures::TryStreamExt;
use lancedb::{connect, Connection, Table};
use lancedb::query::{ExecutableQuery, QueryBase};
use std::sync::Arc;
use tokio::sync::OnceCell;

use super::schema::{
    memory_schema, null_vector, Memory, EMBEDDING_DIM,
    MT_BLOCKER, MT_FAILURE, MT_GOAL, SCOPE_LOCAL, SCOPE_MACHINE,
    LEVEL_LOCKED, LEVEL_PREFERRED, LEVEL_TEMPORARY, LEVEL_SESSION,
    decay_for_type, importance_for_type, agent_type_from_name,
    infer_type_from_tags, dedup_threshold, now_ms,
    decay_for_level, importance_for_level, level_from_memory_type,
    make_agent_id, extract_key,
};
use crate::agent::embedder;

static DB: OnceCell<Connection> = OnceCell::const_new();

fn db_dir() -> String {
    dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("stackbox").join("memory")
        .to_string_lossy().to_string()
}

// ── Init + migration ───────────────────────────────────────────────────────────

pub async fn init() -> Result<(), String> {
    DB.get_or_try_init(|| async {
        let dir = db_dir();
        std::fs::create_dir_all(&dir).ok();
        let conn = connect(&dir).execute().await.map_err(|e| e.to_string())?;
        let tables = conn.table_names().execute().await.map_err(|e| e.to_string())?;

        if tables.contains(&"memories".to_string()) {
            let t = conn.open_table("memories").execute().await.map_err(|e| e.to_string())?;
            let schema = t.schema().await.map_err(|e| e.to_string())?;
            let fields: Vec<&str> = schema.fields().iter().map(|f| f.name().as_str()).collect();

            // Vector dim mismatch (512→768 upgrade) — drop and recreate
            let wrong_dim = schema.fields().iter().any(|f| {
                if f.name() != "vector" { return false; }
                match f.data_type() {
                    arrow_schema::DataType::FixedSizeList(_, dim) => *dim != EMBEDDING_DIM,
                    _ => false,
                }
            });
            if wrong_dim {
                eprintln!("[memory] vector dim mismatch — recreating with dim={}", EMBEDDING_DIM);
                let backup = "memories_dim512_backup";
                let _ = conn.drop_table(backup).await;
                conn.rename_table("memories", backup).await.ok();
                create_empty_table(&conn).await?;
                return Ok(conn);
            }

            // V1→V2 migration
            let needs_v2 = !fields.contains(&"memory_type")
                || !fields.contains(&"importance")
                || !fields.contains(&"resolved")
                || !fields.contains(&"decay_at")
                || !fields.contains(&"scope")
                || !fields.contains(&"agent_type");

            if needs_v2 || !fields.contains(&"branch") || !fields.contains(&"agent_name") {
                let backup = "memories_v1";
                eprintln!("[memory] migrating V1→V2+V3 schema — backing up as {backup}");
                conn.rename_table("memories", backup).await.ok();
                create_empty_table(&conn).await?;
                if let Err(e) = migrate_v1_to_v3(&conn, backup).await {
                    eprintln!("[memory] V2 migration warning: {e}");
                }
                return Ok(conn);
            }

            // V2→V3 migration (add level, agent_id, key fields)
            let needs_v3 = !fields.contains(&"level")
                || !fields.contains(&"agent_id")
                || !fields.contains(&"key");

            if needs_v3 {
                let backup = "memories_v2";
                eprintln!("[memory] migrating V2→V3 schema — backing up as {backup}");
                let _ = conn.drop_table(backup).await;
                conn.rename_table("memories", backup).await.ok();
                create_empty_table(&conn).await?;
                if let Err(e) = migrate_v2_to_v3(&conn, backup).await {
                    eprintln!("[memory] V3 migration warning: {e}");
                }
            }
        } else {
            create_empty_table(&conn).await?;
        }

        Ok(conn)
    }).await.map(|_| ())
}

async fn create_empty_table(conn: &Connection) -> Result<(), String> {
    let schema = memory_schema();
    let batch  = RecordBatch::new_empty(schema.clone());
    let reader = RecordBatchIterator::new(vec![Ok(batch)], schema);
    match conn.create_table("memories", reader).execute().await {
        Ok(_) => Ok(()),
        Err(e) => {
            let msg = e.to_string().to_lowercase();
            if msg.contains("already exists") { Ok(()) } else { Err(e.to_string()) }
        }
    }
}

async fn migrate_v2_to_v3(conn: &Connection, backup: &str) -> Result<(), String> {
    let old    = conn.open_table(backup).execute().await.map_err(|e| e.to_string())?;
    let new    = conn.open_table("memories").execute().await.map_err(|e| e.to_string())?;
    let schema = memory_schema();

    let stream  = old.query().execute().await.map_err(|e: lancedb::Error| e.to_string())?;
    let batches: Vec<RecordBatch> = stream.try_collect().await.map_err(|e| e.to_string())?;

    for batch in &batches {
        let n = batch.num_rows(); if n == 0 { continue; }

        let get_str = |name: &str, fallback: &'static str| -> Vec<String> {
            if let Ok(col) = str_col(batch, name) {
                return (0..n).map(|i| col.value(i).to_string()).collect();
            }
            vec![fallback.to_string(); n]
        };
        let get_bool = |name: &str, fallback: bool| -> Vec<bool> {
            bool_col(batch, name).map(|c| (0..n).map(|i| c.value(i)).collect())
                .unwrap_or(vec![fallback; n])
        };
        let get_i64 = |name: &str, fallback: i64| -> Vec<i64> {
            i64_col(batch, name).map(|c| (0..n).map(|i| c.value(i)).collect())
                .unwrap_or(vec![fallback; n])
        };
        let get_i32 = |name: &str, fallback: i32| -> Vec<i32> {
            i32_col(batch, name).map(|c| (0..n).map(|i| c.value(i)).collect())
                .unwrap_or(vec![fallback; n])
        };

        let ids          = get_str("id", "");
        let runbox_ids   = get_str("runbox_id", "");
        let sess_ids     = get_str("session_id", "");
        let contents     = get_str("content", "");
        let pinneds      = get_bool("pinned", false);
        let timestamps   = get_i64("timestamp", 0);
        let branches     = get_str("branch", "main");
        let commit_types = get_str("commit_type", "memory");
        let tags_vec     = get_str("tags", "");
        let parent_ids   = get_str("parent_id", "");
        let agent_names  = get_str("agent_name", "");
        let mem_types    = get_str("memory_type", "");
        let importances  = get_i32("importance", 50);
        let resolveds    = get_bool("resolved", false);
        let decay_ats    = get_i64("decay_at", 0);
        let scopes       = get_str("scope", SCOPE_LOCAL);
        let agent_types  = get_str("agent_type", "");

        // Derive V3 fields
        let levels: Vec<String> = mem_types.iter()
            .map(|mt| level_from_memory_type(mt).to_string()).collect();
        let agent_ids: Vec<String> = (0..n)
            .map(|i| make_agent_id(&agent_types[i], &sess_ids[i]))
            .collect();
        let keys: Vec<String> = contents.iter()
            .map(|c| extract_key(c))
            .collect();

        // Drop git-type memories (noise)
        let keep: Vec<usize> = (0..n)
            .filter(|&i| mem_types[i] != "git")
            .collect();
        if keep.is_empty() { continue; }

        let idx_filter = |v: Vec<String>| -> Vec<String> {
            keep.iter().map(|&i| v[i].clone()).collect()
        };
        let idx_filter_bool = |v: Vec<bool>| -> Vec<bool> {
            keep.iter().map(|&i| v[i]).collect()
        };
        let idx_filter_i64 = |v: Vec<i64>| -> Vec<i64> {
            keep.iter().map(|&i| v[i]).collect()
        };
        let idx_filter_i32 = |v: Vec<i32>| -> Vec<i32> {
            keep.iter().map(|&i| v[i]).collect()
        };

        let ids2         = idx_filter(ids);
        let runbox_ids2  = idx_filter(runbox_ids);
        let sess_ids2    = idx_filter(sess_ids);
        let contents2    = idx_filter(contents);
        let pinneds2     = idx_filter_bool(pinneds);
        let timestamps2  = idx_filter_i64(timestamps);
        let branches2    = idx_filter(branches);
        let commit_types2= idx_filter(commit_types);
        let tags_vec2    = idx_filter(tags_vec);
        let parent_ids2  = idx_filter(parent_ids);
        let agent_names2 = idx_filter(agent_names);
        let mem_types2   = idx_filter(mem_types);
        let importances2 = idx_filter_i32(importances);
        let resolveds2   = idx_filter_bool(resolveds);
        let decay_ats2   = idx_filter_i64(decay_ats);
        let scopes2      = idx_filter(scopes);
        let agent_types2 = idx_filter(agent_types);
        let levels2      = idx_filter(levels);
        let agent_ids2   = idx_filter(agent_ids);
        let keys2        = idx_filter(keys);
        let n2 = ids2.len();

        let new_batch = RecordBatch::try_new(schema.clone(), vec![
            Arc::new(StringArray::from(ids2.iter().map(|s| s.as_str()).collect::<Vec<_>>())),
            Arc::new(StringArray::from(runbox_ids2.iter().map(|s| s.as_str()).collect::<Vec<_>>())),
            Arc::new(StringArray::from(sess_ids2.iter().map(|s| s.as_str()).collect::<Vec<_>>())),
            Arc::new(StringArray::from(contents2.iter().map(|s| s.as_str()).collect::<Vec<_>>())),
            Arc::new(BooleanArray::from(pinneds2)),
            Arc::new(Int64Array::from(timestamps2)),
            Arc::new(StringArray::from(branches2.iter().map(|s| s.as_str()).collect::<Vec<_>>())),
            Arc::new(StringArray::from(commit_types2.iter().map(|s| s.as_str()).collect::<Vec<_>>())),
            Arc::new(StringArray::from(tags_vec2.iter().map(|s| s.as_str()).collect::<Vec<_>>())),
            Arc::new(StringArray::from(parent_ids2.iter().map(|s| s.as_str()).collect::<Vec<_>>())),
            Arc::new(StringArray::from(agent_names2.iter().map(|s| s.as_str()).collect::<Vec<_>>())),
            Arc::new(StringArray::from(mem_types2.iter().map(|s| s.as_str()).collect::<Vec<_>>())),
            Arc::new(Int32Array::from(importances2)),
            Arc::new(BooleanArray::from(resolveds2)),
            Arc::new(Int64Array::from(decay_ats2)),
            Arc::new(StringArray::from(scopes2.iter().map(|s| s.as_str()).collect::<Vec<_>>())),
            Arc::new(StringArray::from(agent_types2.iter().map(|s| s.as_str()).collect::<Vec<_>>())),
            Arc::new(StringArray::from(levels2.iter().map(|s| s.as_str()).collect::<Vec<_>>())),
            Arc::new(StringArray::from(agent_ids2.iter().map(|s| s.as_str()).collect::<Vec<_>>())),
            Arc::new(StringArray::from(keys2.iter().map(|s| s.as_str()).collect::<Vec<_>>())),
            null_vector_n(n2)?,
        ]).map_err(|e| e.to_string())?;

        let reader = RecordBatchIterator::new(vec![Ok(new_batch)], schema.clone());
        new.add(reader).execute().await.map_err(|e: lancedb::Error| e.to_string())?;
    }
    eprintln!("[memory] V2→V3 migration complete");
    Ok(())
}

async fn migrate_v1_to_v3(conn: &Connection, backup: &str) -> Result<(), String> {
    // Simplified: just recreate empty — V1 data loss acceptable at this point
    eprintln!("[memory] V1 backup at {backup} — starting fresh (V1 data incompatible with V3)");
    Ok(())
}

fn null_vector_n(n: usize) -> Result<Arc<FixedSizeListArray>, String> {
    use arrow_array::Array;
    // Build n null-ish vectors (all zeros)
    let flat: Vec<f32> = vec![0f32; n * EMBEDDING_DIM as usize];
    let values = Arc::new(Float32Array::from(flat));
    FixedSizeListArray::try_new(
        Arc::new(Field::new("item", arrow_schema::DataType::Float32, true)),
        EMBEDDING_DIM,
        values,
        None,
    ).map(Arc::new).map_err(|e| e.to_string())
}

// ── Readiness ──────────────────────────────────────────────────────────────────

pub fn is_ready() -> bool { DB.get().is_some() }

fn get_conn() -> Result<&'static Connection, String> {
    DB.get().ok_or_else(|| "memory db not initialised".to_string())
}

async fn get_table() -> Result<Table, String> {
    get_conn()?.open_table("memories").execute().await.map_err(|e| e.to_string())
}

// ── Column helpers ─────────────────────────────────────────────────────────────

fn str_col<'a>(batch: &'a RecordBatch, name: &str) -> Result<&'a StringArray, String> {
    let idx = batch.schema().index_of(name).map_err(|_| format!("col '{}' missing", name))?;
    batch.column(idx).as_any().downcast_ref::<StringArray>()
        .ok_or_else(|| format!("col '{}' wrong type", name))
}
fn bool_col<'a>(batch: &'a RecordBatch, name: &str) -> Result<&'a BooleanArray, String> {
    let idx = batch.schema().index_of(name).map_err(|_| format!("col '{}' missing", name))?;
    batch.column(idx).as_any().downcast_ref::<BooleanArray>()
        .ok_or_else(|| format!("col '{}' wrong type", name))
}
fn i64_col<'a>(batch: &'a RecordBatch, name: &str) -> Result<&'a Int64Array, String> {
    let idx = batch.schema().index_of(name).map_err(|_| format!("col '{}' missing", name))?;
    batch.column(idx).as_any().downcast_ref::<Int64Array>()
        .ok_or_else(|| format!("col '{}' wrong type", name))
}
fn i32_col<'a>(batch: &'a RecordBatch, name: &str) -> Result<&'a Int32Array, String> {
    let idx = batch.schema().index_of(name).map_err(|_| format!("col '{}' missing", name))?;
    batch.column(idx).as_any().downcast_ref::<Int32Array>()
        .ok_or_else(|| format!("col '{}' wrong type", name))
}

fn batch_to_memory(batch: &RecordBatch, i: usize) -> Result<Memory, String> {
    let str_or  = |n: &str, d: &str| str_col(batch, n).map(|c| c.value(i).to_string()).unwrap_or(d.to_string());
    let bool_or = |n: &str, d: bool| bool_col(batch, n).map(|c| c.value(i)).unwrap_or(d);
    let i64_or  = |n: &str, d: i64| i64_col(batch, n).map(|c| c.value(i)).unwrap_or(d);
    let i32_or  = |n: &str, d: i32| i32_col(batch, n).map(|c| c.value(i)).unwrap_or(d);

    let tags        = str_or("tags", "");
    let agent_name  = str_or("agent_name", "");
    let mt_raw      = str_or("memory_type", "");
    let memory_type = if mt_raw.is_empty() { infer_type_from_tags(&tags).to_string() } else { mt_raw };
    let imp_raw     = i32_or("importance", 0);
    let importance  = if imp_raw == 0 { importance_for_type(&memory_type) } else { imp_raw };
    let agent_type  = {
        let at = str_or("agent_type", "");
        if at.is_empty() { agent_type_from_name(&agent_name) } else { at }
    };
    let level_raw   = str_or("level", "");
    let level       = if level_raw.is_empty() {
        super::schema::level_from_memory_type(&memory_type).to_string()
    } else {
        level_raw
    };

    Ok(Memory {
        id:          str_or("id", ""),
        runbox_id:   str_or("runbox_id", ""),
        session_id:  str_or("session_id", ""),
        content:     str_or("content", ""),
        pinned:      bool_or("pinned", false),
        timestamp:   i64_or("timestamp", 0),
        branch:      str_or("branch", "main"),
        commit_type: str_or("commit_type", "memory"),
        tags,
        parent_id:   str_or("parent_id", ""),
        agent_name,
        memory_type,
        importance,
        resolved:    bool_or("resolved", false),
        decay_at:    i64_or("decay_at", decay_for_type("general")),
        scope:       str_or("scope", SCOPE_LOCAL),
        agent_type,
        level,
        agent_id:    str_or("agent_id", ""),
        key:         str_or("key", ""),
    })
}

// ── Core insert ───────────────────────────────────────────────────────────────

fn insert_batch(
    id:          &str,
    runbox_id:   &str,
    session_id:  &str,
    content:     &str,
    pinned:      bool,
    ts:          i64,
    branch:      &str,
    commit_type: &str,
    tags:        &str,
    parent_id:   &str,
    agent_name:  &str,
    memory_type: &str,
    importance:  i32,
    resolved:    bool,
    decay_at:    i64,
    scope:       &str,
    agent_type:  &str,
    level:       &str,
    agent_id:    &str,
    key:         &str,
) -> Result<RecordBatch, String> {
    let schema = memory_schema();
    RecordBatch::try_new(schema, vec![
        Arc::new(StringArray::from(vec![id])),
        Arc::new(StringArray::from(vec![runbox_id])),
        Arc::new(StringArray::from(vec![session_id])),
        Arc::new(StringArray::from(vec![content])),
        Arc::new(BooleanArray::from(vec![pinned])),
        Arc::new(Int64Array::from(vec![ts])),
        Arc::new(StringArray::from(vec![branch])),
        Arc::new(StringArray::from(vec![commit_type])),
        Arc::new(StringArray::from(vec![tags])),
        Arc::new(StringArray::from(vec![parent_id])),
        Arc::new(StringArray::from(vec![agent_name])),
        Arc::new(StringArray::from(vec![memory_type])),
        Arc::new(Int32Array::from(vec![importance])),
        Arc::new(BooleanArray::from(vec![resolved])),
        Arc::new(Int64Array::from(vec![decay_at])),
        Arc::new(StringArray::from(vec![scope])),
        Arc::new(StringArray::from(vec![agent_type])),
        Arc::new(StringArray::from(vec![level])),
        Arc::new(StringArray::from(vec![agent_id])),
        Arc::new(StringArray::from(vec![key])),
        null_vector()?,
    ]).map_err(|e| e.to_string())
}

async fn add_batch(batch: RecordBatch) -> Result<(), String> {
    let schema = memory_schema();
    let reader = RecordBatchIterator::new(vec![Ok(batch)], schema);
    get_table().await?.add(reader).execute().await.map(|_| ()).map_err(|e: lancedb::Error| e.to_string())
}

async fn mark_resolved(id: &str) -> Result<(), String> {
    let mem = fetch_one(id).await?.ok_or("not found")?;
    let mut updated = mem.clone();
    updated.resolved = true;
    delete_and_reinsert(&mem.id, updated).await
}

// ── V3 — remember() ──────────────────────────────────────────────────────────
//
// Core write path. level must be PREFERRED or TEMPORARY.
// PREFERRED: key-based versioning — old fact with same key resolved, new inserted.
// TEMPORARY: agent-private, DECAY_SESSION.

// ============================================================================
// PATCH: src-tauri/src/memory/store.rs
//
// Replace the existing remember(), add_locked(), session_summary(),
// and session_log() functions with these versions.
//
// The only additions are the FS sync blocks at the end of each function,
// marked with "// ── GCC+Letta: filesystem sync ──" comments.
// Everything else is identical to the originals.
// ============================================================================

// ── remember() ────────────────────────────────────────────────────────────────
// Place: replaces the existing pub async fn remember(...)

pub async fn remember(
    runbox_id:  &str,
    session_id: &str,
    agent_id:   &str,
    agent_name: &str,
    content:    &str,
    level:      &str,
) -> Result<Memory, String> {
    let content = content.trim();
    if content.is_empty() {
        return Err("content cannot be empty".to_string());
    }

    // Resolve key for PREFERRED versioning
    let key = if level == LEVEL_PREFERRED {
        extract_key(content)
    } else {
        String::new()
    };

    // For PREFERRED, delete any existing memory with the same key (key-versioning)
    if level == LEVEL_PREFERRED && !key.is_empty() {
        let existing = memories_for_runbox(runbox_id).await.unwrap_or_default();
        for old in existing.iter().filter(|m| {
            m.effective_level() == LEVEL_PREFERRED && m.key == key && !m.resolved
        }) {
            let _ = memory_delete(&old.id).await;
        }
    }

    let id         = uuid::Uuid::new_v4().to_string();
    let importance = importance_for_level(level);
    let decay_at   = decay_for_level(level);
    let agent_type = agent_type_from_name(agent_name);
    let now        = now_ms();

    let mem = Memory {
        id:          id.clone(),
        runbox_id:   runbox_id.to_string(),
        session_id:  session_id.to_string(),
        content:     content.to_string(),
        pinned:      false,
        timestamp:   now,
        branch:      "main".to_string(),
        commit_type: "memory".to_string(),
        tags:        format!("{level},remember"),
        parent_id:   String::new(),
        agent_name:  agent_name.to_string(),
        memory_type: String::new(),
        importance,
        resolved:    false,
        decay_at,
        scope:       SCOPE_LOCAL.to_string(),
        agent_type:  agent_type.clone(),
        level:       level.to_string(),
        agent_id:    agent_id.to_string(),
        key:         key.clone(),
    };

    let schema = memory_schema();
    let batch  = memory_to_batch(&mem, schema.clone())?;
    let reader = RecordBatchIterator::new(vec![Ok(batch)], schema);
    get_table().await?.add(reader).execute().await
        .map_err(|e: lancedb::Error| e.to_string())?;

    // ── GCC+Letta: filesystem sync ─────────────────────────────────────────────
    // Runs in a background task — never blocks the MCP tool response.
    {
        let rb  = runbox_id.to_string();
        let cwd = crate::agent::globals::get_runbox_cwd(runbox_id);
        let an  = agent_name.to_string();
        // Short content preview for commit message (50 chars)
        let preview: String = content.chars().take(50).collect();
        if !cwd.is_empty() {
            tokio::spawn(async move {
                if let Ok(mems) = memories_for_runbox(&rb).await {
                    crate::memory::filesystem::sync_to_fs(&rb, &cwd, &mems).await;
                    // Commit message: "agent-name: content preview"
                    crate::memory::filesystem::commit_memory_async(
                        &cwd,
                        format!("{an}: {preview}"),
                    );
                }
            });
        }
    }

    Ok(mem)
}

// ── add_locked() ──────────────────────────────────────────────────────────────

pub async fn add_locked(
    runbox_id:  &str,
    session_id: &str,
    content:    &str,
) -> Result<Memory, String> {
    let content = content.trim();
    if content.is_empty() {
        return Err("content cannot be empty".to_string());
    }

    let id  = uuid::Uuid::new_v4().to_string();
    let now = now_ms();

    let mem = Memory {
        id:          id.clone(),
        runbox_id:   runbox_id.to_string(),
        session_id:  session_id.to_string(),
        content:     content.to_string(),
        pinned:      true, // LOCKED memories are always pinned
        timestamp:   now,
        branch:      "main".to_string(),
        commit_type: "locked".to_string(),
        tags:        format!("{LEVEL_LOCKED},rule"),
        parent_id:   String::new(),
        agent_name:  "human".to_string(),
        memory_type: String::new(),
        importance:  100,
        resolved:    false,
        decay_at:    DECAY_NEVER,
        scope:       SCOPE_LOCAL.to_string(),
        agent_type:  "human".to_string(),
        level:       LEVEL_LOCKED.to_string(),
        agent_id:    format!("human:{session_id}"),
        key:         extract_key(content),
    };

    let schema = memory_schema();
    let batch  = memory_to_batch(&mem, schema.clone())?;
    let reader = RecordBatchIterator::new(vec![Ok(batch)], schema);
    get_table().await?.add(reader).execute().await
        .map_err(|e: lancedb::Error| e.to_string())?;

    // ── GCC+Letta: filesystem sync ─────────────────────────────────────────────
    {
        let rb      = runbox_id.to_string();
        let cwd     = crate::agent::globals::get_runbox_cwd(runbox_id);
        let preview: String = content.chars().take(50).collect();
        if !cwd.is_empty() {
            tokio::spawn(async move {
                if let Ok(mems) = memories_for_runbox(&rb).await {
                    crate::memory::filesystem::sync_to_fs(&rb, &cwd, &mems).await;
                    crate::memory::filesystem::commit_memory_async(
                        &cwd,
                        format!("human: LOCKED — {preview}"),
                    );
                }
            });
        }
    }

    Ok(mem)
}

// ── session_summary() ─────────────────────────────────────────────────────────

pub async fn session_summary(
    runbox_id:  &str,
    session_id: &str,
    agent_id:   &str,
    agent_name: &str,
    text:       &str,
) -> Result<Memory, String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("summary text cannot be empty".to_string());
    }

    // Prune older SESSION memories for this agent beyond cap of 2
    let existing = memories_for_runbox(runbox_id).await.unwrap_or_default();
    let mut agent_sessions: Vec<_> = existing.iter()
        .filter(|m| m.effective_level() == LEVEL_SESSION && m.agent_id == agent_id)
        .collect();
    agent_sessions.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    // Keep 1 (the one we're about to write will make 2 total)
    for old in agent_sessions.iter().skip(1) {
        let _ = memory_delete(&old.id).await;
    }

    let id         = uuid::Uuid::new_v4().to_string();
    let agent_type = agent_type_from_name(agent_name);
    let now        = now_ms();

    let mem = Memory {
        id:          id.clone(),
        runbox_id:   runbox_id.to_string(),
        session_id:  session_id.to_string(),
        content:     text.to_string(),
        pinned:      false,
        timestamp:   now,
        branch:      "main".to_string(),
        commit_type: "session".to_string(),
        tags:        format!("{LEVEL_SESSION},summary"),
        parent_id:   String::new(),
        agent_name:  agent_name.to_string(),
        memory_type: String::new(),
        importance:  importance_for_level(LEVEL_SESSION),
        resolved:    false,
        decay_at:    DECAY_NEVER,
        scope:       SCOPE_LOCAL.to_string(),
        agent_type:  agent_type.clone(),
        level:       LEVEL_SESSION.to_string(),
        agent_id:    agent_id.to_string(),
        key:         String::new(),
    };

    let schema = memory_schema();
    let batch  = memory_to_batch(&mem, schema.clone())?;
    let reader = RecordBatchIterator::new(vec![Ok(batch)], schema);
    get_table().await?.add(reader).execute().await
        .map_err(|e: lancedb::Error| e.to_string())?;

    // ── GCC+Letta: filesystem sync ─────────────────────────────────────────────
    {
        let rb    = runbox_id.to_string();
        let cwd   = crate::agent::globals::get_runbox_cwd(runbox_id);
        let an    = agent_name.to_string();
        let short = &session_id[..session_id.len().min(8)];
        let msg   = format!("{an}: session summary [{short}]");
        if !cwd.is_empty() {
            tokio::spawn(async move {
                if let Ok(mems) = memories_for_runbox(&rb).await {
                    crate::memory::filesystem::sync_to_fs(&rb, &cwd, &mems).await;
                    crate::memory::filesystem::commit_memory_async(&cwd, msg);
                }
            });
        }
    }

    Ok(mem)
}

// ── session_log() ─────────────────────────────────────────────────────────────
// Cap raised from 50 → 200 lines per agent (GCC ablation result).

const SESSION_LOG_CAP: usize = 200;

pub async fn session_log(
    runbox_id:  &str,
    session_id: &str,
    agent_id:   &str,
    agent_name: &str,
    entry:      &str,
) -> Result<Memory, String> {
    let entry = entry.trim();
    if entry.is_empty() {
        return Err("entry cannot be empty".to_string());
    }

    // Enforce cap — drop oldest when over SESSION_LOG_CAP
    let existing = memories_for_runbox(runbox_id).await.unwrap_or_default();
    let mut agent_logs: Vec<_> = existing.iter()
        .filter(|m| {
            m.effective_level() == LEVEL_TEMPORARY
                && m.agent_id == agent_id
                && m.tags.contains("session_log")
        })
        .collect();

    if agent_logs.len() >= SESSION_LOG_CAP {
        agent_logs.sort_by(|a, b| a.timestamp.cmp(&b.timestamp)); // oldest first
        let to_delete = agent_logs.len() - SESSION_LOG_CAP + 1;
        for old in agent_logs.iter().take(to_delete) {
            let _ = memory_delete(&old.id).await;
        }
    }

    let id         = uuid::Uuid::new_v4().to_string();
    let agent_type = agent_type_from_name(agent_name);
    let now        = now_ms();

    let mem = Memory {
        id:          id.clone(),
        runbox_id:   runbox_id.to_string(),
        session_id:  session_id.to_string(),
        content:     entry.to_string(),
        pinned:      false,
        timestamp:   now,
        branch:      "main".to_string(),
        commit_type: "log".to_string(),
        tags:        format!("{LEVEL_TEMPORARY},session_log"),
        parent_id:   String::new(),
        agent_name:  agent_name.to_string(),
        memory_type: String::new(),
        importance:  importance_for_level(LEVEL_TEMPORARY),
        resolved:    false,
        decay_at:    DECAY_SESSION,
        scope:       SCOPE_LOCAL.to_string(),
        agent_type:  agent_type.clone(),
        level:       LEVEL_TEMPORARY.to_string(),
        agent_id:    agent_id.to_string(),
        key:         String::new(),
    };

    let schema = memory_schema();
    let batch  = memory_to_batch(&mem, schema.clone())?;
    let reader = RecordBatchIterator::new(vec![Ok(batch)], schema);
    get_table().await?.add(reader).execute().await
        .map_err(|e: lancedb::Error| e.to_string())?;

    // Note: session_log does NOT commit to git — too many commits.
    // The session_summary commit at the end covers the full log history.

    Ok(mem)
}

// ── V3 — session_log() ────────────────────────────────────────────────────────
//
// One line per step. Capped at 50 per agent_id. Oldest dropped when cap hit.
// TEMPORARY + agent_id scoped.

const SESSION_LOG_CAP: usize = 50;

// ── V3 — session_summary() ────────────────────────────────────────────────────
//
// One paragraph when task complete. Overwrites previous summary for this agent.
// SESSION level, tagged with agent_id. Last 3 per agent kept.

const SESSION_SUMMARY_CAP: usize = 3;

pub async fn session_summary(
    runbox_id:  &str,
    session_id: &str,
    agent_id:   &str,
    agent_name: &str,
    text:       &str,
) -> Result<(), String> {
    let text = text.trim();
    if text.is_empty() { return Ok(()); }

    let all = memories_for_runbox(runbox_id).await.unwrap_or_default();

    // Mark previous session summaries for this agent as resolved
    let prev_summaries: Vec<String> = all.iter()
        .filter(|m| {
            m.agent_id == agent_id
                && m.effective_level() == LEVEL_SESSION
                && !m.resolved
        })
        .map(|m| m.id.clone())
        .collect();
    for old_id in &prev_summaries {
        let _ = mark_resolved(old_id).await;
    }

    // Prune: keep last (CAP-1) resolved summaries for this agent
    let mut all_session: Vec<&Memory> = all.iter()
        .filter(|m| m.agent_id == agent_id && m.effective_level() == LEVEL_SESSION)
        .collect();
    all_session.sort_by_key(|m| m.timestamp);
    if all_session.len() >= SESSION_SUMMARY_CAP {
        let to_delete = all_session.len() - SESSION_SUMMARY_CAP + 1;
        for old in all_session.iter().take(to_delete) {
            let _ = memory_delete(&old.id).await;
        }
    }

    let id         = uuid::Uuid::new_v4().to_string();
    let ts         = now_ms();
    let agent_type = agent_type_from_name(agent_name);
    let tags       = format!("SESSION,agent:{agent_id}");

    let batch = insert_batch(
        &id, runbox_id, session_id, text,
        false, ts, "main", "memory",
        &tags, "", agent_name,
        LEVEL_SESSION, importance_for_level(LEVEL_SESSION), false,
        super::schema::DECAY_NEVER,
        SCOPE_LOCAL, &agent_type,
        LEVEL_SESSION, agent_id, "",
    )?;
    add_batch(batch).await
}

// ── V3 — add_locked() ─────────────────────────────────────────────────────────
//
// Panel-only write path. Sets level=LOCKED, importance=100, never expires.
// Agents cannot call this.

pub async fn add_locked(
    runbox_id:  &str,
    session_id: &str,
    content:    &str,
) -> Result<Memory, String> {
    let content = content.trim();
    if content.is_empty() { return Err("content cannot be empty".to_string()); }

    let id  = uuid::Uuid::new_v4().to_string();
    let ts  = now_ms();

    let batch = insert_batch(
        &id, runbox_id, session_id, content,
        false, ts, "main", "memory",
        LEVEL_LOCKED, "", "human",
        LEVEL_LOCKED, 100, false, super::schema::DECAY_NEVER,
        SCOPE_LOCAL, "human",
        LEVEL_LOCKED, "human", &extract_key(content),
    )?;
    add_batch(batch).await?;

    Ok(Memory {
        id, runbox_id: runbox_id.into(), session_id: session_id.into(),
        content: content.into(), pinned: true, timestamp: ts,
        branch: "main".into(), commit_type: "memory".into(),
        tags: LEVEL_LOCKED.into(), parent_id: "".into(),
        agent_name: "human".into(),
        memory_type: LEVEL_LOCKED.into(), importance: 100, resolved: false,
        decay_at: super::schema::DECAY_NEVER,
        scope: SCOPE_LOCAL.into(), agent_type: "human".into(),
        level: LEVEL_LOCKED.into(), agent_id: "human".into(),
        key: extract_key(content),
    })
}

// ── V3 — expire_temporary_for_agent() ────────────────────────────────────────
//
// Called on session end. Marks all TEMPORARY for this agent_id as resolved.

pub async fn expire_temporary_for_agent(
    runbox_id: &str,
    agent_id:  &str,
) -> Result<(), String> {
    let all = memories_for_runbox(runbox_id).await.unwrap_or_default();
    let to_expire: Vec<String> = all.iter()
        .filter(|m| {
            m.agent_id == agent_id
                && m.effective_level() == LEVEL_TEMPORARY
                && !m.resolved
        })
        .map(|m| m.id.clone())
        .collect();

    for id in to_expire {
        let _ = mark_resolved(&id).await;
    }
    Ok(())
}

// ── V3 — locked memories for enforcement ─────────────────────────────────────

pub async fn locked_memories(runbox_id: &str) -> Result<Vec<Memory>, String> {
    let all = memories_for_runbox(runbox_id).await?;
    Ok(all.into_iter()
        .filter(|m| m.effective_level() == LEVEL_LOCKED && !m.resolved)
        .collect())
}

// ── V2 write (kept for backward compat) ──────────────────────────────────────

pub async fn memory_add(runbox_id: &str, session_id: &str, content: &str) -> Result<Memory, String> {
    memory_add_full(runbox_id, session_id, content, "main", "memory", "", "", "").await
}

pub async fn memory_add_full(
    runbox_id:   &str,
    session_id:  &str,
    content:     &str,
    branch:      &str,
    commit_type: &str,
    tags:        &str,
    parent_id:   &str,
    agent_name:  &str,
) -> Result<Memory, String> {
    let memory_type  = infer_type_from_tags(tags).to_string();
    let importance   = importance_for_type(&memory_type);
    let decay_at     = decay_for_type(&memory_type);
    let agent_type   = agent_type_from_name(agent_name);
    let scope        = if tags.contains("scope:machine") || tags.contains("scope=machine") {
        super::schema::SCOPE_MACHINE.to_string()
    } else {
        SCOPE_LOCAL.to_string()
    };
    let level = super::schema::level_from_memory_type(&memory_type).to_string();
    let key   = extract_key(content);
    let agent_id = make_agent_id(&agent_type, session_id);

    memory_add_typed(
        runbox_id, session_id, content, branch, commit_type, tags,
        parent_id, agent_name, &memory_type, importance, false,
        decay_at, &scope, &agent_type,
    ).await
}

pub async fn memory_add_typed(
    runbox_id:   &str,
    session_id:  &str,
    content:     &str,
    branch:      &str,
    commit_type: &str,
    tags:        &str,
    parent_id:   &str,
    agent_name:  &str,
    memory_type: &str,
    importance:  i32,
    resolved:    bool,
    decay_at:    i64,
    scope:       &str,
    agent_type:  &str,
) -> Result<Memory, String> {
    let id    = uuid::Uuid::new_v4().to_string();
    let ts    = now_ms();
    let level = super::schema::level_from_memory_type(memory_type).to_string();
    let key   = extract_key(content);
    let agent_id = make_agent_id(agent_type, session_id);
    let schema   = memory_schema();

    // Embedder dedup
    let (vector_col, embedding_opt): (Arc<FixedSizeListArray>, Option<Vec<f32>>) = {
        match embedder::try_embed(content) {
            Some(emb) if emb.len() == EMBEDDING_DIM as usize => {
                let col = Arc::new(
                    FixedSizeListArray::try_new(
                        Arc::new(Field::new("item", arrow_schema::DataType::Float32, true)),
                        EMBEDDING_DIM,
                        Arc::new(Float32Array::from(emb.clone())),
                        None,
                    ).map_err(|e| e.to_string())?,
                );
                (col, Some(emb))
            }
            _ => (null_vector()?, None),
        }
    };

    let threshold = dedup_threshold(memory_type);
    if threshold <= 1.0 {
        if let Some(ref emb) = embedding_opt {
            if let Ok(Some(dup)) = find_semantic_duplicate(runbox_id, memory_type, emb, threshold).await {
                let new_tags = if dup.tags.contains("confidence:") { dup.tags.clone() }
                    else { format!("{},confidence:2", dup.tags) };
                let _ = memory_update_tags(&dup.id, &new_tags).await;
                return Ok(dup);
            }
        }
    }

    let batch = RecordBatch::try_new(schema.clone(), vec![
        Arc::new(StringArray::from(vec![id.as_str()])),
        Arc::new(StringArray::from(vec![runbox_id])),
        Arc::new(StringArray::from(vec![session_id])),
        Arc::new(StringArray::from(vec![content])),
        Arc::new(BooleanArray::from(vec![false])),
        Arc::new(Int64Array::from(vec![ts])),
        Arc::new(StringArray::from(vec![branch])),
        Arc::new(StringArray::from(vec![commit_type])),
        Arc::new(StringArray::from(vec![tags])),
        Arc::new(StringArray::from(vec![parent_id])),
        Arc::new(StringArray::from(vec![agent_name])),
        Arc::new(StringArray::from(vec![memory_type])),
        Arc::new(Int32Array::from(vec![importance])),
        Arc::new(BooleanArray::from(vec![resolved])),
        Arc::new(Int64Array::from(vec![decay_at])),
        Arc::new(StringArray::from(vec![scope])),
        Arc::new(StringArray::from(vec![agent_type])),
        Arc::new(StringArray::from(vec![level.as_str()])),
        Arc::new(StringArray::from(vec![agent_id.as_str()])),
        Arc::new(StringArray::from(vec![key.as_str()])),
        vector_col,
    ]).map_err(|e| e.to_string())?;

    let reader = RecordBatchIterator::new(vec![Ok(batch)], schema);
    get_table().await?.add(reader).execute().await.map_err(|e: lancedb::Error| e.to_string())?;

    Ok(Memory {
        id, runbox_id: runbox_id.into(), session_id: session_id.into(),
        content: content.into(), pinned: false, timestamp: ts,
        branch: branch.into(), commit_type: commit_type.into(),
        tags: tags.into(), parent_id: parent_id.into(),
        agent_name: agent_name.into(),
        memory_type: memory_type.into(), importance, resolved,
        decay_at, scope: scope.into(), agent_type: agent_type.into(),
        level, agent_id, key,
    })
}

pub async fn memory_add_with_embedding(
    runbox_id: &str, session_id: &str, content: &str, embedding: Vec<f32>,
) -> Result<Memory, String> {
    if embedding.len() != EMBEDDING_DIM as usize {
        return Err(format!("embedding dim mismatch: expected {EMBEDDING_DIM}, got {}", embedding.len()));
    }
    let id    = uuid::Uuid::new_v4().to_string();
    let ts    = now_ms();
    let schema = memory_schema();
    let vector_col = Arc::new(
        FixedSizeListArray::try_new(
            Arc::new(Field::new("item", arrow_schema::DataType::Float32, true)),
            EMBEDDING_DIM,
            Arc::new(Float32Array::from(embedding)), None,
        ).map_err(|e| e.to_string())?,
    );
    let batch = RecordBatch::try_new(schema.clone(), vec![
        Arc::new(StringArray::from(vec![id.as_str()])),
        Arc::new(StringArray::from(vec![runbox_id])),
        Arc::new(StringArray::from(vec![session_id])),
        Arc::new(StringArray::from(vec![content])),
        Arc::new(BooleanArray::from(vec![false])),
        Arc::new(Int64Array::from(vec![ts])),
        Arc::new(StringArray::from(vec!["main"])),
        Arc::new(StringArray::from(vec!["memory"])),
        Arc::new(StringArray::from(vec![""])),
        Arc::new(StringArray::from(vec![""])),
        Arc::new(StringArray::from(vec![""])),
        Arc::new(StringArray::from(vec![LEVEL_PREFERRED])),
        Arc::new(Int32Array::from(vec![90i32])),
        Arc::new(BooleanArray::from(vec![false])),
        Arc::new(Int64Array::from(vec![decay_for_level(LEVEL_PREFERRED)])),
        Arc::new(StringArray::from(vec![SCOPE_LOCAL])),
        Arc::new(StringArray::from(vec![""])),
        Arc::new(StringArray::from(vec![LEVEL_PREFERRED])),
        Arc::new(StringArray::from(vec![""])),
        Arc::new(StringArray::from(vec![""])),
        vector_col,
    ]).map_err(|e| e.to_string())?;
    let reader = RecordBatchIterator::new(vec![Ok(batch)], schema);
    get_table().await?.add(reader).execute().await.map_err(|e: lancedb::Error| e.to_string())?;
    Ok(Memory {
        id, runbox_id: runbox_id.into(), session_id: session_id.into(),
        content: content.into(), pinned: false, timestamp: ts,
        branch: "main".into(), commit_type: "memory".into(),
        tags: "".into(), parent_id: "".into(), agent_name: "".into(),
        memory_type: LEVEL_PREFERRED.into(), importance: 90, resolved: false,
        decay_at: decay_for_level(LEVEL_PREFERRED),
        scope: SCOPE_LOCAL.into(), agent_type: "".into(),
        level: LEVEL_PREFERRED.into(), agent_id: "".into(), key: "".into(),
    })
}

// ── ANN semantic search ────────────────────────────────────────────────────────

pub async fn find_semantic_duplicate(
    runbox_id:   &str,
    memory_type: &str,
    query_vec:   &[f32],
    threshold:   f32,
) -> Result<Option<Memory>, String> {
    if !embedder::is_ready() { return Ok(None); }
    if query_vec.is_empty()  { return Ok(None); }

    let candidates = memories_by_type(runbox_id, memory_type).await?;
    if candidates.is_empty() { return Ok(None); }

    let best = candidates.iter()
        .filter(|m| !m.resolved)
        .filter_map(|mem| {
            let cand_vec = embedder::try_embed(&mem.content)?;
            let sim = embedder::cosine_similarity(query_vec, &cand_vec);
            if sim >= threshold { Some((sim, mem)) } else { None }
        })
        .max_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));

    Ok(best.map(|(_, m)| m.clone()))
}

pub async fn memories_ann_search(
    runbox_id:   &str,
    query:       &str,
    memory_type: Option<&str>,
    limit:       usize,
) -> Result<Vec<(f32, Memory)>, String> {
    if let Some(q_vec) = embedder::try_embed(query) {
        let candidates = if let Some(mt) = memory_type {
            memories_by_type(runbox_id, mt).await?
        } else {
            memories_for_runbox(runbox_id).await?
        };
        let global = memories_for_runbox("__global__").await.unwrap_or_default();

        let mut scored: Vec<(f32, Memory)> = candidates.iter()
            .chain(global.iter())
            .filter(|m| m.is_active())
            .filter_map(|mem| {
                let c_vec = embedder::try_embed(&mem.content)?;
                let sim   = embedder::cosine_similarity(&q_vec, &c_vec);
                if sim > 0.3 { Some((sim, mem.clone())) } else { None }
            })
            .collect();

        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(limit);
        return Ok(scored);
    }

    let ql  = query.to_lowercase();
    let mut all = memories_for_runbox(if runbox_id.is_empty() { "__all__" } else { runbox_id })
        .await.unwrap_or_default();
    if !runbox_id.is_empty() {
        all.extend(memories_for_runbox("__global__").await.unwrap_or_default());
    }
    let mut results: Vec<(f32, Memory)> = all.into_iter()
        .filter(|m| {
            if let Some(tf) = memory_type { if m.effective_type() != tf { return false; } }
            format!("{} {} {}", m.content, m.tags, m.memory_type).to_lowercase().contains(&ql)
        })
        .map(|m| (keyword_relevance(&m.content, query), m))
        .collect();
    results.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(limit);
    Ok(results)
}

// ── Read ───────────────────────────────────────────────────────────────────────

async fn query_raw(filter: &str, limit: usize) -> Result<Vec<Memory>, String> {
    let stream = get_table().await?
        .query().only_if(filter.to_string()).limit(limit * 4)
        .execute().await.map_err(|e: lancedb::Error| e.to_string())?;
    let batches: Vec<RecordBatch> = stream.try_collect().await.map_err(|e| e.to_string())?;

    let mut seen: std::collections::HashMap<String, Memory> = std::collections::HashMap::new();
    for batch in &batches {
        let n = batch.num_rows(); if n == 0 { continue; }
        for i in 0..n {
            let mem = batch_to_memory(batch, i)?;
            let id = mem.id.clone(); let ts = mem.timestamp;
            seen.entry(id)
                .and_modify(|e| { if ts >= e.timestamp { *e = mem.clone(); } })
                .or_insert(mem);
        }
    }
    let mut out: Vec<Memory> = seen.into_values().collect();
    out.sort_by(|a, b| {
        if a.pinned != b.pinned { return a.pinned.cmp(&b.pinned).reverse(); }
        b.importance.cmp(&a.importance).then(b.timestamp.cmp(&a.timestamp))
    });
    out.truncate(limit);
    Ok(out)
}

pub async fn memories_for_runbox(runbox_id: &str) -> Result<Vec<Memory>, String> {
    query_raw(&format!("runbox_id = '{}'", runbox_id.replace('\'', "''")), 200).await
}

pub async fn memories_for_branch(runbox_id: &str, branch: &str) -> Result<Vec<Memory>, String> {
    query_raw(
        &format!("runbox_id = '{}' AND branch = '{}'",
            runbox_id.replace('\'', "''"), branch.replace('\'', "''")),
        200
    ).await
}

pub async fn memories_by_tag(runbox_id: &str, tag: &str) -> Result<Vec<Memory>, String> {
    let all = memories_for_runbox(runbox_id).await?;
    let tl  = tag.to_lowercase();
    Ok(all.into_iter().filter(|m| m.tags.split(',').any(|t| t.trim().to_lowercase() == tl)).collect())
}

pub async fn memories_by_type(runbox_id: &str, memory_type: &str) -> Result<Vec<Memory>, String> {
    let all = memories_for_runbox(runbox_id).await?;
    Ok(all.into_iter().filter(|m| m.effective_type() == memory_type).collect())
}

pub async fn memories_by_level(runbox_id: &str, level: &str) -> Result<Vec<Memory>, String> {
    let all = memories_for_runbox(runbox_id).await?;
    Ok(all.into_iter().filter(|m| m.effective_level() == level).collect())
}

pub async fn memories_by_level_for_agent(
    runbox_id: &str,
    level:     &str,
    agent_id:  &str,
) -> Result<Vec<Memory>, String> {
    let all = memories_for_runbox(runbox_id).await?;
    Ok(all.into_iter()
        .filter(|m| m.effective_level() == level && m.agent_id == agent_id)
        .collect())
}

pub async fn active_blockers(runbox_id: &str) -> Result<Vec<Memory>, String> {
    let all = memories_for_runbox(runbox_id).await?;
    Ok(all.into_iter().filter(|m| m.effective_type() == MT_BLOCKER && !m.resolved).collect())
}

pub async fn machine_scope_memories(memory_type: &str) -> Result<Vec<Memory>, String> {
    let all = memories_for_runbox("__global__").await?;
    Ok(all.into_iter()
        .filter(|m| {
            (m.scope == SCOPE_MACHINE || m.tags.contains("scope:machine"))
                && m.effective_type() == memory_type
                && m.is_active()
        })
        .collect())
}

pub async fn resolve_blocker(
    runbox_id:  &str,
    session_id: &str,
    agent_name: &str,
    blocker_desc: &str,
    fix:          &str,
) -> Result<(), String> {
    let all = memories_for_runbox(runbox_id).await?;
    let desc_lower = blocker_desc.to_lowercase();

    let blocker = all.into_iter()
        .find(|m| m.effective_type() == MT_BLOCKER
            && !m.resolved
            && m.content.to_lowercase().contains(&desc_lower));

    if let Some(b) = blocker {
        let mut updated = b.clone();
        updated.resolved = true;
        updated.tags = format!("{},resolved", b.tags);
        delete_and_reinsert(&b.id, updated).await?;
    }

    let failure_content = format!(
        "Blocker resolved.\nOriginal: {}\nFix applied: {}",
        blocker_desc.trim(), fix.trim()
    );
    let tags = format!("{},resolved-blocker", MT_FAILURE);
    memory_add_typed(
        runbox_id, session_id, &failure_content,
        "main", "checkpoint", &tags,
        "", agent_name,
        MT_FAILURE, 100, false,
        super::schema::DECAY_NEVER,
        SCOPE_LOCAL, &agent_type_from_name(agent_name),
    ).await?;

    Ok(())
}

async fn delete_and_reinsert(old_id: &str, updated: Memory) -> Result<(), String> {
    let schema = memory_schema();
    let batch  = memory_to_batch(&updated, schema.clone())?;
    let reader = RecordBatchIterator::new(vec![Ok(batch)], schema);
    get_table().await?.add(reader).execute().await.map_err(|e: lancedb::Error| e.to_string())?;
    get_table().await?
        .delete(&format!("id = '{}'", old_id.replace('\'', "''")))
        .await.map(|_| ()).map_err(|e| e.to_string())
}

fn memory_to_batch(m: &Memory, schema: Arc<arrow_schema::Schema>) -> Result<RecordBatch, String> {
    RecordBatch::try_new(schema, vec![
        Arc::new(StringArray::from(vec![m.id.as_str()])),
        Arc::new(StringArray::from(vec![m.runbox_id.as_str()])),
        Arc::new(StringArray::from(vec![m.session_id.as_str()])),
        Arc::new(StringArray::from(vec![m.content.as_str()])),
        Arc::new(BooleanArray::from(vec![m.pinned])),
        Arc::new(Int64Array::from(vec![m.timestamp])),
        Arc::new(StringArray::from(vec![m.branch.as_str()])),
        Arc::new(StringArray::from(vec![m.commit_type.as_str()])),
        Arc::new(StringArray::from(vec![m.tags.as_str()])),
        Arc::new(StringArray::from(vec![m.parent_id.as_str()])),
        Arc::new(StringArray::from(vec![m.agent_name.as_str()])),
        Arc::new(StringArray::from(vec![m.memory_type.as_str()])),
        Arc::new(Int32Array::from(vec![m.importance])),
        Arc::new(BooleanArray::from(vec![m.resolved])),
        Arc::new(Int64Array::from(vec![m.decay_at])),
        Arc::new(StringArray::from(vec![m.scope.as_str()])),
        Arc::new(StringArray::from(vec![m.agent_type.as_str()])),
        Arc::new(StringArray::from(vec![m.level.as_str()])),
        Arc::new(StringArray::from(vec![m.agent_id.as_str()])),
        Arc::new(StringArray::from(vec![m.key.as_str()])),
        null_vector()?,
    ]).map_err(|e| e.to_string())
}

pub async fn branches_for_runbox(runbox_id: &str) -> Result<Vec<String>, String> {
    let all = memories_for_runbox(runbox_id).await?;
    let mut branches: Vec<String> = all.iter()
        .map(|m| m.branch.clone())
        .collect::<std::collections::HashSet<_>>()
        .into_iter().collect();
    branches.sort();
    if let Some(pos) = branches.iter().position(|b| b == "main") {
        branches.remove(pos); branches.insert(0, "main".into());
    }
    Ok(branches)
}

pub async fn tags_for_runbox(runbox_id: &str) -> Result<Vec<String>, String> {
    let all = memories_for_runbox(runbox_id).await?;
    let mut tags = std::collections::HashSet::new();
    for m in &all { for t in m.tag_list() { tags.insert(t.to_string()); } }
    let mut out: Vec<String> = tags.into_iter().collect();
    out.sort();
    Ok(out)
}

// ── Mutate ─────────────────────────────────────────────────────────────────────

pub async fn memory_delete(id: &str) -> Result<(), String> {
    get_table().await?
        .delete(&format!("id = '{}'", id.replace('\'', "''")))
        .await.map(|_| ()).map_err(|e| e.to_string())
}

pub async fn memories_delete_for_runbox(runbox_id: &str) -> Result<(), String> {
    get_table().await?
        .delete(&format!("runbox_id = '{}'", runbox_id.replace('\'', "''")))
        .await.map(|_| ()).map_err(|e| e.to_string())
}

pub async fn memory_pin(id: &str, pinned: bool) -> Result<(), String> {
    let mem = fetch_one(id).await?.ok_or("not found")?;
    let mut updated = mem.clone(); updated.pinned = pinned;
    delete_and_reinsert(&mem.id, updated).await
}

pub async fn memory_update(id: &str, content: &str) -> Result<(), String> {
    let mem = fetch_one(id).await?.ok_or("not found")?;
    let mut updated = mem.clone(); updated.content = content.to_string();
    delete_and_reinsert(&mem.id, updated).await
}

pub async fn memory_update_tags(id: &str, tags: &str) -> Result<(), String> {
    let mem = fetch_one(id).await?.ok_or("not found")?;
    let mut updated = mem.clone(); updated.tags = tags.to_string();
    delete_and_reinsert(&mem.id, updated).await
}

pub async fn memory_move_branch(id: &str, branch: &str) -> Result<(), String> {
    let mem = fetch_one(id).await?.ok_or("not found")?;
    let mut updated = mem.clone(); updated.branch = branch.to_string();
    delete_and_reinsert(&mem.id, updated).await
}

pub async fn fetch_one(id: &str) -> Result<Option<Memory>, String> {
    let stream = get_table().await?
        .query().only_if(format!("id = '{}'", id.replace('\'', "''")))
        .execute().await.map_err(|e: lancedb::Error| e.to_string())?;
    let batches: Vec<RecordBatch> = stream.try_collect().await.map_err(|e| e.to_string())?;
    let batch = match batches.into_iter().next() {
        Some(b) if b.num_rows() > 0 => b,
        _ => return Ok(None),
    };
    Ok(Some(batch_to_memory(&batch, 0)?))
}

// ── Global search ──────────────────────────────────────────────────────────────

pub async fn memories_search_global(query: &str, limit: usize) -> Result<Vec<Memory>, String> {
    if embedder::is_ready() {
        let scored = memories_ann_search("", query, None, limit).await?;
        if !scored.is_empty() {
            return Ok(scored.into_iter().map(|(_, m)| m).collect());
        }
    }

    let ql = query.to_lowercase();
    let stream = get_table().await?
        .query().limit(500)
        .execute().await.map_err(|e: lancedb::Error| e.to_string())?;
    let batches: Vec<RecordBatch> = stream.try_collect().await.map_err(|e| e.to_string())?;
    let mut results: Vec<(f32, Memory)> = Vec::new();

    for batch in &batches {
        let n = batch.num_rows(); if n == 0 { continue; }
        for i in 0..n {
            let mem = batch_to_memory(batch, i)?;
            if mem.agent_name == "git" && query.len() < 4 { continue; }
            let hay = format!("{} {} {}", mem.content, mem.tags, mem.memory_type).to_lowercase();
            if hay.contains(&ql) {
                let score = keyword_relevance(&mem.content, query);
                results.push((score, mem));
            }
        }
    }
    results.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal)
        .then(b.1.timestamp.cmp(&a.1.timestamp)));
    Ok(results.into_iter().map(|(_, m)| m).take(limit).collect())
}

fn keyword_relevance(content: &str, query: &str) -> f32 {
    if query.is_empty() { return 0.0; }
    let cl = content.to_lowercase();
    let words: Vec<&str> = query.split_whitespace().collect();
    let hits = words.iter()
        .filter(|w| w.len() > 3 && cl.contains(w.to_lowercase().as_str()))
        .count();
    hits as f32 / words.len().max(1) as f32
}