// src-tauri/src/agent/embedder.rs
//
// Embedding stub — fastembed disabled on Windows due to ort-sys build issues.
// All callers already have keyword fallback when try_embed() returns None.
// ANN search degrades gracefully to keyword search — nothing breaks.
//
// To re-enable: add fastembed to Cargo.toml once a Windows-compatible
// ort-sys version ships, then replace this file with the full implementation.

pub const EMBED_DIM: usize = 768;

/// No-op on Windows — model never loads.
pub async fn init_embedder() {}

/// Always false — embedder is not available.
pub fn is_ready() -> bool {
    false
}

/// Always None — callers fall back to keyword search.
pub fn try_embed(_text: &str) -> Option<Vec<f32>> {
    None
}

/// Not called when embedder is disabled, but kept for API compatibility.
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let na: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let nb: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if na == 0.0 || nb == 0.0 {
        return 0.0;
    }
    (dot / (na * nb)).clamp(-1.0, 1.0)
}

pub fn embed(_text: &str) -> Result<Vec<f32>, String> {
    Err("embedder not available".into())
}

pub fn batch_embed(_texts: &[&str]) -> Result<Vec<Vec<f32>>, String> {
    Err("embedder not available".into())
}
