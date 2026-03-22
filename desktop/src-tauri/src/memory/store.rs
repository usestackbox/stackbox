// src-tauri/src/memory/store.rs
// Supercontext V2 store — adds V2 fields via migration, new query functions.

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
    decay_for_type, importance_for_type, agent_type_from_name,
    infer_type_from_tags, dedup_threshold, now_ms,
};
use crate::agent::embedder;

static DB: OnceCell<Connection> = OnceCell::const_new();

fn db_dir() -> String {
    dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("stackbox").join("memory")
        .to_string_lossy().to_string()
}

// ── Init + migration ──────────────────────────────────────────────────────────

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

            let needs_v2 = !fields.contains(&"memory_type")
                || !fields.contains(&"importance")
                || !fields.contains(&"resolved")
                || !fields.contains(&"decay_at")
                || !fields.contains(&"scope")
                || !fields.contains(&"agent_type");

            // V1→V2: rename old table, recreate with V2 schema, migrate rows
            if needs_v2 || !fields.contains(&"branch") || !fields.contains(&"agent_name") {
                let backup = "memories_v1";
                eprintln!("[memory] migrating V1→V2 schema — backing up as {backup}");
                conn.rename_table("memories", backup).await.ok();
                create_empty_table(&conn).await?;
                if let Err(e) = migrate_v1_to_v2(&conn, backup).await {
                    eprintln!("[memory] V2 migration warning (old data in {backup}): {e}");
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

async fn migrate_v1_to_v2(conn: &Connection, backup: &str) -> Result<(), String> {
    let old    = conn.open_table(backup).execute().await.map_err(|e| e.to_string())?;
    let new    = conn.open_table("memories").execute().await.map_err(|e| e.to_string())?;
    let schema = memory_schema();

    let stream  = old.query().execute().await.map_err(|e: lancedb::Error| e.to_string())?;
    let batches: Vec<RecordBatch> = stream.try_collect().await.map_err(|e| e.to_string())?;

    for batch in &batches {
        let n = batch.num_rows(); if n == 0 { continue; }
        let bs = batch.schema();
        let fnames: Vec<&str> = bs.fields().iter().map(|f| f.name().as_str()).collect();

        let get_str = |name: &str, fallback: &'static str| -> Vec<String> {
            if fnames.contains(&name) {
                if let Ok(col) = str_col(batch, name) {
                    return (0..n).map(|i| col.value(i).to_string()).collect();
                }
            }
            vec![fallback.to_string(); n]
        };

        let ids         = get_str("id", "");
        let runbox_ids  = get_str("runbox_id", "");
        let sess_ids    = get_str("session_id", "");
        let contents    = get_str("content", "");
        let branches    = get_str("branch", "main");
        let commit_types = get_str("commit_type", "memory");
        let tags_vec    = get_str("tags", "");
        let parent_ids  = get_str("parent_id", "");
        let agent_names = get_str("agent_name", "");

        let pinneds: Vec<bool> = if fnames.contains(&"pinned") {
            bool_col(batch, "pinned").map(|c| (0..n).map(|i| c.value(i)).collect()).unwrap_or(vec![false; n])
        } else { vec![false; n] };

        let timestamps: Vec<i64> = if fnames.contains(&"timestamp") {
            i64_col(batch, "timestamp").map(|c| (0..n).map(|i| c.value(i)).collect()).unwrap_or(vec![0; n])
        } else { vec![0; n] };

        // Derive V2 fields from V1 tags
        let memory_types: Vec<String> = tags_vec.iter()
            .map(|t| infer_type_from_tags(t).to_string()).collect();
        let importances: Vec<i32> = memory_types.iter()
            .map(|mt| importance_for_type(mt)).collect();
        let decay_ats: Vec<i64> = memory_types.iter()
            .map(|mt| decay_for_type(mt)).collect();
        let agent_types: Vec<String> = agent_names.iter()
            .map(|an| agent_type_from_name(an)).collect();

        let new_batch = RecordBatch::try_new(schema.clone(), vec![
            Arc::new(StringArray::from(ids.iter().map(|s| s.as_str()).collect::<Vec<_>>())),
            Arc::new(StringArray::from(runbox_ids.iter().map(|s| s.as_str()).collect::<Vec<_>>())),
            Arc::new(StringArray::from(sess_ids.iter().map(|s| s.as_str()).collect::<Vec<_>>())),
            Arc::new(StringArray::from(contents.iter().map(|s| s.as_str()).collect::<Vec<_>>())),
            Arc::new(BooleanArray::from(pinneds)),
            Arc::new(Int64Array::from(timestamps)),
            Arc::new(StringArray::from(branches.iter().map(|s| s.as_str()).collect::<Vec<_>>())),
            Arc::new(StringArray::from(commit_types.iter().map(|s| s.as_str()).collect::<Vec<_>>())),
            Arc::new(StringArray::from(tags_vec.iter().map(|s| s.as_str()).collect::<Vec<_>>())),
            Arc::new(StringArray::from(parent_ids.iter().map(|s| s.as_str()).collect::<Vec<_>>())),
            Arc::new(StringArray::from(agent_names.iter().map(|s| s.as_str()).collect::<Vec<_>>())),
            Arc::new(StringArray::from(memory_types.iter().map(|s| s.as_str()).collect::<Vec<_>>())),
            Arc::new(Int32Array::from(importances)),
            Arc::new(BooleanArray::from(vec![false; n])),
            Arc::new(Int64Array::from(decay_ats)),
            Arc::new(StringArray::from(vec![SCOPE_LOCAL; n])),
            Arc::new(StringArray::from(agent_types.iter().map(|s| s.as_str()).collect::<Vec<_>>())),
            null_vector()?,
        ]).map_err(|e| e.to_string())?;

        let reader = RecordBatchIterator::new(vec![Ok(new_batch)], schema.clone());
        new.add(reader).execute().await.map_err(|e: lancedb::Error| e.to_string())?;
    }
    eprintln!("[memory] V2 migration complete");
    Ok(())
}

// ── Readiness ─────────────────────────────────────────────────────────────────

pub fn is_ready() -> bool { DB.get().is_some() }

fn get_conn() -> Result<&'static Connection, String> {
    DB.get().ok_or_else(|| "memory db not initialised".to_string())
}

async fn get_table() -> Result<Table, String> {
    get_conn()?.open_table("memories").execute().await.map_err(|e| e.to_string())
}

// ── Column helpers ────────────────────────────────────────────────────────────

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
    })
}

// ── Write ─────────────────────────────────────────────────────────────────────

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
    // Derive V2 fields from tags / agent_name
    let memory_type  = infer_type_from_tags(tags).to_string();
    let importance   = importance_for_type(&memory_type);
    let decay_at     = decay_for_type(&memory_type);
    let agent_type   = agent_type_from_name(agent_name);
    let scope        = if tags.contains("scope:machine") || tags.contains("scope=machine") {
        SCOPE_MACHINE.to_string()
    } else {
        SCOPE_LOCAL.to_string()
    };

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
    let id = uuid::Uuid::new_v4().to_string();
    let ts = now_ms();
    let schema = memory_schema();

    // ── Week 3: embed on write ────────────────────────────────────────────────
    // Generate embedding. Falls back to null_vector if model not ready.
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

    // ── Week 3: semantic dedup check ─────────────────────────────────────────
    // ANN threshold is per-type. env uses exact key match (handled at injector).
    // If we find a near-duplicate, update its confidence tag and return it.
    let threshold = dedup_threshold(memory_type);
    if threshold <= 1.0 {
        if let Some(ref emb) = embedding_opt {
            if let Ok(Some(dup)) = find_semantic_duplicate(runbox_id, memory_type, emb, threshold).await {
                // Update existing entry's tags with confidence bump
                let new_tags = if dup.tags.contains("confidence:") {
                    dup.tags.clone()
                } else {
                    format!("{},confidence:2", dup.tags)
                };
                let _ = memory_update_tags(&dup.id, &new_tags).await;
                eprintln!("[memory] semantic dup found for {memory_type} (cosine >= {threshold}) — updating confidence");
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
    })
}

pub async fn memory_add_with_embedding(
    runbox_id: &str, session_id: &str, content: &str, embedding: Vec<f32>,
) -> Result<Memory, String> {
    if embedding.len() != EMBEDDING_DIM as usize {
        return Err(format!("embedding dim mismatch: expected {EMBEDDING_DIM}, got {}", embedding.len()));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let ts = now_ms();
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
        Arc::new(StringArray::from(vec!["general"])),
        Arc::new(Int32Array::from(vec![50i32])),
        Arc::new(BooleanArray::from(vec![false])),
        Arc::new(Int64Array::from(vec![decay_for_type("general")])),
        Arc::new(StringArray::from(vec![SCOPE_LOCAL])),
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
        memory_type: "general".into(), importance: 50, resolved: false,
        decay_at: decay_for_type("general"), scope: SCOPE_LOCAL.into(), agent_type: "".into(),
    })
}

// ── Week 3: ANN semantic search ───────────────────────────────────────────────

/// Find the nearest memory to a query embedding within a runbox + type.
/// Returns None if no match above threshold, or if embedder not ready.
/// Per-type thresholds: failure/blocker=0.85, codebase=0.70, env=never (exact key).
pub async fn find_semantic_duplicate(
    runbox_id:   &str,
    memory_type: &str,
    query_vec:   &[f32],
    threshold:   f32,
) -> Result<Option<Memory>, String> {
    if !embedder::is_ready() { return Ok(None); }
    if query_vec.is_empty()  { return Ok(None); }

    // Pull candidates for this runbox + type (max 200)
    let candidates = memories_by_type(runbox_id, memory_type).await?;
    if candidates.is_empty() { return Ok(None); }

    // For now: in-memory cosine scan. With IVF index (Week 4) this becomes pure ANN.
    // At 200 memories this is ~1ms. At 10k it would be ~50ms — index creation handles that.
    let best = candidates.iter()
        .filter(|m| !m.resolved)
        .filter_map(|mem| {
            // Re-embed candidate to get vector. We don't store vectors on read yet
            // (LanceDB FixedSizeList extraction requires separate column read).
            // Until vector read is wired, embed from content at query time.
            // This is ~5ms per candidate — acceptable at <200 memories.
            let cand_vec = embedder::try_embed(&mem.content)?;
            let sim = embedder::cosine_similarity(query_vec, &cand_vec);
            if sim >= threshold { Some((sim, mem)) } else { None }
        })
        .max_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));

    Ok(best.map(|(_, m)| m.clone()))
}

/// ANN search: embed query, scan memories by type+runbox, return top-k by cosine.
/// Falls back to keyword search if embedder not ready.
pub async fn memories_ann_search(
    runbox_id:   &str,
    query:       &str,
    memory_type: Option<&str>,
    limit:       usize,
) -> Result<Vec<(f32, Memory)>, String> {
    // Try embedding first
    if let Some(q_vec) = embedder::try_embed(query) {
        let candidates = if let Some(mt) = memory_type {
            memories_by_type(runbox_id, mt).await?
        } else {
            memories_for_runbox(runbox_id).await?
        };

        // Include global machine-scope too
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

    // Fallback: inline keyword scan (avoids recursive cycle with memories_search_global)
    let ql = query.to_lowercase();
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

// ── Read ──────────────────────────────────────────────────────────────────────

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

/// New V2: query by memory_type
pub async fn memories_by_type(runbox_id: &str, memory_type: &str) -> Result<Vec<Memory>, String> {
    let all = memories_for_runbox(runbox_id).await?;
    Ok(all.into_iter().filter(|m| m.effective_type() == memory_type).collect())
}

/// New V2: active (unresolved) blockers for a runbox
pub async fn active_blockers(runbox_id: &str) -> Result<Vec<Memory>, String> {
    let all = memories_for_runbox(runbox_id).await?;
    Ok(all.into_iter().filter(|m| m.effective_type() == MT_BLOCKER && !m.resolved).collect())
}

/// New V2: machine-scope memories from __global__ runbox
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

/// New V2: mark blocker resolved + write failure
pub async fn resolve_blocker(
    runbox_id:  &str,
    session_id: &str,
    agent_name: &str,
    blocker_desc: &str,
    fix:          &str,
) -> Result<(), String> {
    // Find the matching blocker
    let all = memories_for_runbox(runbox_id).await?;
    let desc_lower = blocker_desc.to_lowercase();

    let blocker = all.into_iter()
        .find(|m| m.effective_type() == MT_BLOCKER
            && !m.resolved
            && m.content.to_lowercase().contains(&desc_lower));

    if let Some(b) = blocker {
        // Mark resolved
        let mut updated = b.clone();
        updated.resolved = true;
        updated.tags = format!("{},resolved", b.tags);
        delete_and_reinsert(&b.id, updated).await?;
    }

    // Write permanent failure
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
        SCOPE_LOCAL, &super::schema::agent_type_from_name(agent_name),
    ).await?;

    Ok(())
}

async fn delete_and_reinsert(old_id: &str, updated: Memory) -> Result<(), String> {
    let schema = memory_schema();
    let batch = memory_to_batch(&updated, schema.clone())?;
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

// ── Mutate ────────────────────────────────────────────────────────────────────

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

async fn fetch_one(id: &str) -> Result<Option<Memory>, String> {
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

// ── Global search (Week 1: keyword; Week 3: ANN with keyword fallback) ────────

pub async fn memories_search_global(query: &str, limit: usize) -> Result<Vec<Memory>, String> {
    // Week 3: use ANN if embedder is ready
    if embedder::is_ready() {
        let scored = memories_ann_search("", query, None, limit).await?;
        // "" as runbox_id means we pull from all runboxes in ann_search
        // If empty, fallback to keyword below
        if !scored.is_empty() {
            return Ok(scored.into_iter().map(|(_, m)| m).collect());
        }
    }

    // Week 1 fallback: keyword scan
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