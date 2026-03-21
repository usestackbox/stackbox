// src-tauri/src/memory/store.rs

use arrow_array::{
    BooleanArray, FixedSizeListArray, Float32Array,
    Int64Array, RecordBatch, RecordBatchIterator, StringArray,
};
use arrow_schema::Field;
use futures::TryStreamExt;
use lancedb::{connect, Connection, Table};
use lancedb::query::{ExecutableQuery, QueryBase};
use std::sync::Arc;
use tokio::sync::OnceCell;

use super::schema::{memory_schema, null_vector, Memory, EMBEDDING_DIM};

static DB: OnceCell<Connection> = OnceCell::const_new();

fn db_dir() -> String {
    dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("stackbox").join("memory")
        .to_string_lossy().to_string()
}

pub async fn init() -> Result<(), String> {
    DB.get_or_try_init(|| async {
        let dir = db_dir();
        std::fs::create_dir_all(&dir).ok();
        let conn = connect(&dir).execute().await.map_err(|e| e.to_string())?;
        let tables = conn.table_names().execute().await.map_err(|e| e.to_string())?;

        if tables.contains(&"memories".to_string()) {
            let t = conn.open_table("memories").execute().await.map_err(|e| e.to_string())?;
            let schema = t.schema().await.map_err(|e| e.to_string())?;
            let has_branch     = schema.fields().iter().any(|f| f.name() == "branch");
            let has_agent_name = schema.fields().iter().any(|f| f.name() == "agent_name");

            if !has_branch || !has_agent_name {
                let backup = if !has_branch { "memories_v1" } else { "memories_v2" };
                eprintln!("[memory] migrating schema — old data backed up as {backup}");
                conn.rename_table("memories", backup).await.ok();
                create_empty_table(&conn).await?;
                if let Err(e) = migrate_old_to_new(&conn, backup).await {
                    eprintln!("[memory] migration failed (old data preserved in {backup}): {e}");
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
            if msg.contains("already exists") || msg.contains("table exists") {
                eprintln!("[memory] create_empty_table: table already exists, skipping");
                Ok(())
            } else {
                Err(e.to_string())
            }
        }
    }
}

// ── Safe column helpers ───────────────────────────────────────────────────────
// LanceDB does NOT guarantee column order in query results.
// Always look up columns by name, never by index.

fn str_col<'a>(batch: &'a RecordBatch, name: &str) -> Result<&'a StringArray, String> {
    let idx = batch.schema().index_of(name)
        .map_err(|_| format!("[memory] column '{}' not found in batch", name))?;
    batch.column(idx).as_any().downcast_ref::<StringArray>()
        .ok_or_else(|| format!("[memory] column '{}' is not StringArray", name))
}

fn bool_col<'a>(batch: &'a RecordBatch, name: &str) -> Result<&'a BooleanArray, String> {
    let idx = batch.schema().index_of(name)
        .map_err(|_| format!("[memory] column '{}' not found in batch", name))?;
    batch.column(idx).as_any().downcast_ref::<BooleanArray>()
        .ok_or_else(|| format!("[memory] column '{}' is not BooleanArray", name))
}

fn i64_col<'a>(batch: &'a RecordBatch, name: &str) -> Result<&'a Int64Array, String> {
    let idx = batch.schema().index_of(name)
        .map_err(|_| format!("[memory] column '{}' not found in batch", name))?;
    batch.column(idx).as_any().downcast_ref::<Int64Array>()
        .ok_or_else(|| format!("[memory] column '{}' is not Int64Array", name))
}

fn batch_to_memory(batch: &RecordBatch, i: usize) -> Result<Memory, String> {
    // Required columns — these must exist or we return an error.
    let id      = str_col(batch, "id")?.value(i).to_string();
    let content = str_col(batch, "content")?.value(i).to_string();

    // Optional columns — present in current schema but may be absent in old data
    // that was written before a migration or when the table was partially upgraded.
    // Fall back to sensible defaults so reads never hard-fail on schema drift.
    let str_or  = |name: &str, default: &str| -> String {
        str_col(batch, name).map(|c| c.value(i).to_string()).unwrap_or_else(|_| default.to_string())
    };
    let bool_or = |name: &str, default: bool| -> bool {
        bool_col(batch, name).map(|c| c.value(i)).unwrap_or(default)
    };
    let i64_or  = |name: &str, default: i64| -> i64 {
        i64_col(batch, name).map(|c| c.value(i)).unwrap_or(default)
    };

    Ok(Memory {
        id,
        runbox_id:   str_or("runbox_id",   ""),
        session_id:  str_or("session_id",  ""),
        content,
        pinned:      bool_or("pinned",     false),
        timestamp:   i64_or("timestamp",   0),
        branch:      str_or("branch",      "main"),
        commit_type: str_or("commit_type", "memory"),
        tags:        str_or("tags",        ""),
        parent_id:   str_or("parent_id",   ""),
        agent_name:  str_or("agent_name",  ""),
    })
}

// ── Migration ─────────────────────────────────────────────────────────────────

async fn migrate_old_to_new(conn: &Connection, backup_name: &str) -> Result<(), String> {
    let old    = conn.open_table(backup_name).execute().await.map_err(|e| e.to_string())?;
    let new    = conn.open_table("memories").execute().await.map_err(|e| e.to_string())?;
    let schema = memory_schema();

    let stream  = old.query().execute().await.map_err(|e: lancedb::Error| e.to_string())?;
    let batches: Vec<RecordBatch> = stream.try_collect().await.map_err(|e| e.to_string())?;

    for batch in &batches {
        let n = batch.num_rows(); if n == 0 { continue; }

        // Old schema may be missing columns — use by-name access with fallbacks.
        // Bind schema to a named variable so field_names borrows live long enough.
        let batch_schema = batch.schema();
        let field_names: Vec<&str> = batch_schema.fields().iter()
            .map(|f| f.name().as_str()).collect();

        let get_str = |name: &str, fallback: &'static str| -> Vec<String> {
            if field_names.contains(&name) {
                if let Ok(col) = str_col(batch, name) {
                    return (0..n).map(|i| col.value(i).to_string()).collect();
                }
            }
            vec![fallback.to_string(); n]
        };

        let ids        = get_str("id", "");
        let runbox_ids = get_str("runbox_id", "");
        let sess_ids   = get_str("session_id", "");
        let contents   = get_str("content", "");
        let branches   = get_str("branch", "main");
        let commit_types = get_str("commit_type", "memory");
        let tags_vec   = get_str("tags", "");
        let parent_ids = get_str("parent_id", "");
        let agent_names = get_str("agent_name", "");

        let pinneds: Vec<bool> = if field_names.contains(&"pinned") {
            if let Ok(col) = bool_col(batch, "pinned") {
                (0..n).map(|i| col.value(i)).collect()
            } else { vec![false; n] }
        } else { vec![false; n] };

        let timestamps: Vec<i64> = if field_names.contains(&"timestamp") {
            if let Ok(col) = i64_col(batch, "timestamp") {
                (0..n).map(|i| col.value(i)).collect()
            } else { vec![0i64; n] }
        } else { vec![0i64; n] };

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
            null_vector()?,
        ]).map_err(|e| e.to_string())?;

        let reader = RecordBatchIterator::new(vec![Ok(new_batch)], schema.clone());
        new.add(reader).execute().await.map_err(|e: lancedb::Error| e.to_string())?;
    }
    eprintln!("[memory] migration complete");
    Ok(())
}

// ── Non-blocking readiness check ──────────────────────────────────────────────

/// Returns true once init() has succeeded. Non-blocking.
pub fn is_ready() -> bool {
    DB.get().is_some()
}

fn get_conn() -> Result<&'static Connection, String> {
    DB.get().ok_or_else(|| "memory db not initialised — call init() first".to_string())
}

async fn get_table() -> Result<Table, String> {
    get_conn()?.open_table("memories").execute().await.map_err(|e| e.to_string())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default().as_millis() as i64
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
    let id = uuid::Uuid::new_v4().to_string();
    let ts = now_ms();
    let schema = memory_schema();

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
        null_vector()?,
    ]).map_err(|e| e.to_string())?;

    let reader = RecordBatchIterator::new(vec![Ok(batch)], schema);
    get_table().await?.add(reader).execute().await.map_err(|e: lancedb::Error| e.to_string())?;

    Ok(Memory {
        id, runbox_id: runbox_id.into(), session_id: session_id.into(),
        content: content.into(), pinned: false, timestamp: ts,
        branch: branch.into(), commit_type: commit_type.into(),
        tags: tags.into(), parent_id: parent_id.into(),
        agent_name: agent_name.into(),
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
        vector_col,
    ]).map_err(|e| e.to_string())?;
    let reader = RecordBatchIterator::new(vec![Ok(batch)], schema);
    get_table().await?.add(reader).execute().await.map_err(|e: lancedb::Error| e.to_string())?;
    Ok(Memory {
        id, runbox_id: runbox_id.into(), session_id: session_id.into(),
        content: content.into(), pinned: false, timestamp: ts,
        branch: "main".into(), commit_type: "memory".into(),
        tags: "".into(), parent_id: "".into(), agent_name: "".into(),
    })
}

// ── Read ──────────────────────────────────────────────────────────────────────

pub async fn memories_for_runbox(runbox_id: &str) -> Result<Vec<Memory>, String> {
    memories_query(runbox_id, None, None, 200).await
}

pub async fn memories_for_branch(runbox_id: &str, branch: &str) -> Result<Vec<Memory>, String> {
    memories_query(runbox_id, Some(branch), None, 200).await
}

pub async fn memories_by_tag(runbox_id: &str, tag: &str) -> Result<Vec<Memory>, String> {
    let all = memories_for_runbox(runbox_id).await?;
    let tag_lower = tag.to_lowercase();
    Ok(all.into_iter().filter(|m| {
        m.tags.split(',').any(|t| t.trim().to_lowercase() == tag_lower)
    }).collect())
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
    let mut tags: std::collections::HashSet<String> = std::collections::HashSet::new();
    for m in &all { for t in m.tag_list() { tags.insert(t.to_string()); } }
    let mut out: Vec<String> = tags.into_iter().collect();
    out.sort();
    Ok(out)
}

async fn memories_query(
    runbox_id: &str, branch: Option<&str>, tags: Option<&str>, limit: usize,
) -> Result<Vec<Memory>, String> {
    let filter = if let Some(b) = branch {
        format!("runbox_id = '{}' AND branch = '{}'",
            runbox_id.replace('\'', "''"), b.replace('\'', "''"))
    } else {
        format!("runbox_id = '{}'", runbox_id.replace('\'', "''"))
    };

    let stream = get_table().await?
        .query().only_if(filter).limit(limit * 4)
        .execute().await.map_err(|e: lancedb::Error| e.to_string())?;

    let batches: Vec<RecordBatch> = stream.try_collect().await.map_err(|e| e.to_string())?;
    let mut seen: std::collections::HashMap<String, Memory> = std::collections::HashMap::new();

    for batch in &batches {
        let n = batch.num_rows(); if n == 0 { continue; }
        for i in 0..n {
            // batch_to_memory uses column-by-name — safe regardless of LanceDB column ordering.
            let mem = batch_to_memory(batch, i)?;
            let id  = mem.id.clone();
            let ts  = mem.timestamp;
            seen.entry(id)
                .and_modify(|e| { if ts >= e.timestamp { *e = mem.clone(); } })
                .or_insert(mem);
        }
    }

    let mut out: Vec<Memory> = seen.into_values().collect();

    if let Some(tag) = tags {
        let tag_lower = tag.to_lowercase();
        out.retain(|m| m.tags.split(',').any(|t| t.trim().to_lowercase() == tag_lower));
    }

    out.sort_by(|a, b| {
        let type_order = |ct: &str| match ct { "milestone" => 0, "checkpoint" => 1, _ => 2 };
        if a.pinned != b.pinned { return a.pinned.cmp(&b.pinned).reverse(); }
        let ta = type_order(&a.commit_type);
        let tb = type_order(&b.commit_type);
        if ta != tb { return ta.cmp(&tb); }
        b.timestamp.cmp(&a.timestamp)
    });

    out.truncate(limit);
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
    let mem = fetch_one(id).await?.ok_or("memory not found")?;
    insert_updated(&mem, Some(pinned), None, None, None, None).await?;
    get_table().await?.delete(&format!("id = '{}'", id.replace('\'', "''"))).await
        .map(|_| ()).map_err(|e| e.to_string())
}

pub async fn memory_update(id: &str, content: &str) -> Result<(), String> {
    let mem = fetch_one(id).await?.ok_or("memory not found")?;
    insert_updated(&mem, None, Some(content), None, None, None).await?;
    get_table().await?.delete(&format!("id = '{}'", id.replace('\'', "''"))).await
        .map(|_| ()).map_err(|e| e.to_string())
}

pub async fn memory_update_tags(id: &str, tags: &str) -> Result<(), String> {
    let mem = fetch_one(id).await?.ok_or("memory not found")?;
    insert_updated(&mem, None, None, Some(tags), None, None).await?;
    get_table().await?.delete(&format!("id = '{}'", id.replace('\'', "''"))).await
        .map(|_| ()).map_err(|e| e.to_string())
}

pub async fn memory_move_branch(id: &str, branch: &str) -> Result<(), String> {
    let mem = fetch_one(id).await?.ok_or("memory not found")?;
    insert_updated(&mem, None, None, None, Some(branch), None).await?;
    get_table().await?.delete(&format!("id = '{}'", id.replace('\'', "''"))).await
        .map(|_| ()).map_err(|e| e.to_string())
}

async fn fetch_one(id: &str) -> Result<Option<Memory>, String> {
    let table  = get_table().await?;
    let stream = table.query()
        .only_if(format!("id = '{}'", id.replace('\'', "''")))
        .execute().await.map_err(|e: lancedb::Error| e.to_string())?;
    let batches: Vec<RecordBatch> = stream.try_collect().await.map_err(|e| e.to_string())?;
    let batch = match batches.into_iter().next() {
        Some(b) if b.num_rows() > 0 => b,
        _ => return Ok(None),
    };
    // Use name-based access — same reason as memories_query.
    Ok(Some(batch_to_memory(&batch, 0)?))
}

async fn insert_updated(
    mem:         &Memory,
    pinned:      Option<bool>,
    content:     Option<&str>,
    tags:        Option<&str>,
    branch:      Option<&str>,
    commit_type: Option<&str>,
) -> Result<(), String> {
    let schema = memory_schema();
    let new_batch = RecordBatch::try_new(schema.clone(), vec![
        Arc::new(StringArray::from(vec![mem.id.as_str()])),
        Arc::new(StringArray::from(vec![mem.runbox_id.as_str()])),
        Arc::new(StringArray::from(vec![mem.session_id.as_str()])),
        Arc::new(StringArray::from(vec![content.unwrap_or(&mem.content)])),
        Arc::new(BooleanArray::from(vec![pinned.unwrap_or(mem.pinned)])),
        Arc::new(Int64Array::from(vec![mem.timestamp])),
        Arc::new(StringArray::from(vec![branch.unwrap_or(&mem.branch)])),
        Arc::new(StringArray::from(vec![commit_type.unwrap_or(&mem.commit_type)])),
        Arc::new(StringArray::from(vec![tags.unwrap_or(&mem.tags)])),
        Arc::new(StringArray::from(vec![mem.parent_id.as_str()])),
        Arc::new(StringArray::from(vec![mem.agent_name.as_str()])),
        null_vector()?,
    ]).map_err(|e| e.to_string())?;
    let reader = RecordBatchIterator::new(vec![Ok(new_batch)], schema);
    get_table().await?.add(reader).execute().await.map_err(|e: lancedb::Error| e.to_string())?;
    Ok(())
}

// ── Global Search ──────────────────────────────────────────────────────────────

pub async fn memories_search_global(query: &str, limit: usize) -> Result<Vec<Memory>, String> {
    let query_lower = query.to_lowercase();
    // Fetch a broad set and filter in-app for now (Phase 2 will use ANN vector search)
    let stream = get_table().await?
        .query()
        .limit(500)
        .execute().await.map_err(|e: lancedb::Error| e.to_string())?;

    let batches: Vec<arrow_array::RecordBatch> = stream.try_collect().await.map_err(|e| e.to_string())?;
    let mut results: Vec<Memory> = Vec::new();

    for batch in &batches {
        let n = batch.num_rows(); if n == 0 { continue; }
        for i in 0..n {
            let mem = batch_to_memory(batch, i)?;
            // Skip git-ingested noise unless query is specific
            if mem.agent_name == "git" && query.len() < 4 { continue; }
            let haystack = format!("{} {} {}", mem.content, mem.tags, mem.agent_name).to_lowercase();
            if haystack.contains(&query_lower) {
                results.push(mem);
            }
        }
    }

    results.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    results.truncate(limit);
    Ok(results)
}