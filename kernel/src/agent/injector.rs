// src-tauri/src/agent/injector.rs
//
// Context Injector — V3 4-level build + V2 legacy build.
//
// FIX (injector-budget): The SESSION section budget check was a tautology.
// FIX (session-agent-filter): Own-agent sessions come first, cross-agent fill remaining budget.
// FIX (signal-density): Sessions and STATE.md are now parsed for structured fields only.
//   Agents get the same knowledge in ~1/4 the tokens:
//   - session: "goal: X | done: Y | blocked: Z"  instead of free-form paragraph
//   - state:   "status: X | doing: Y | blocked: Z" instead of 20-line STATE.md dump
//   - roadmap: 4 lines not 8, paths stripped
//   - metadata: 40 token room not 80

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::agent::embedder;
use crate::memory::{
    self, now_ms, Memory, LEVEL_LOCKED, LEVEL_PREFERRED, LEVEL_SESSION, LEVEL_TEMPORARY,
    MT_BLOCKER, MT_FAILURE, MT_GOAL, MT_SESSION,
};

// ── Token budgets ─────────────────────────────────────────────────────────────
const BUDGET_LOCKED: usize = 120;
const BUDGET_SESSION: usize = 80;   // tighter — structured summaries need fewer tokens
const BUDGET_PREFERRED: usize = 120;
const BUDGET_TEMPORARY: usize = 60;
const BUDGET_TOTAL_V3: usize = 480;

// V2 budgets (legacy)
const BUDGET_GOAL: usize = 600;
const BUDGET_SESSION_V2: usize = 400;
const BUDGET_BLOCKERS: usize = 400;
const BUDGET_FAILURES: usize = 700;
const BUDGET_TOTAL: usize = 3000;

fn est_tokens(s: &str) -> usize {
    (s.len() / 4).max(1)
}

fn compress(content: &str, max_lines: usize) -> String {
    content
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .take(max_lines)
        .collect::<Vec<_>>()
        .join(" · ")
}

fn keyword_relevance(content: &str, task: &str) -> f32 {
    if task.is_empty() {
        return 0.0;
    }
    let cl = content.to_lowercase();
    let words: Vec<&str> = task.split_whitespace().collect();
    let hits = words
        .iter()
        .filter(|w| w.len() > 3 && cl.contains(w.to_lowercase().as_str()))
        .count();
    hits as f32 / words.len().max(1) as f32
}

fn ann_rank<'a>(memories: &mut Vec<&'a Memory>, task: &str) {
    if task.is_empty() {
        return;
    }
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

// ── Signal extractors ─────────────────────────────────────────────────────────

/// Extract structured signal from a session summary.
///
/// Agents are instructed to write summaries in key: value format:
///   goal: implement auth module
///   done: JWT middleware, token refresh
///   blocked: Redis → using in-memory cache
///   next: write tests
///
/// If structured fields are found → returns them as a compact pipe-separated line.
/// If unstructured → falls back to first 2 lines, each truncated to 60 chars.
///
/// Example output: "goal: auth module | done: JWT middleware | blocked: Redis→in-memory"
pub fn extract_session_signal(content: &str) -> String {
    let known_keys = ["goal", "done", "blocked", "next"];
    let mut fields: Vec<(String, String)> = Vec::new();

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        // Look for "key: value" pattern
        if let Some(colon) = line.find(':') {
            let key = line[..colon].trim().to_lowercase();
            let val = line[colon + 1..].trim();
            if known_keys.contains(&key.as_str()) && !val.is_empty() && val != "-" {
                // Truncate value to 60 chars
                let val_short = if val.len() > 60 {
                    format!("{}…", &val[..59])
                } else {
                    val.to_string()
                };
                fields.push((key, val_short));
            }
        }
    }

    if fields.len() >= 2 {
        // Structured: format as compact pipe-separated line
        return fields
            .iter()
            .map(|(k, v)| format!("{k}: {v}"))
            .collect::<Vec<_>>()
            .join(" | ");
    }

    // Fallback: first 2 non-empty, non-header lines, truncated
    content
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .take(2)
        .map(|l| if l.len() > 70 { &l[..70] } else { l })
        .collect::<Vec<_>>()
        .join(" · ")
}

/// Extract structured signal from STATE.md content.
///
/// STATE.md format (enforced by initial template):
///   status: in-progress
///   doing: implementing JWT middleware
///   ## blocked
///   - Redis connection
///
/// Returns: "status: in-progress | doing: implementing JWT | blocked: Redis"
/// Skips fields that are empty or just "-".
pub fn extract_state_signal(content: &str) -> String {
    let mut status = String::new();
    let mut doing = String::new();
    let mut blocked = String::new();
    let mut next_field = String::new();

    let mut current_section: Option<&str> = None;

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // Section headers
        if line == "## doing" || line == "## Doing" {
            current_section = Some("doing");
            continue;
        }
        if line == "## blocked" || line == "## Blocked" {
            current_section = Some("blocked");
            continue;
        }
        if line == "## next" || line == "## Next" {
            current_section = Some("next");
            continue;
        }
        if line.starts_with("## ") {
            current_section = None;
            continue;
        }
        if line.starts_with('#') {
            continue;
        }

        // key: value lines (top-level)
        if let Some(colon) = line.find(':') {
            let key = line[..colon].trim().to_lowercase();
            let val = line[colon + 1..].trim().to_string();
            match key.as_str() {
                "status" if !val.is_empty() => status = val,
                "doing" if !val.is_empty() && val != "-" => doing = val,
                "blocked" if !val.is_empty() && val != "-" => blocked = val,
                "next" if !val.is_empty() && val != "-" => next_field = val,
                _ => {}
            }
            continue;
        }

        // Bullet lines under section headers
        if let Some(section) = current_section {
            let bullet = line.trim_start_matches('-').trim().to_string();
            if !bullet.is_empty() && bullet != "-" {
                match section {
                    "doing" if doing.is_empty() => doing = bullet,
                    "blocked" if blocked.is_empty() => blocked = bullet,
                    "next" if next_field.is_empty() => next_field = bullet,
                    _ => {}
                }
                // Only take the first bullet per section
                current_section = None;
            }
        }
    }

    let mut parts: Vec<String> = Vec::new();
    if !status.is_empty() {
        parts.push(format!("status: {status}"));
    }
    if !doing.is_empty() {
        let short = if doing.len() > 60 { &doing[..60] } else { &doing };
        parts.push(format!("doing: {short}"));
    }
    if !blocked.is_empty() {
        let short = if blocked.len() > 60 { &blocked[..60] } else { &blocked };
        parts.push(format!("blocked: {short}"));
    } else if !next_field.is_empty() {
        let short = if next_field.len() > 60 { &next_field[..60] } else { &next_field };
        parts.push(format!("next: {short}"));
    }

    if parts.is_empty() {
        return String::new();
    }
    parts.join(" | ")
}

// ── Session cache ─────────────────────────────────────────────────────────────

struct CacheEntry {
    output: String,
    ts: i64,
}
type Cache = Arc<Mutex<HashMap<String, CacheEntry>>>;

static CACHE: std::sync::OnceLock<Cache> = std::sync::OnceLock::new();
fn cache() -> &'static Cache {
    CACHE.get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
}

fn cache_key(runbox_id: &str, task: &str, agent_id: &str) -> String {
    format!(
        "{}:{}:{}",
        runbox_id,
        &agent_id[..agent_id.len().min(20)],
        &task[..task.len().min(30)]
    )
}

const CACHE_TTL_MS: i64 = 60_000;

pub async fn invalidate_cache(runbox_id: &str) {
    let mut c = cache().lock().await;
    c.retain(|k, _| !k.starts_with(runbox_id));
}

// ── Startup: LOCKED-only injection ────────────────────────────────────────────

pub async fn build_locked_only(runbox_id: &str) -> String {
    let all = memory::memories_for_runbox(runbox_id)
        .await
        .unwrap_or_default();
    let locked: Vec<_> = all
        .iter()
        .filter(|m| m.effective_level() == LEVEL_LOCKED && !m.resolved)
        .collect();

    if locked.is_empty() {
        return String::new();
    }

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
        c.insert(
            key,
            CacheEntry {
                output: result.clone(),
                ts: now_ms(),
            },
        );
    }

    result
}

/// Extract agent kind prefix from agent_id.
/// agent_id format: "{kind}:{session_id}", e.g. "codex:abc123"
fn agent_kind_from_id(agent_id: &str) -> &str {
    agent_id.split(':').next().unwrap_or("")
}

async fn build_v3_uncached(runbox_id: &str, task: &str, agent_id: &str) -> String {
    let all = memory::memories_for_runbox(runbox_id)
        .await
        .unwrap_or_default();
    let cwd = crate::agent::globals::get_runbox_cwd(runbox_id);

    let mut sections: Vec<String> = Vec::new();
    let mut used: usize = 0;

    // ── 1. LOCKED — always first, always full ─────────────────────────────────
    let locked: Vec<_> = all
        .iter()
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
            let capped = locked
                .iter()
                .take(5)
                .map(|l| format!("• {}", l.content.trim()))
                .collect::<Vec<_>>()
                .join("\n");
            let block = format!("LOCKED:\n{capped}\n");
            sections.push(block.clone());
            used += est_tokens(&block);
        }
    }

    // ── 1b. GCC: main.md — global project roadmap (4 lines, no paths) ────────
    if !cwd.is_empty() && used < BUDGET_TOTAL_V3 {
        let main_md = crate::memory::filesystem::read_main_md(&cwd);
        if !main_md.trim().is_empty() {
            let trimmed: String = main_md
                .lines()
                .map(str::trim)
                .filter(|l| !l.starts_with('#'))
                .filter(|l| !l.is_empty())
                .filter(|l| !l.starts_with('_'))
                // Strip path-like lines (start with / or ~) — pure noise
                .filter(|l| !l.starts_with('/') && !l.starts_with('~'))
                .take(4)  // was 8
                .collect::<Vec<_>>()
                .join("\n");

            if !trimmed.is_empty() {
                let block = format!("ROADMAP:\n{trimmed}\n");
                let room = 40usize.min(BUDGET_TOTAL_V3.saturating_sub(used)); // was 60
                if est_tokens(&block) <= room {
                    sections.push(block.clone());
                    used += est_tokens(&block);
                }
            }
        }
    }

    // ── 2. SESSION — own-agent first, cross-agent second, signal-extracted ────
    //
    // agent_id format: "{kind}:{session_id}" — extract kind prefix.
    // Own sessions come first. Each session compressed to structured signal
    // (~15 tokens) instead of raw content (~60+ tokens).
    let current_kind = agent_kind_from_id(agent_id);

    let mut all_sessions: Vec<_> = all
        .iter()
        .filter(|m| m.effective_level() == LEVEL_SESSION && !m.resolved)
        .collect();
    all_sessions.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    let (own_sessions, other_sessions): (Vec<_>, Vec<_>) = all_sessions
        .into_iter()
        .partition(|m| agent_kind_from_id(&m.agent_id) == current_kind);

    // Up to 2 own, 1 cross-agent
    let own_take = own_sessions.into_iter().take(2).collect::<Vec<_>>();
    let other_take = other_sessions.into_iter().take(1).collect::<Vec<_>>();
    let session_candidates: Vec<_> = own_take.iter().chain(other_take.iter()).collect();

    if !session_candidates.is_empty() && used < BUDGET_TOTAL_V3 {
        let mut block = String::from("RECENT SESSIONS:\n");
        for s in &session_candidates {
            let agent_label = s.agent_id.split(':').next().unwrap_or("agent");
            let age = s.age_label();
            // Signal-extract: structured fields only, not raw prose
            let signal = extract_session_signal(&s.content);
            if signal.is_empty() {
                continue;
            }
            let cross = if agent_label != current_kind { " [other]" } else { "" };
            block.push_str(&format!("• [{agent_label} {age}{cross}] {signal}\n"));
        }

        if used + est_tokens(&block) <= BUDGET_TOTAL_V3 {
            sections.push(block.clone());
            used += est_tokens(&block);
        } else if let Some(first) = session_candidates.first() {
            let signal = extract_session_signal(&first.content);
            let agent_label = first.agent_id.split(':').next().unwrap_or("agent");
            let one = format!(
                "RECENT SESSIONS:\n• [{agent_label} {}] {signal}\n",
                first.age_label()
            );
            if used + est_tokens(&one) <= BUDGET_TOTAL_V3 {
                sections.push(one.clone());
                used += est_tokens(&one);
            }
        }
    }

    // ── 2b. GCC: metadata.yaml — project architecture (tight budget) ──────────
    if !cwd.is_empty() && used < BUDGET_TOTAL_V3 {
        let meta = crate::memory::filesystem::read_metadata_yaml(&cwd);
        if !meta.trim().is_empty() {
            let block = format!("PROJECT META:\n{}\n", meta.trim());
            let room = 40usize.min(BUDGET_TOTAL_V3.saturating_sub(used)); // was 80
            if est_tokens(&block) <= room {
                sections.push(block.clone());
                used += est_tokens(&block);
            }
        }
    }

    // ── 3. PREFERRED — recency ranked, dedup by key, 2 lines not 3 ───────────
    let mut preferred: Vec<_> = all
        .iter()
        .filter(|m| m.effective_level() == LEVEL_PREFERRED && !m.resolved && m.is_active())
        .collect();

    preferred.sort_by(|a, b| {
        b.scope
            .contains("machine")
            .cmp(&a.scope.contains("machine"))
    });
    ann_rank(&mut preferred, task);

    let mut seen_keys: std::collections::HashSet<String> = std::collections::HashSet::new();
    let preferred: Vec<_> = preferred
        .into_iter()
        .filter(|m| {
            if m.key.is_empty() {
                return true;
            }
            seen_keys.insert(m.key.clone())
        })
        .collect();

    if !preferred.is_empty() && used < BUDGET_TOTAL_V3 {
        let budget_p = BUDGET_PREFERRED.min(BUDGET_TOTAL_V3.saturating_sub(used));
        let mut block = String::from("CONTEXT:\n");
        let mut block_tokens = est_tokens(&block);
        for p in &preferred {
            // 2 lines not 3 — enough signal, fewer tokens
            let line = format!("• [{}] {}\n", p.effective_type(), compress(&p.content, 2));
            let lt = est_tokens(&line);
            if block_tokens + lt > budget_p {
                break;
            }
            block.push_str(&line);
            block_tokens += lt;
        }
        if block_tokens > est_tokens("CONTEXT:\n") {
            sections.push(block);
            used += block_tokens;
        }
    }

    // ── 4. TEMPORARY — this agent's own active notes ──────────────────────────
    let mut temporary: Vec<_> = all
        .iter()
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
        for t in temporary.iter().take(4) { // was 5
            let line = format!("• {}\n", compress(&t.content, 1)); // 1 line not 2
            let lt = est_tokens(&line);
            if block_tokens + lt > budget_t {
                break;
            }
            block.push_str(&line);
            block_tokens += lt;
        }
        if block_tokens > est_tokens("MY NOTES:\n") {
            sections.push(block);
        }
    }

    // ── 5. PERSISTENT MEMORY — state signal, not raw STATE.md dump ───────────
    // Extracts only status/doing/blocked — ~12 tokens instead of 80.
    if used < BUDGET_TOTAL_V3 {
        if let Some((wt_cwd, wt_name)) =
            crate::workspace::persistent::get_session_info(runbox_id)
        {
            let sp = crate::workspace::persistent::state_path(&wt_cwd, &wt_name);
            let lp = crate::workspace::persistent::log_path(&wt_cwd, &wt_name);
            let gp = crate::workspace::persistent::graph_md_path(&wt_cwd);

            // Parse STATE.md for signal fields only, not raw content
            let state_signal = crate::workspace::persistent::read_agent_state(&wt_cwd, &wt_name)
                .map(|s| extract_state_signal(&s))
                .unwrap_or_default();

            let mut block = format!(
                "PERSISTENT MEMORY:\nstate: {state}\nlog:   {log}\ngraph: {graph}\n",
                state = sp.display(),
                log = lp.display(),
                graph = gp.display(),
            );

            // Inject signal on one line — not a raw multi-line dump
            if !state_signal.is_empty() {
                block.push_str(&format!("current: {state_signal}\n"));
            }

            block.push_str(
                "rules: read state on start · update state + append log during work · \
                 set status=done on finish · never write these files into user repo\n",
            );

            let bt = est_tokens(&block);
            if used + bt <= BUDGET_TOTAL_V3 {
                sections.push(block);
                used += bt;
            }
        }
    }

    if sections.is_empty() {
        return String::new();
    }

    format!(
        "<!-- stackbox context: ~{used} tokens -->\n{}\n<!-- end context -->",
        sections.join("\n")
    )
}

// ── V2 legacy build_context ───────────────────────────────────────────────────

pub async fn build_context(runbox_id: &str, _task: &str) -> String {
    let all = memory::memories_for_runbox(runbox_id)
        .await
        .unwrap_or_default();
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
                    if bt + lt > budget {
                        break;
                    }
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

    let goals: Vec<_> = all
        .iter()
        .filter(|m| m.effective_type() == MT_GOAL && !m.resolved)
        .collect();
    add_section!("GOALS:\n", goals, BUDGET_GOAL, |m: &&Memory| {
        format!("• {}\n", m.content.trim())
    });

    let mut sess: Vec<_> = all
        .iter()
        .filter(|m| m.effective_type() == MT_SESSION)
        .collect();
    sess.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    add_section!(
        "RECENT SESSIONS:\n",
        sess.into_iter().take(3).collect::<Vec<_>>(),
        BUDGET_SESSION_V2,
        |m: &&Memory| {
            let signal = extract_session_signal(&m.content);
            format!("• [{}] {}\n", m.age_label(), signal)
        }
    );

    let blockers: Vec<_> = all
        .iter()
        .filter(|m| m.effective_type() == MT_BLOCKER && !m.resolved)
        .collect();
    add_section!("BLOCKERS:\n", blockers, BUDGET_BLOCKERS, |m: &&Memory| {
        format!("• {}\n", m.content.trim())
    });

    let failures: Vec<_> = all
        .iter()
        .filter(|m| m.effective_type() == MT_FAILURE && !m.resolved)
        .collect();
    add_section!(
        "KNOWN FAILURES:\n",
        failures,
        BUDGET_FAILURES,
        |m: &&Memory| { format!("• {}\n", m.content.trim()) }
    );

    if sections.is_empty() {
        return String::new();
    }
    format!(
        "<!-- context ~{used}t -->\n{}\n<!-- /context -->",
        sections.join("\n")
    )
}