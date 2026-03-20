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
            // Schema changed — back up and recreate
            let backup = if !has_branch { "memories_v1" } else { "memories_v2" };
            eprintln!("[memory] migrating schema — old data backed up as {backup}");
            conn.rename_table("memories", backup).await.ok();
            create_empty_table(&conn).await?;
            migrate_old_to_new(&conn, backup).await.ok();
        }
    } else {
        create_empty_table(&conn).await?;
    }

    DB.set(conn).map_err(|_| "memory db already initialised".to_string())?;
    Ok(())
}

async fn create_empty_table(conn: &Connection) -> Result<(), String> {
    let schema = memory_schema();
    let batch  = RecordBatch::new_empty(schema.clone());
    let reader = RecordBatchIterator::new(vec![Ok(batch)], schema);
    conn.create_table("memories", reader).execute().await.map_err(|e| e.to_string())?;
    Ok(())
}

async fn migrate_old_to_new(conn: &Connection, backup_name: &str) -> Result<(), String> {
    let old   = conn.open_table(backup_name).execute().await.map_err(|e| e.to_string())?;
    let new   = conn.open_table("memories").execute().await.map_err(|e| e.to_string())?;
    let schema = memory_schema();

    let stream  = old.query().execute().await.map_err(|e: lancedb::Error| e.to_string())?;
    let batches: Vec<RecordBatch> = stream.try_collect().await.map_err(|e| e.to_string())?;

    for batch in &batches {
        let n = batch.num_rows(); if n == 0 { continue; }
        let col = |i: usize| batch.column(i);
        let ids        = col(0).as_any().downcast_ref::<StringArray>().unwrap();
        let runbox_ids = col(1).as_any().downcast_ref::<StringArray>().unwrap();
        let sess_ids   = col(2).as_any().downcast_ref::<StringArray>().unwrap();
        let contents   = col(3).as_any().downcast_ref::<StringArray>().unwrap();
        let pinneds    = col(4).as_any().downcast_ref::<BooleanArray>().unwrap();
        let timestamps = col(5).as_any().downcast_ref::<Int64Array>().unwrap();
        // Columns 6-9 may not exist in v1 (no branch/commit_type/tags/parent_id)
        let has_branch = batch.num_columns() > 6;

        let branches     = if has_branch { Some(col(6).as_any().downcast_ref::<StringArray>()) } else { None };
        let commit_types = if has_branch { Some(col(7).as_any().downcast_ref::<StringArray>()) } else { None };
        let tags_col     = if has_branch { Some(col(8).as_any().downcast_ref::<StringArray>()) } else { None };
        let parent_ids   = if has_branch { Some(col(9).as_any().downcast_ref::<StringArray>()) } else { None };
        // agent_name may not exist (v2 didn't have it either)
        let has_agent    = batch.num_columns() > 10 && batch.schema().field(10).name() == "agent_name";
        let agent_names  = if has_agent { Some(col(10).as_any().downcast_ref::<StringArray>()) } else { None };

        let new_batch = RecordBatch::try_new(schema.clone(), vec![
            Arc::new(StringArray::from((0..n).map(|i| ids.value(i)).collect::<Vec<_>>())),
            Arc::new(StringArray::from((0..n).map(|i| runbox_ids.value(i)).collect::<Vec<_>>())),
            Arc::new(StringArray::from((0..n).map(|i| sess_ids.value(i)).collect::<Vec<_>>())),
            Arc::new(StringArray::from((0..n).map(|i| contents.value(i)).collect::<Vec<_>>())),
            Arc::new(BooleanArray::from((0..n).map(|i| pinneds.value(i)).collect::<Vec<_>>())),
            Arc::new(Int64Array::from((0..n).map(|i| timestamps.value(i)).collect::<Vec<_>>())),
            Arc::new(StringArray::from((0..n).map(|i| branches.and_then(|c| c).map(|c| c.value(i)).unwrap_or("main")).collect::<Vec<_>>())),
            Arc::new(StringArray::from((0..n).map(|i| commit_types.and_then(|c| c).map(|c| c.value(i)).unwrap_or("memory")).collect::<Vec<_>>())),
            Arc::new(StringArray::from((0..n).map(|i| tags_col.and_then(|c| c).map(|c| c.value(i)).unwrap_or("")).collect::<Vec<_>>())),
            Arc::new(StringArray::from((0..n).map(|i| parent_ids.and_then(|c| c).map(|c| c.value(i)).unwrap_or("")).collect::<Vec<_>>())),
            Arc::new(StringArray::from((0..n).map(|i| agent_names.and_then(|c| c).map(|c| c.value(i)).unwrap_or("")).collect::<Vec<_>>())),
            null_vector()?,
        ]).map_err(|e| e.to_string())?;

        let reader = RecordBatchIterator::new(vec![Ok(new_batch)], schema.clone());
        new.add(reader).execute().await.map_err(|e: lancedb::Error| e.to_string())?;
    }
    eprintln!("[memory] migration complete");
    Ok(())
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
        let col = |i: usize| batch.column(i);
        let ids          = col(0).as_any().downcast_ref::<StringArray>().unwrap();
        let runbox_ids   = col(1).as_any().downcast_ref::<StringArray>().unwrap();
        let sess_ids     = col(2).as_any().downcast_ref::<StringArray>().unwrap();
        let contents     = col(3).as_any().downcast_ref::<StringArray>().unwrap();
        let pinneds      = col(4).as_any().downcast_ref::<BooleanArray>().unwrap();
        let timestamps   = col(5).as_any().downcast_ref::<Int64Array>().unwrap();
        let branches     = col(6).as_any().downcast_ref::<StringArray>().unwrap();
        let commit_types = col(7).as_any().downcast_ref::<StringArray>().unwrap();
        let tags_col     = col(8).as_any().downcast_ref::<StringArray>().unwrap();
        let parent_ids   = col(9).as_any().downcast_ref::<StringArray>().unwrap();
        let agent_names  = col(10).as_any().downcast_ref::<StringArray>().unwrap();

        for i in 0..n {
            let id = ids.value(i).to_string();
            let ts = timestamps.value(i);
            let mem = Memory {
                id: id.clone(), runbox_id: runbox_ids.value(i).into(),
                session_id: sess_ids.value(i).into(), content: contents.value(i).into(),
                pinned: pinneds.value(i), timestamp: ts,
                branch: branches.value(i).into(), commit_type: commit_types.value(i).into(),
                tags: tags_col.value(i).into(), parent_id: parent_ids.value(i).into(),
                agent_name: agent_names.value(i).into(),
            };
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
    let col = |i: usize| batch.column(i);
    Ok(Some(Memory {
        id:          col(0).as_any().downcast_ref::<StringArray>().unwrap().value(0).into(),
        runbox_id:   col(1).as_any().downcast_ref::<StringArray>().unwrap().value(0).into(),
        session_id:  col(2).as_any().downcast_ref::<StringArray>().unwrap().value(0).into(),
        content:     col(3).as_any().downcast_ref::<StringArray>().unwrap().value(0).into(),
        pinned:      col(4).as_any().downcast_ref::<BooleanArray>().unwrap().value(0),
        timestamp:   col(5).as_any().downcast_ref::<Int64Array>().unwrap().value(0),
        branch:      col(6).as_any().downcast_ref::<StringArray>().unwrap().value(0).into(),
        commit_type: col(7).as_any().downcast_ref::<StringArray>().unwrap().value(0).into(),
        tags:        col(8).as_any().downcast_ref::<StringArray>().unwrap().value(0).into(),
        parent_id:   col(9).as_any().downcast_ref::<StringArray>().unwrap().value(0).into(),
        agent_name:  col(10).as_any().downcast_ref::<StringArray>().unwrap().value(0).into(),
    }))
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