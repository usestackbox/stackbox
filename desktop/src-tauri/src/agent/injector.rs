// src-tauri/src/agent/injector.rs
//
// Context Injector — builds the ~800 token ranked prompt block.
//
// Pipeline order (scope resolution is step 0, before any ranking):
//   0  scope     — machine-scope env from __global__, guaranteed budget slice
//   1  goal      — always full, never compressed
//   2  session   — last 2 summaries, 5 lines each
//   3  blockers  — active unresolved only, max 4, 2 lines each
//   4  failures  — top 5 by task relevance, 3 lines each
//   5  env local — per-runbox env fills remainder after machine-scope
//   6  codebase  — top 3 task-scoped, 4 lines each
//
// Session cache: keyed (runbox_id, task_prefix), 60s TTL, invalidated on write.
// GCC Fig 3: hard tasks make 5-6 CONTEXT calls — makes 2nd–Nth nearly free.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::memory::{
    self, Memory,
    MT_GOAL, MT_SESSION, MT_BLOCKER, MT_FAILURE, MT_ENVIRONMENT, MT_CODEBASE,
    SCOPE_MACHINE, now_ms,
};
use crate::agent::{embedder, scorer};

// ── Token budgets ─────────────────────────────────────────────────────────────
const BUDGET_GOAL:        usize = 600;
const BUDGET_SESSION:     usize = 400;
const BUDGET_BLOCKERS:    usize = 400;
const BUDGET_FAILURES:    usize = 700;
const BUDGET_ENV_MACHINE: usize = 300; // machine-scope — guaranteed, step 0
const BUDGET_ENV_LOCAL:   usize = 300; // per-runbox remainder
const BUDGET_CODEBASE:    usize = 500;
const BUDGET_TOTAL:       usize = 3000;

fn est_tokens(s: &str) -> usize { (s.len() / 4).max(1) }

fn compress(content: &str, max_lines: usize) -> String {
    content.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .take(max_lines)
        .collect::<Vec<_>>()
        .join(" · ")
}

// Week 3: ANN cosine similarity when embedder ready, keyword fallback otherwise.
// env + goal always use keyword (exact facts, not semantic).
fn relevance(content: &str, task: &str) -> f32 {
    keyword_relevance(content, task) // sync fallback — ANN path is async, handled below
}

// Week 1 keyword overlap (always available).
fn keyword_relevance(content: &str, task: &str) -> f32 {
    if task.is_empty() { return 0.0; }
    let cl = content.to_lowercase();
    let words: Vec<&str> = task.split_whitespace().collect();
    let hits = words.iter()
        .filter(|w| w.len() > 3 && cl.contains(w.to_lowercase().as_str()))
        .count();
    hits as f32 / words.len().max(1) as f32
}

// ANN-ranked sort: embed task once, score all candidates by cosine.
// Falls back to keyword if embedder not ready.
fn ann_rank<'a>(memories: &mut Vec<&'a Memory>, task: &str) {
    if task.is_empty() { return; }
    if let Some(task_vec) = embedder::try_embed(task) {
        memories.sort_by(|a, b| {
            let sa = embedder::try_embed(&a.content)
                .map(|v| embedder::cosine_similarity(&task_vec, &v))
                .unwrap_or_else(|| keyword_relevance(&a.content, task));
            let sb = embedder::try_embed(&b.content)
                .map(|v| embedder::cosine_similarity(&task_vec, &v))
                .unwrap_or_else(|| keyword_relevance(&b.content, task));
            sb.partial_cmp(&sa).unwrap_or(std::cmp::Ordering::Equal)
        });
    } else {
        // keyword fallback
        memories.sort_by(|a, b| {
            keyword_relevance(&b.content, task)
                .partial_cmp(&keyword_relevance(&a.content, task))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
    }
}

// ── Session cache ─────────────────────────────────────────────────────────────

struct CacheEntry { output: String, ts: i64 }
type Cache = Arc<Mutex<HashMap<String, CacheEntry>>>;

static CACHE: std::sync::OnceLock<Cache> = std::sync::OnceLock::new();
fn cache() -> &'static Cache {
    CACHE.get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
}

fn cache_key(runbox_id: &str, task: &str) -> String {
    format!("{}:{}", runbox_id, &task[..task.len().min(40)])
}

const CACHE_TTL_MS: i64 = 60_000;

pub async fn invalidate_cache(runbox_id: &str) {
    let mut c = cache().lock().await;
    c.retain(|k, _| !k.starts_with(runbox_id));
}

// ── Main build function ───────────────────────────────────────────────────────

pub async fn build_context(runbox_id: &str, task: &str) -> String {
    build_context_for(runbox_id, task, "").await
}

/// Extended form — pass agent_type for same-type failure weighting.
pub async fn build_context_for(runbox_id: &str, task: &str, agent_type: &str) -> String {
    let key = cache_key(runbox_id, task);

    // Cache hit?
    {
        let c = cache().lock().await;
        if let Some(entry) = c.get(&key) {
            if now_ms() - entry.ts < CACHE_TTL_MS {
                return entry.output.clone();
            }
        }
    }

    let result = build_uncached(runbox_id, task, agent_type).await;

    // Store in cache
    {
        let mut c = cache().lock().await;
        c.insert(key, CacheEntry { output: result.clone(), ts: now_ms() });
    }

    result
}

async fn build_uncached(runbox_id: &str, task: &str, agent_type: &str) -> String {
    let task_lower = task.to_lowercase();

    // Fetch all memories for this runbox
    let local = memory::memories_for_runbox(runbox_id).await.unwrap_or_default();

    let mut sections: Vec<String> = Vec::new();
    let mut used: usize = 0;

    // ── STEP 0: scope — machine-scope env from __global__ ─────────────────────
    // Must run before any local queries. Machine-scope gets guaranteed budget.
    let machine_env = memory::machine_scope_memories(MT_ENVIRONMENT).await.unwrap_or_default();
    if !machine_env.is_empty() {
        let mut env_map: HashMap<String, (String, bool)> = HashMap::new(); // key -> (val, unverified)
        for e in machine_env.iter().rev() {
            if !e.is_active() { continue; }
            for line in e.content.lines() {
                let t = line.trim(); if t.is_empty() { continue; }
                if let Some(eq) = t.find('=') {
                    let k = t[..eq].trim().to_lowercase();
                    let v = t[eq+1..].trim().to_string();
                    env_map.insert(k, (v, e.env_unverified()));
                }
            }
        }
        if !env_map.is_empty() {
            let mut block = String::from("ENV (machine — applies to all runboxes on this OS):\n");
            for (k, (v, unverified)) in &env_map {
                if *unverified {
                    block.push_str(&format!("{k}={v} (unverified — confirm before use)\n"));
                } else {
                    block.push_str(&format!("{k}={v}\n"));
                }
            }
            if used + est_tokens(&block) <= BUDGET_ENV_MACHINE {
                sections.push(block.clone());
                used += est_tokens(&block);
            }
        }
    }

    // ── STEP 1: goal ──────────────────────────────────────────────────────────
    let goals: Vec<_> = local.iter()
        .filter(|m| m.effective_type() == MT_GOAL && m.is_active())
        .collect();

    if let Some(goal) = goals.last() {
        let block = format!("GOAL:\n{}\n", goal.content.trim());
        if used + est_tokens(&block) <= BUDGET_TOTAL {
            sections.push(block.clone());
            used += est_tokens(&block);
        }
    }

    // ── STEP 2: session summaries ─────────────────────────────────────────────
    let mut sessions: Vec<_> = local.iter()
        .filter(|m| m.effective_type() == MT_SESSION && m.is_active())
        .collect();
    // Scorer: recency-weighted (session half-life = 7 days)
    scorer::rank_by_score(&mut sessions, agent_type);
    let sessions: Vec<_> = sessions.into_iter().take(2).collect();

    if !sessions.is_empty() && used < BUDGET_TOTAL {
        let mut block = String::from("RECENT SESSIONS:\n");
        for s in &sessions {
            let line = compress(&s.content, 5);
            block.push_str(&format!("• {}\n", line));
        }
        if used + est_tokens(&block) <= BUDGET_TOTAL {
            sections.push(block.clone());
            used += est_tokens(&block);
        }
    }

    // ── STEP 3: active blockers ───────────────────────────────────────────────
    let mut blockers: Vec<_> = local.iter()
        .filter(|m| m.effective_type() == MT_BLOCKER && !m.resolved && m.is_active())
        .collect();
    // Scorer: stale blockers (30d+) get lower score — still shown but last
    scorer::rank_by_score(&mut blockers, agent_type);
    let blockers: Vec<_> = blockers.into_iter().take(4).collect();

    if !blockers.is_empty() && used < BUDGET_TOTAL {
        let mut block = String::from("BLOCKERS (dead ends — do NOT retry these):\n");
        for b in &blockers {
            let stale = if b.is_stale_blocker() { " (30d+ old — may be outdated)" } else { "" };
            let line  = compress(&b.content, 2);
            block.push_str(&format!("• {}{}\n", line, stale));
        }
        if used + est_tokens(&block) <= BUDGET_TOTAL {
            sections.push(block.clone());
            used += est_tokens(&block);
        }
    }

    // ── STEP 4: failures (top 5 by task relevance) ───────────────────────────
    let mut failures: Vec<_> = local.iter()
        .filter(|m| m.effective_type() == MT_FAILURE && m.is_active())
        .collect();

    if !task_lower.is_empty() {
        ann_rank(&mut failures, &task_lower); // ANN cosine or keyword fallback
    } else {
        failures.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    }

    let failures: Vec<_> = failures.into_iter().take(5).collect();

    if !failures.is_empty() && used < BUDGET_TOTAL {
        let mut block = String::from("FAILURES (don't re-break — learn from these):\n");
        // Weight same agent_type failures higher
        for f in &failures {
            let line = compress(&f.content, 3);
            block.push_str(&format!("• {}\n", line));
        }
        if used + est_tokens(&block) <= BUDGET_TOTAL {
            sections.push(block.clone());
            used += est_tokens(&block);
        }
    }

    // ── STEP 5: env local (per-runbox, fills remainder after machine budget) ──
    let local_env: Vec<_> = local.iter()
        .filter(|m| m.effective_type() == MT_ENVIRONMENT
            && m.scope != SCOPE_MACHINE
            && m.is_active())
        .collect();

    if !local_env.is_empty() && used < BUDGET_TOTAL {
        let mut env_map: HashMap<String, (String, bool)> = HashMap::new();
        for e in local_env.iter().rev() {
            for line in e.content.lines() {
                let t = line.trim(); if t.is_empty() { continue; }
                if let Some(eq) = t.find('=') {
                    let k = t[..eq].trim().to_lowercase();
                    let v = t[eq+1..].trim().to_string();
                    env_map.insert(k, (v, e.env_unverified()));
                } else {
                    // free-form env note
                    env_map.insert(format!("note_{}", env_map.len()), (t.to_string(), e.env_unverified()));
                }
            }
        }
        if !env_map.is_empty() {
            let mut block = String::from("ENV (this runbox):\n");
            for (k, (v, unverified)) in &env_map {
                if *unverified {
                    block.push_str(&format!("{k}={v} (unverified)\n"));
                } else {
                    block.push_str(&format!("{k}={v}\n"));
                }
            }
            let room = BUDGET_ENV_LOCAL.min(BUDGET_TOTAL.saturating_sub(used));
            if est_tokens(&block) <= room {
                sections.push(block.clone());
                used += est_tokens(&block);
            }
        }
    }

    // ── STEP 6: codebase (task-scoped) ────────────────────────────────────────
    let mut codebase: Vec<_> = local.iter()
        .filter(|m| m.effective_type() == MT_CODEBASE && m.is_active())
        .collect();

    if !task_lower.is_empty() {
        ann_rank(&mut codebase, &task_lower); // ANN cosine (threshold 0.70) or keyword fallback
    }

    let codebase: Vec<_> = codebase.into_iter().take(3).collect();

    if !codebase.is_empty() && used < BUDGET_TOTAL {
        let mut block = String::from("CODEBASE MAP (where things live):\n");
        for c in &codebase {
            let line = compress(&c.content, 4);
            block.push_str(&format!("{}\n", line));
        }
        if used + est_tokens(&block) <= BUDGET_TOTAL {
            sections.push(block.clone());
            used += est_tokens(&block);
        }
    }

    if sections.is_empty() {
        return String::new();
    }

    let output = sections.join("\n---\n");
    let approx_tokens = est_tokens(&output);
    format!("{}\n\n[~{} tokens]\n", output.trim(), approx_tokens)
}