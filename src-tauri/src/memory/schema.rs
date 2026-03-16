// src-tauri/src/memory/schema.rs

use arrow_array::{FixedSizeListArray, Float32Array};
use arrow_schema::{DataType, Field, Schema};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

pub const EMBEDDING_DIM: i32 = 512;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Memory {
    pub id:         String,
    pub runbox_id:  String,
    pub session_id: String,
    pub content:    String,
    pub pinned:     bool,
    pub timestamp:  i64,
}

pub fn memory_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("id",         DataType::Utf8,    false),
        Field::new("runbox_id",  DataType::Utf8,    false),
        Field::new("session_id", DataType::Utf8,    false),
        Field::new("content",    DataType::Utf8,    false),
        Field::new("pinned",     DataType::Boolean, false),
        Field::new("timestamp",  DataType::Int64,   false),
        Field::new(
            "vector",
            DataType::FixedSizeList(
                Arc::new(Field::new("item", DataType::Float32, true)),
                EMBEDDING_DIM,
            ),
            true,
        ),
    ]))
}

pub fn null_vector() -> Result<Arc<FixedSizeListArray>, String> {
    FixedSizeListArray::try_new(
        Arc::new(Field::new("item", DataType::Float32, true)),
        EMBEDDING_DIM,
        Arc::new(Float32Array::from(vec![0f32; EMBEDDING_DIM as usize])),
        None,
    )
    .map(Arc::new)
    .map_err(|e| e.to_string())
}
