// src-tauri/src/agent/injector.rs
//
// Context Injector — V3 4-level build + V2 legacy build.
//
// FIX (injector-budget): The SESSION section budget check was a tautology:
//   `used + est_tokens(&block) <= used + BUDGET_SESSION`
//   simplifies to `est_tokens(&block) <= BUDGET_SESSION`, so the block
//   could silently exceed BUDGET_TOTAL_V3. Fixed to check against the total:
//   `used + est_tokens(&block) <= BUDGET_TOTAL_V3`

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::memory::{
    self, Memory,
    LEVEL_LOCKED, LEVEL_PREFERRED, LEVEL_TEMPORARY, LEVEL_SESSION,
    MT_GOAL, MT_SESSION, MT_BLOCKER, MT_FAILURE,
    now_ms,
};
use crate::agent::embedder;

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

// ── Startup: LOCKED-only injection ────────────────────────────────────────────

pub async fn build_locked_only(runbox_id: &str) -> String {
    let all = memory::memories_for_runbox(runbox_id).await.unwrap_or_default();
    let locked: Vec<_> = all.iter()
        .filter(|m| m.effective_level() == LEVEL_LOCKED && !m.resolved)
        .collect();

    if locked.is_empty() { return String::new(); }

    let mut block = String::from("LOCKED (absolute rules — these override everything):\n");
    for l in locked.iter().take(5) {
        block.push_str(&format!("• {}\n", l.content.trim()));
    }
    let approx = est_tokens(&block);
    format!("{}\n[~{approx} tokens — startup only]\n", block.trim())
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

async fn build_v3_uncached(runbox_id: &str, task: &str, agent_id: &str) -> String {
    let all = memory::memories_for_runbox(runbox_id).await.unwrap_or_default();
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
    if !cwd.is_empty() && used < BUDGET_TOTAL_V3 {
        let main_md = crate::memory::filesystem::read_main_md(&cwd);
        if !main_md.trim().is_empty() {
            let trimmed: String = main_md.lines()
                .filter(|l| !l.trim_start().starts_with('#'))
                .filter(|l| !l.trim().is_empty())
                .filter(|l| !l.trim().starts_with('_'))
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
        // FIX: was `used + est_tokens(&block) <= used + BUDGET_SESSION`
        // which is a tautology (used cancels). Correct check is against total.
        if used + est_tokens(&block) <= BUDGET_TOTAL_V3 {
            sections.push(block.clone());
            used += est_tokens(&block);
        } else {
            // Trim to one session if over budget
            let one = format!("RECENT SESSIONS:\n• {}\n",
                compress(&sessions[0].content, 3));
            if used + est_tokens(&one) <= BUDGET_TOTAL_V3 {
                sections.push(one.clone());
                used += est_tokens(&one);
            }
        }
    }

    // ── 2b. GCC: metadata.yaml — project architecture ─────────────────────────
    if !cwd.is_empty() && used < BUDGET_TOTAL_V3 {
        let meta = crate::memory::filesystem::read_metadata_yaml(&cwd);
        if !meta.trim().is_empty() {
            let block = format!("PROJECT META:\n{}\n", meta.trim());
            let room  = 80usize.min(BUDGET_TOTAL_V3.saturating_sub(used));
            if est_tokens(&block) <= room {
                sections.push(block.clone());
                used += est_tokens(&block);
            }
        }
    }

    // ── 3. PREFERRED — recency ranked, dedup by key ───────────────────────────
    let mut preferred: Vec<_> = all.iter()
        .filter(|m| m.effective_level() == LEVEL_PREFERRED && !m.resolved && m.is_active())
        .collect();

    // Machine-scope first, then ANN rank
    preferred.sort_by(|a, b| {
        b.scope.contains("machine").cmp(&a.scope.contains("machine"))
    });
    ann_rank(&mut preferred, task);

    // Dedup by key
    let mut seen_keys: std::collections::HashSet<String> = std::collections::HashSet::new();
    let preferred: Vec<_> = preferred.into_iter()
        .filter(|m| {
            if m.key.is_empty() { return true; }
            seen_keys.insert(m.key.clone())
        })
        .collect();

    if !preferred.is_empty() && used < BUDGET_TOTAL_V3 {
        let budget_p = BUDGET_PREFERRED.min(BUDGET_TOTAL_V3.saturating_sub(used));
        let mut block = String::from("CONTEXT:\n");
        let mut block_tokens = est_tokens(&block);
        for p in &preferred {
            let line = format!("• [{}] {}\n",
                p.effective_type(),
                compress(&p.content, 3));
            let lt = est_tokens(&line);
            if block_tokens + lt > budget_p { break; }
            block.push_str(&line);
            block_tokens += lt;
        }
        if block_tokens > est_tokens("CONTEXT:\n") {
            sections.push(block);
            used += block_tokens;
        }
    }

    // ── 4. TEMPORARY — this agent's own active notes ──────────────────────────
    let mut temporary: Vec<_> = all.iter()
        .filter(|m| {
            m.effective_level() == LEVEL_TEMPORARY
                && m.agent_id == agent_id
                && !m.resolved
                && m.is_active()
        })
        .collect();
    temporary.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    if !temporary.is_empty() && used < BUDGET_TOTAL_V3 {
        let budget_t = BUDGET_TEMPORARY.min(BUDGET_TOTAL_V3.saturating_sub(used));
        let mut block = String::from("MY NOTES:\n");
        let mut block_tokens = est_tokens(&block);
        for t in temporary.iter().take(5) {
            let line = format!("• {}\n", compress(&t.content, 2));
            let lt = est_tokens(&line);
            if block_tokens + lt > budget_t { break; }
            block.push_str(&line);
            block_tokens += lt;
        }
        if block_tokens > est_tokens("MY NOTES:\n") {
            sections.push(block);
        }
    }

    if sections.is_empty() { return String::new(); }

    format!(
        "<!-- stackbox context: ~{used} tokens -->\n{}\n<!-- end context -->",
        sections.join("\n")
    )
}

// ── V2 legacy build_context ───────────────────────────────────────────────────

pub async fn build_context(runbox_id: &str, _task: &str) -> String {
    let all = memory::memories_for_runbox(runbox_id).await.unwrap_or_default();
    let mut sections: Vec<String> = Vec::new();
    let mut used = 0usize;

    macro_rules! add_section {
        ($header:expr, $items:expr, $budget:expr, $fmt:expr) => {{
            let items: Vec<_> = $items;
            if !items.is_empty() && used < BUDGET_TOTAL {
                let budget = $budget.min(BUDGET_TOTAL - used);
                let mut block = String::from($header);
                let mut bt = est_tokens(&block);
                for item in &items {
                    let line = $fmt(item);
                    let lt = est_tokens(&line);
                    if bt + lt > budget { break; }
                    block.push_str(&line);
                    bt += lt;
                }
                if bt > est_tokens($header) {
                    used += bt;
                    sections.push(block);
                }
            }
        }};
    }

    // Goals
    let goals: Vec<_> = all.iter()
        .filter(|m| m.effective_type() == MT_GOAL && !m.resolved)
        .collect();
    add_section!("GOALS:\n", goals, BUDGET_GOAL, |m: &&Memory| {
        format!("• {}\n", m.content.trim())
    });

    // Session summaries
    let mut sess: Vec<_> = all.iter()
        .filter(|m| m.effective_type() == MT_SESSION)
        .collect();
    sess.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    add_section!("RECENT SESSIONS:\n", sess.into_iter().take(3).collect::<Vec<_>>(), BUDGET_SESSION_V2, |m: &&Memory| {
        format!("• [{}] {}\n", m.age_label(), compress(&m.content, 5))
    });

    // Blockers
    let blockers: Vec<_> = all.iter()
        .filter(|m| m.effective_type() == MT_BLOCKER && !m.resolved)
        .collect();
    add_section!("BLOCKERS:\n", blockers, BUDGET_BLOCKERS, |m: &&Memory| {
        format!("• {}\n", m.content.trim())
    });

    // Failures
    let failures: Vec<_> = all.iter()
        .filter(|m| m.effective_type() == MT_FAILURE && !m.resolved)
        .collect();
    add_section!("KNOWN FAILURES:\n", failures, BUDGET_FAILURES, |m: &&Memory| {
        format!("• {}\n", m.content.trim())
    });

    if sections.is_empty() { return String::new(); }
    format!("<!-- context ~{used}t -->\n{}\n<!-- /context -->", sections.join("\n"))
}