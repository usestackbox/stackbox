// src-tauri/src/agent/injector.rs
//
// Context Injector — V3 4-level build + V2 legacy build.
//
// V3 pipeline (build_context_v3):
//   1. LOCKED    — always full, always first (~100 tokens)
//   2. SESSION   — last 2 summaries, any agent, tagged with agent name (~100 tokens)
//   3. PREFERRED — recency ranked, deduplicated by key, machine-scope first (~150 tokens)
//   4. TEMPORARY — this agent's own active notes only (~50 tokens)
//   Total ~400 tokens. Cached 60s, invalidated on every remember() write.
//
// V2 legacy pipeline (build_context) kept for panel Context preview tab
// and gradual transition — it falls back to V2 data.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::memory::{
    self, Memory,
    LEVEL_LOCKED, LEVEL_PREFERRED, LEVEL_TEMPORARY, LEVEL_SESSION,
    MT_GOAL, MT_SESSION, MT_BLOCKER, MT_FAILURE, MT_ENVIRONMENT, MT_CODEBASE,
    SCOPE_MACHINE, now_ms,
};
use crate::agent::{embedder, scorer};

// ── Token budgets ─────────────────────────────────────────────────────────────
const BUDGET_LOCKED:    usize = 120;
const BUDGET_SESSION:   usize = 120;
const BUDGET_PREFERRED: usize = 160;
const BUDGET_TEMPORARY: usize = 80;
const BUDGET_TOTAL_V3:  usize = 480;

// V2 budgets (legacy)
const BUDGET_GOAL:        usize = 600;
const BUDGET_SESSION_V2:  usize = 400;
const BUDGET_BLOCKERS:    usize = 400;
const BUDGET_FAILURES:    usize = 700;
const BUDGET_ENV_MACHINE: usize = 300;
const BUDGET_ENV_LOCAL:   usize = 300;
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

fn keyword_relevance(content: &str, task: &str) -> f32 {
    if task.is_empty() { return 0.0; }
    let cl = content.to_lowercase();
    let words: Vec<&str> = task.split_whitespace().collect();
    let hits = words.iter()
        .filter(|w| w.len() > 3 && cl.contains(w.to_lowercase().as_str()))
        .count();
    hits as f32 / words.len().max(1) as f32
}

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

fn cache_key(runbox_id: &str, task: &str, agent_id: &str) -> String {
    format!("{}:{}:{}", runbox_id, &agent_id[..agent_id.len().min(20)], &task[..task.len().min(30)])
}

const CACHE_TTL_MS: i64 = 60_000;

pub async fn invalidate_cache(runbox_id: &str) {
    let mut c = cache().lock().await;
    c.retain(|k, _| !k.starts_with(runbox_id));
}

// ── V3 build_context_v3 ───────────────────────────────────────────────────────

pub async fn build_context_v3(runbox_id: &str, task: &str, agent_id: &str) -> String {
    let key = cache_key(runbox_id, task, agent_id);

    {
        let c = cache().lock().await;
        if let Some(entry) = c.get(&key) {
            if now_ms() - entry.ts < CACHE_TTL_MS {
                return entry.output.clone();
            }
        }
    }

    let result = build_v3_uncached(runbox_id, task, agent_id).await;

    {
        let mut c = cache().lock().await;
        c.insert(key, CacheEntry { output: result.clone(), ts: now_ms() });
    }

    result
}

// ============================================================================
// PATCH: src-tauri/src/agent/injector.rs
//
// Replace build_v3_uncached() with the version below.
// Additions (marked with GCC+Letta comments):
//   - Section 1b: main.md global roadmap (after LOCKED)
//   - Section 2b: metadata.yaml project architecture (after SESSION)
//   - New helper: extract_metadata_context()
//
// Token budgets are unchanged. The two new sections share from the
// existing BUDGET_TOTAL_V3 pool — they displace nothing when empty
// and take from PREFERRED headroom when present.
// ============================================================================

async fn build_v3_uncached(runbox_id: &str, task: &str, agent_id: &str) -> String {
    let all = memory::memories_for_runbox(runbox_id).await.unwrap_or_default();
    // GCC+Letta: look up cwd for filesystem reads
    let cwd = crate::agent::globals::get_runbox_cwd(runbox_id);

    let mut sections: Vec<String> = Vec::new();
    let mut used: usize = 0;

    // ── 1. LOCKED — always first, always full ─────────────────────────────────
    let locked: Vec<_> = all.iter()
        .filter(|m| m.effective_level() == LEVEL_LOCKED && !m.resolved)
        .collect();

    if !locked.is_empty() {
        let mut block = String::from("LOCKED:\n");
        for l in &locked {
            block.push_str(&format!("• {}\n", l.content.trim()));
        }
        if est_tokens(&block) <= BUDGET_LOCKED {
            sections.push(block.clone());
            used += est_tokens(&block);
        } else {
            // Hard cap — always inject LOCKED even if over budget
            let capped = locked.iter()
                .take(5)
                .map(|l| format!("• {}", l.content.trim()))
                .collect::<Vec<_>>()
                .join("\n");
            let block = format!("LOCKED:\n{capped}\n");
            sections.push(block.clone());
            used += est_tokens(&block);
        }
    }

    // ── 1b. GCC: main.md — global project roadmap ────────────────────────────
    // Injected right after LOCKED so agents see goals before anything else.
    // Budget: shared from BUDGET_TOTAL_V3 pool, capped at ~60 tokens.
    if !cwd.is_empty() && used < BUDGET_TOTAL_V3 {
        let main_md = crate::memory::filesystem::read_main_md(&cwd);
        if !main_md.trim().is_empty() {
            // Strip markdown headings — just the content lines
            let trimmed: String = main_md.lines()
                .filter(|l| !l.trim_start().starts_with('#'))
                .filter(|l| !l.trim().is_empty())
                .filter(|l| !l.trim().starts_with("_")) // skip italics-only metadata lines
                .take(8)
                .map(|l| l.trim())
                .collect::<Vec<_>>()
                .join("\n");

            if !trimmed.is_empty() {
                let block = format!("ROADMAP:\n{trimmed}\n");
                let room  = 60usize.min(BUDGET_TOTAL_V3.saturating_sub(used));
                if est_tokens(&block) <= room {
                    sections.push(block.clone());
                    used += est_tokens(&block);
                }
            }
        }
    }

    // ── 2. SESSION — last 2 summaries, any agent ─────────────────────────────
    let mut sessions: Vec<_> = all.iter()
        .filter(|m| m.effective_level() == LEVEL_SESSION && !m.resolved)
        .collect();
    sessions.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    let sessions: Vec<_> = sessions.into_iter().take(2).collect();

    if !sessions.is_empty() && used < BUDGET_TOTAL_V3 {
        let mut block = String::from("RECENT SESSIONS:\n");
        for s in &sessions {
            let agent_label = s.agent_id.split(':').next().unwrap_or("agent").to_string();
            let age         = s.age_label();
            let line        = compress(&s.content, 5);
            block.push_str(&format!("• [{agent_label} {age}] {line}\n"));
        }
        if used + est_tokens(&block) <= used + BUDGET_SESSION {
            sections.push(block.clone());
            used += est_tokens(&block);
        }
    }

    // ── 2b. GCC: metadata.yaml — project architecture ────────────────────────
    // Injected after SESSION so agents know file layout before editing.
    // Budget: capped at 60 tokens, task-filtered to stay relevant.
    if !cwd.is_empty() && used < BUDGET_TOTAL_V3 {
        let meta = crate::memory::filesystem::read_metadata_yaml(&cwd);
        if !meta.trim().is_empty() {
            let relevant = extract_metadata_context(&meta, task);
            if !relevant.is_empty() {
                let block = format!("PROJECT:\n{relevant}\n");
                let room  = 60usize.min(BUDGET_TOTAL_V3.saturating_sub(used));
                if est_tokens(&block) <= room {
                    sections.push(block);
                    used += est_tokens(&block);
                }
            }
        }
    }

    // ── 3. PREFERRED — recency ranked, key-deduplicated ─────────────────────
    let machine_preferred = memory::memories_for_runbox("__global__").await.unwrap_or_default();
    let mut preferred_all: Vec<_> = machine_preferred.iter()
        .chain(all.iter())
        .filter(|m| m.effective_level() == LEVEL_PREFERRED && !m.resolved && m.is_active())
        .collect();

    // Dedup by key — keep most recent per key
    let mut seen_keys: HashMap<String, usize> = HashMap::new();
    let mut preferred_deduped: Vec<&Memory> = Vec::new();
    preferred_all.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    for m in &preferred_all {
        let k = if m.key.is_empty() {
            memory::extract_key(&m.content)
        } else {
            m.key.clone()
        };
        if seen_keys.contains_key(&k) { continue; }
        seen_keys.insert(k, preferred_deduped.len());
        preferred_deduped.push(m);
    }

    // Rank by composite score + task relevance
    if !task.is_empty() {
        ann_rank(&mut preferred_deduped, task);
    } else {
        scorer::rank_by_score(&mut preferred_deduped, "");
    }

    let room = BUDGET_PREFERRED.min(BUDGET_TOTAL_V3.saturating_sub(used));
    if !preferred_deduped.is_empty() && used < BUDGET_TOTAL_V3 {
        let mut block = String::from("PREFERRED:\n");
        let mut pused = 0usize;
        for p in &preferred_deduped {
            let line = format!("• {}\n", p.content.trim());
            if pused + est_tokens(&line) > room { break; }
            block.push_str(&line);
            pused += est_tokens(&line);
        }
        if pused > 0 {
            sections.push(block.clone());
            used += est_tokens(&block);
        }
    }

    // ── 4. TEMPORARY — this agent's own active notes only ────────────────────
    let mut temporary: Vec<_> = all.iter()
        .filter(|m| {
            m.effective_level() == LEVEL_TEMPORARY
                && m.agent_id == agent_id
                && !m.resolved
                && !m.tags.contains("session_log") // session_log is separate
        })
        .collect();
    temporary.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    let room = BUDGET_TEMPORARY.min(BUDGET_TOTAL_V3.saturating_sub(used));
    if !temporary.is_empty() && used < BUDGET_TOTAL_V3 {
        let mut block = String::from("TEMPORARY (your active notes):\n");
        let mut tused = 0usize;
        for t in &temporary {
            let line = format!("• {}\n", t.content.trim());
            if tused + est_tokens(&line) > room { break; }
            block.push_str(&line);
            tused += est_tokens(&line);
        }
        if tused > 0 {
            sections.push(block.clone());
            used += est_tokens(&block);
        }
    }

    if sections.is_empty() { return String::new(); }

    let output = sections.join("\n---\n");
    let approx = est_tokens(&output);
    format!("{}\n\n[~{approx} tokens]\n", output.trim())
}

// ── GCC: metadata.yaml context extractor ──────────────────────────────────────
//
// Pulls the 'env' and 'files' sections from metadata.yaml, filtered by
// task relevance. Strips comments and limits to 8 lines to stay within
// the 60-token budget.

fn extract_metadata_context(yaml: &str, task: &str) -> String {
    let task_lower = task.to_lowercase();
    let mut lines: Vec<String> = Vec::new();
    let mut in_section = false;

    for raw_line in yaml.lines().take(80) {
        let lower = raw_line.to_lowercase();

        // Include 'env:' and 'files:' sections (most useful for agents)
        if lower.trim_start().starts_with("env:")
            || lower.trim_start().starts_with("files:") {
            in_section = true;
            continue;
        }

        // Stop at 'deps:' or 'arch:' — too verbose for context window
        if lower.trim_start().starts_with("deps:")
            || lower.trim_start().starts_with("arch:")
            || lower.trim_start().starts_with("project:") {
            in_section = false;
        }

        // Skip comments and blank lines
        if raw_line.trim().starts_with('#') || raw_line.trim().is_empty() { continue; }

        if in_section {
            let clean = raw_line.trim_start_matches("  ").to_string(); // strip 2-space indent
            // If we have a task, only include lines relevant to it
            if task_lower.is_empty()
                || task_lower.split_whitespace().any(|w| w.len() > 2 && lower.contains(w))
            {
                lines.push(clean);
            } else {
                // Always include env lines (port, etc.) regardless of task
                if lower.contains("port") || lower.contains("env") || lower.contains("url") {
                    lines.push(clean);
                }
            }
        }

        if lines.len() >= 10 { break; }
    }

    lines.into_iter().take(8).collect::<Vec<_>>().join("\n")
}

// ── V2 legacy build_context (kept for panel + backward compat) ─────────────────

pub async fn build_context(runbox_id: &str, task: &str) -> String {
    build_context_for(runbox_id, task, "").await
}

pub async fn build_context_for(runbox_id: &str, task: &str, agent_type: &str) -> String {
    // Use V3 if agent_id is available — otherwise fall back to V2 logic
    // For the panel Context preview (no agent_id), use V3 with empty agent_id
    build_context_v3(runbox_id, task, agent_type).await
}

// ── V2 legacy uncached (kept for reference, not used in main path) ────────────

#[allow(dead_code)]
async fn build_v2_uncached(runbox_id: &str, task: &str, agent_type: &str) -> String {
    let task_lower = task.to_lowercase();
    let local = memory::memories_for_runbox(runbox_id).await.unwrap_or_default();
    let mut sections: Vec<String> = Vec::new();
    let mut used: usize = 0;

    // Machine-scope env
    let machine_env = memory::machine_scope_memories(MT_ENVIRONMENT).await.unwrap_or_default();
    if !machine_env.is_empty() {
        let mut env_map: HashMap<String, (String, bool)> = HashMap::new();
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
            let mut block = String::from("ENV (machine):\n");
            for (k, (v, unverified)) in &env_map {
                let note = if *unverified { " (unverified)" } else { "" };
                block.push_str(&format!("{k}={v}{note}\n"));
            }
            if used + est_tokens(&block) <= BUDGET_ENV_MACHINE {
                sections.push(block.clone());
                used += est_tokens(&block);
            }
        }
    }

    // Goal
    let goals: Vec<_> = local.iter()
        .filter(|m| m.effective_type() == MT_GOAL && m.is_active()).collect();
    if let Some(goal) = goals.last() {
        let block = format!("GOAL:\n{}\n", goal.content.trim());
        if used + est_tokens(&block) <= BUDGET_TOTAL { sections.push(block.clone()); used += est_tokens(&block); }
    }

    // Sessions
    let mut sessions: Vec<_> = local.iter()
        .filter(|m| m.effective_type() == MT_SESSION && m.is_active()).collect();
    scorer::rank_by_score(&mut sessions, agent_type);
    let sessions: Vec<_> = sessions.into_iter().take(2).collect();
    if !sessions.is_empty() && used < BUDGET_TOTAL {
        let mut block = String::from("RECENT SESSIONS:\n");
        for s in &sessions { block.push_str(&format!("• {}\n", compress(&s.content, 5))); }
        if used + est_tokens(&block) <= BUDGET_TOTAL { sections.push(block.clone()); used += est_tokens(&block); }
    }

    // Blockers
    let mut blockers: Vec<_> = local.iter()
        .filter(|m| m.effective_type() == MT_BLOCKER && !m.resolved && m.is_active()).collect();
    scorer::rank_by_score(&mut blockers, agent_type);
    let blockers: Vec<_> = blockers.into_iter().take(4).collect();
    if !blockers.is_empty() && used < BUDGET_TOTAL {
        let mut block = String::from("BLOCKERS (dead ends — do NOT retry):\n");
        for b in &blockers {
            let stale = if b.is_stale_blocker() { " (30d+ old)" } else { "" };
            block.push_str(&format!("• {}{}\n", compress(&b.content, 2), stale));
        }
        if used + est_tokens(&block) <= BUDGET_TOTAL { sections.push(block.clone()); used += est_tokens(&block); }
    }

    // Failures
    let mut failures: Vec<_> = local.iter()
        .filter(|m| m.effective_type() == MT_FAILURE && m.is_active()).collect();
    if !task_lower.is_empty() { ann_rank(&mut failures, &task_lower); }
    else { failures.sort_by(|a, b| b.timestamp.cmp(&a.timestamp)); }
    let failures: Vec<_> = failures.into_iter().take(5).collect();
    if !failures.is_empty() && used < BUDGET_TOTAL {
        let mut block = String::from("FAILURES (don't re-break):\n");
        for f in &failures { block.push_str(&format!("• {}\n", compress(&f.content, 3))); }
        if used + est_tokens(&block) <= BUDGET_TOTAL { sections.push(block.clone()); used += est_tokens(&block); }
    }

    // Local env
    let local_env: Vec<_> = local.iter()
        .filter(|m| m.effective_type() == MT_ENVIRONMENT && m.scope != SCOPE_MACHINE && m.is_active()).collect();
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
                    env_map.insert(format!("note_{}", env_map.len()), (t.to_string(), e.env_unverified()));
                }
            }
        }
        if !env_map.is_empty() {
            let mut block = String::from("ENV (this runbox):\n");
            for (k, (v, unverified)) in &env_map {
                let note = if *unverified { " (unverified)" } else { "" };
                block.push_str(&format!("{k}={v}{note}\n"));
            }
            let room = BUDGET_ENV_LOCAL.min(BUDGET_TOTAL.saturating_sub(used));
            if est_tokens(&block) <= room { sections.push(block.clone()); used += est_tokens(&block); }
        }
    }

    // Codebase
    let mut codebase: Vec<_> = local.iter()
        .filter(|m| m.effective_type() == MT_CODEBASE && m.is_active()).collect();
    if !task_lower.is_empty() { ann_rank(&mut codebase, &task_lower); }
    let codebase: Vec<_> = codebase.into_iter().take(3).collect();
    if !codebase.is_empty() && used < BUDGET_TOTAL {
        let mut block = String::from("CODEBASE MAP:\n");
        for c in &codebase { block.push_str(&format!("{}\n", compress(&c.content, 4))); }
        if used + est_tokens(&block) <= BUDGET_TOTAL { sections.push(block.clone()); used += est_tokens(&block); }
    }

    if sections.is_empty() { return String::new(); }
    let output = sections.join("\n---\n");
    let approx = est_tokens(&output);
    format!("{}\n\n[~{approx} tokens]\n", output.trim())
}