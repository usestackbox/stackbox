// src-tauri/src/memory/sleep.rs
//
// Sleep-time background jobs — run in separate tokio tasks when RunBox is idle.
// Modelled on the Letta sleep-time layer.
//
// Three jobs:
//   boot_init   — on new RunBox: scan codebase → bootstrap metadata.yaml + main.md
//   reflection  — after session ends: review logs → persist insights as PREFERRED
//   defrag      — weekly: merge duplicate keys, prune caps, reorganise /memory/
//
// Rules:
//   - All jobs run in background tokio tasks — never block the active agent
//   - Jobs are additive — they never delete LOCKED memories
//   - boot_init is a no-op if metadata.yaml is < 7 days old
//   - reflection only fires if the session produced session_log entries
//   - defrag checks a sentinel file to enforce the weekly cadence

use crate::{
    db::Db,
    memory::{self, LEVEL_LOCKED, LEVEL_PREFERRED, LEVEL_SESSION, now_ms},
    memory::filesystem,
};

// ── Boot init ──────────────────────────────────────────────────────────────────

/// Run on first agent spawn in a RunBox, or after 7 days.
/// Scans the codebase, writes metadata.yaml + main.md bootstrap.
/// Non-blocking — call via tauri::async_runtime::spawn().
pub async fn boot_init(runbox_id: &str, cwd: &str, db: &Db) {
    // Skip if metadata.yaml is recent (< 7 days)
    let meta_path = filesystem::memory_dir(cwd).join("metadata.yaml");
    let seven_days_secs: u64 = 7 * 86_400;
    if let Ok(meta) = std::fs::metadata(&meta_path) {
        if let Ok(modified) = meta.modified() {
            if std::time::SystemTime::now()
                .duration_since(modified)
                .map(|d| d.as_secs() < seven_days_secs)
                .unwrap_or(false)
            {
                return;
            }
        }
    }

    eprintln!("[sleep] boot_init runbox={runbox_id}");

    // 1. Ensure /memory/ repo exists
    filesystem::ensure_memory_repo(cwd).ok();

    // 2. Generate + write metadata.yaml
    let metadata = generate_metadata(cwd, db).await;
    if !metadata.is_empty() {
        if let Err(e) = filesystem::write_metadata_yaml(cwd, &metadata) {
            eprintln!("[sleep] write metadata.yaml: {e}");
        }
    }

    // 3. Bootstrap main.md if not present
    let main_path = filesystem::memory_dir(cwd).join("main.md");
    if !main_path.exists() {
        let project_name = detect_project_name(cwd);
        let content = format!(
            "## Project: {project_name}\n\n\
             _Auto-generated on first boot. Edit freely — all agents read this._\n\n\
             ### Goals\n\n- (none set yet — add goals here)\n\n\
             ### Milestones\n\n- (none yet)\n\n\
             ### Constraints\n\n- (see locked.toml for hard rules)\n"
        );
        filesystem::write_main_md(cwd, &content).ok();
    }

    // 4. Sync existing memories and initial commit
    if let Ok(mems) = memory::memories_for_runbox(runbox_id).await {
        filesystem::sync_to_fs(runbox_id, cwd, &mems).await;
    }
    filesystem::commit_memory_async(
        cwd,
        format!("stackbox: boot init — {}", detect_project_name(cwd)),
    );

    eprintln!("[sleep] boot_init complete runbox={runbox_id}");
}

// ── metadata.yaml generation ───────────────────────────────────────────────────

async fn generate_metadata(cwd: &str, _db: &Db) -> String {
    let mut yaml = String::new();
    yaml.push_str("# Stackbox metadata — auto-generated on agent spawn\n");
    yaml.push_str("# Agents read this directly: cat memory/metadata.yaml\n");
    yaml.push_str("# Edit freely — Stackbox merges on next spawn\n\n");

    let name = detect_project_name(cwd);
    let kind = detect_project_type(cwd);
    yaml.push_str(&format!("project:\n  name: {name}\n  type: {kind}\n\n"));

    let env = scan_env_config(cwd);
    if !env.is_empty() {
        yaml.push_str("env:\n");
        yaml.push_str(&env);
        yaml.push('\n');
    }

    let files = scan_file_structure(cwd);
    if !files.is_empty() {
        yaml.push_str("files:\n");
        yaml.push_str(&files);
        yaml.push('\n');
    }

    let deps = scan_dependencies(cwd);
    if !deps.is_empty() {
        yaml.push_str("deps:\n");
        yaml.push_str(&deps);
        yaml.push('\n');
    }

    let arch = scan_arch_docs(cwd);
    if !arch.is_empty() {
        yaml.push_str("arch:\n");
        yaml.push_str(&arch);
        yaml.push('\n');
    }

    yaml
}

fn detect_project_name(cwd: &str) -> String {
    let p = std::path::Path::new(cwd);

    // package.json
    if let Ok(s) = std::fs::read_to_string(p.join("package.json")) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
            if let Some(n) = v.get("name").and_then(|n| n.as_str()) {
                if !n.is_empty() { return n.to_string(); }
            }
        }
    }

    // Cargo.toml
    if let Ok(s) = std::fs::read_to_string(p.join("Cargo.toml")) {
        let mut in_pkg = false;
        for line in s.lines() {
            if line.trim() == "[package]" { in_pkg = true; continue; }
            if in_pkg && line.trim().starts_with('[') { break; }
            if in_pkg {
                if let Some(rest) = line.strip_prefix("name") {
                    let v = rest.trim_start_matches([' ', '=']).trim().trim_matches('"');
                    if !v.is_empty() { return v.to_string(); }
                }
            }
        }
    }

    // pyproject.toml
    if let Ok(s) = std::fs::read_to_string(p.join("pyproject.toml")) {
        for line in s.lines() {
            if let Some(rest) = line.strip_prefix("name") {
                let v = rest.trim_start_matches([' ', '=']).trim().trim_matches('"');
                if !v.is_empty() { return v.to_string(); }
            }
        }
    }

    // Directory name as fallback
    p.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

fn detect_project_type(cwd: &str) -> &'static str {
    let p = std::path::Path::new(cwd);
    if p.join("Cargo.toml").exists()                       { return "rust"; }
    if p.join("package.json").exists()                     { return "node"; }
    if p.join("pyproject.toml").exists()
        || p.join("setup.py").exists()
        || p.join("requirements.txt").exists()             { return "python"; }
    if p.join("go.mod").exists()                           { return "go"; }
    if p.join("pom.xml").exists()                          { return "java"; }
    "unknown"
}

fn scan_env_config(cwd: &str) -> String {
    let mut out = String::new();
    let p = std::path::Path::new(cwd);

    // .env or .env.example — show only key names, never values
    for env_file in &[".env.example", ".env.local", ".env"] {
        if let Ok(s) = std::fs::read_to_string(p.join(env_file)) {
            for line in s.lines().take(30) {
                let t = line.trim();
                if t.starts_with('#') || t.is_empty() { continue; }
                if let Some(eq) = t.find('=') {
                    let key = t[..eq].trim();
                    if !key.is_empty() {
                        out.push_str(&format!("  {key}: \"(set)\"\n"));
                    }
                }
            }
            if !out.is_empty() { break; }
        }
    }

    out
}

fn scan_file_structure(cwd: &str) -> String {
    let mut out = String::new();
    let p = std::path::Path::new(cwd);

    // Key entry points
    let entry_points = [
        ("src/main.rs",    "entry point"),
        ("src/lib.rs",     "library root"),
        ("src/main.ts",    "entry point"),
        ("src/main.js",    "entry point"),
        ("src/index.ts",   "module root"),
        ("src/index.js",   "module root"),
        ("src/app.ts",     "app root"),
        ("src/app.js",     "app root"),
        ("main.py",        "entry point"),
        ("app.py",         "app root"),
        ("src/main.py",    "entry point"),
    ];
    for (f, role) in &entry_points {
        if p.join(f).exists() {
            out.push_str(&format!("  {f}: {role}\n"));
        }
    }

    // Config files
    for (f, role) in &[
        ("tauri.conf.json",  "Tauri config"),
        ("next.config.js",   "Next.js config"),
        ("vite.config.ts",   "Vite config"),
        ("tsconfig.json",    "TypeScript config"),
        (".env",             "environment variables"),
    ] {
        if p.join(f).exists() {
            out.push_str(&format!("  {f}: {role}\n"));
        }
    }

    // src/ subdirectories — each is a module
    if let Ok(entries) = std::fs::read_dir(p.join("src")) {
        let mut dirs: Vec<String> = entries
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| !n.starts_with('.') && n != "node_modules" && n != "target")
            .take(12)
            .collect();
        dirs.sort();
        for d in &dirs {
            out.push_str(&format!("  src/{d}/: module\n"));
        }
    }

    out
}

fn scan_dependencies(cwd: &str) -> String {
    let mut out = String::new();
    let p = std::path::Path::new(cwd);

    // package.json — prod dependencies only, capped at 12
    if let Ok(s) = std::fs::read_to_string(p.join("package.json")) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
            if let Some(deps) = v.get("dependencies").and_then(|d| d.as_object()) {
                for (name, ver) in deps.iter().take(12) {
                    let v = ver.as_str().unwrap_or("*");
                    out.push_str(&format!("  {name}: \"{v}\"\n"));
                }
            }
        }
    }

    // Cargo.toml — [dependencies] section, capped at 12
    if let Ok(s) = std::fs::read_to_string(p.join("Cargo.toml")) {
        let mut in_deps = false;
        let mut count   = 0usize;
        for line in s.lines() {
            if line.trim() == "[dependencies]" { in_deps = true; continue; }
            if in_deps && line.trim().starts_with('[') { break; }
            if in_deps && !line.trim().is_empty() && !line.trim().starts_with('#') {
                if let Some(eq) = line.find('=') {
                    let name = line[..eq].trim();
                    if !name.is_empty() {
                        out.push_str(&format!("  {name}: crate\n"));
                        count += 1;
                        if count >= 12 { break; }
                    }
                }
            }
        }
    }

    out
}

fn scan_arch_docs(cwd: &str) -> String {
    let mut out = String::new();
    let p = std::path::Path::new(cwd);

    // Look for architectural constraints in agent instruction files + README
    for doc in &["CLAUDE.md", "AGENTS.md", "GEMINI.md", "README.md"] {
        if let Ok(s) = std::fs::read_to_string(p.join(doc)) {
            let mut in_constraints = false;
            for line in s.lines().take(60) {
                let lower = line.to_lowercase();
                // Detect sections that contain architectural decisions
                if lower.contains("constraint") || lower.contains("never ") ||
                   lower.contains("always ") || lower.contains("must ") ||
                   lower.contains("arch") || lower.contains("decision") {
                    in_constraints = true;
                }
                if in_constraints && !line.trim().is_empty() && out.len() < 600 {
                    let escaped = line.trim().replace('"', "'");
                    if !escaped.is_empty() {
                        out.push_str(&format!("  - \"{escaped}\"\n"));
                    }
                }
                if out.len() > 500 { break; }
            }
            if !out.is_empty() { break; }
        }
    }

    out
}

// ── Reflection ─────────────────────────────────────────────────────────────────

/// Run after a session ends (idle RunBox).
/// Reviews recent session_log entries, extracts env facts (ports, tools),
/// and persists them as PREFERRED memories for future agents.
/// No-op if the session produced no session_log entries.
pub async fn reflection(runbox_id: &str, cwd: &str, session_id: &str) {
    let all = memory::memories_for_runbox(runbox_id).await.unwrap_or_default();

    // Only process logs from the just-ended session
    let logs: Vec<_> = all.iter()
        .filter(|m| m.session_id == session_id && m.tags.contains("session_log"))
        .collect();

    if logs.is_empty() { return; }

    eprintln!("[sleep] reflection runbox={runbox_id} logs={}", logs.len());

    let mut insights: Vec<String> = Vec::new();
    let mut seen_ports: std::collections::HashSet<u16> = std::collections::HashSet::new();
    let mut seen_tools: std::collections::HashSet<String> = std::collections::HashSet::new();

    for log in &logs {
        let c     = &log.content;
        let lower = c.to_lowercase();

        // Port facts — extract any port number mentioned
        if lower.contains("port") || lower.contains(":300") || lower.contains(":800") {
            for word in c.split_whitespace() {
                let digits: String = word.chars()
                    .filter(|ch| ch.is_ascii_digit())
                    .collect();
                if let Ok(port) = digits.parse::<u16>() {
                    if port >= 3000 && port < 9000 && !seen_ports.contains(&port) {
                        seen_ports.insert(port);
                        insights.push(format!("port={port}"));
                    }
                }
            }
        }

        // Tool not available — capture for future agents
        if lower.contains("not found") || lower.contains("not available")
            || lower.contains("not recognized") || lower.contains("command not found")
        {
            for word in c.split_whitespace() {
                let tool = word.trim_matches(|ch: char| {
                    !ch.is_alphanumeric() && ch != '-' && ch != '_'
                }).to_lowercase();
                if tool.len() >= 2 && tool.len() <= 20
                    && !seen_tools.contains(&tool)
                    && !tool.chars().all(|c| c.is_ascii_digit())
                {
                    seen_tools.insert(tool.clone());
                    insights.push(format!("{tool}=not available"));
                }
            }
        }

        // Node/Python/runtime version facts
        for keyword in &["node=", "python=", "npm=", "rust=", "go="] {
            if lower.contains(keyword) {
                for part in c.split_whitespace() {
                    if part.to_lowercase().starts_with(keyword.trim_end_matches('='))
                        && part.contains('=')
                    {
                        insights.push(part.trim().to_string());
                        break;
                    }
                }
            }
        }
    }

    // Persist unique insights as PREFERRED
    let mut written = 0usize;
    for insight in insights.into_iter().take(5) {
        if memory::remember(
            runbox_id, session_id,
            &format!("reflection:{}", &session_id[..session_id.len().min(8)]),
            "stackbox-reflection",
            &insight,
            memory::LEVEL_PREFERRED,
        ).await.is_ok() {
            written += 1;
        }
    }

    if written > 0 {
        // Sync updated state to filesystem
        let updated = memory::memories_for_runbox(runbox_id).await.unwrap_or_default();
        filesystem::sync_to_fs(runbox_id, cwd, &updated).await;
        filesystem::commit_memory_async(
            cwd,
            format!(
                "reflection: {} facts from session {}",
                written,
                &session_id[..session_id.len().min(8)]
            ),
        );
        eprintln!("[sleep] reflection wrote {written} facts runbox={runbox_id}");
    }
}

// ── Defragmentation ────────────────────────────────────────────────────────────

/// Weekly cleanup — merge duplicate keys, enforce caps, rebuild flat files.
/// Hard caps: PREFERRED ≤ 200, SESSION ≤ 10, total ≤ 500.
/// Never deletes LOCKED memories.
pub async fn defrag(runbox_id: &str, cwd: &str) {
    eprintln!("[sleep] defrag starting runbox={runbox_id}");

    let all    = memory::memories_for_runbox(runbox_id).await.unwrap_or_default();
    let now    = now_ms();
    let mut deleted = 0usize;
    let mut merged  = 0usize;

    // 1. Delete time-expired memories (not LOCKED)
    for m in all.iter().filter(|m| {
        m.effective_level() != LEVEL_LOCKED
            && m.decay_at > 0
            && m.decay_at < now
    }) {
        if memory::memory_delete(&m.id).await.is_ok() { deleted += 1; }
    }

    // 2. Dedup PREFERRED by key — keep newest per key, delete older
    {
        let preferred: Vec<_> = all.iter()
            .filter(|m| m.effective_level() == LEVEL_PREFERRED)
            .collect();

        let mut by_key: std::collections::HashMap<String, Vec<&crate::memory::Memory>> =
            std::collections::HashMap::new();
        for m in &preferred {
            let k = if m.key.is_empty() {
                crate::memory::extract_key(&m.content)
            } else {
                m.key.clone()
            };
            by_key.entry(k).or_default().push(m);
        }

        for (_, mut mems) in by_key {
            if mems.len() <= 1 { continue; }
            mems.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
            for old in &mems[1..] {
                if memory::memory_delete(&old.id).await.is_ok() { merged += 1; }
            }
        }
    }

    // Reload after deletions for cap enforcement
    let remaining = memory::memories_for_runbox(runbox_id).await.unwrap_or_default();

    // 3. Cap PREFERRED at 200 — prune lowest-scored
    {
        let mut preferred: Vec<_> = remaining.iter()
            .filter(|m| m.effective_level() == LEVEL_PREFERRED)
            .collect();

        if preferred.len() > 200 {
            preferred.sort_by(|a, b| {
                crate::agent::scorer::inject_score(b, "")
                    .partial_cmp(&crate::agent::scorer::inject_score(a, ""))
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            for m in &preferred[200..] {
                if memory::memory_delete(&m.id).await.is_ok() { deleted += 1; }
            }
        }
    }

    // 4. Cap SESSION at 10 per runbox — keep most recent
    {
        let mut sessions: Vec<_> = remaining.iter()
            .filter(|m| m.effective_level() == LEVEL_SESSION)
            .collect();
        sessions.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
        for m in sessions.iter().skip(10) {
            if memory::memory_delete(&m.id).await.is_ok() { deleted += 1; }
        }
    }

    // 5. Prune old insight files from /memory/insights/ (> 90 days)
    let insights_dir = filesystem::memory_dir(cwd).join("insights");
    if let Ok(entries) = std::fs::read_dir(&insights_dir) {
        let cutoff = now_ms() - 90 * 86_400_000i64;
        for entry in entries.filter_map(|e| e.ok()) {
            let mtime_ms = entry.metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(i64::MAX);
            if mtime_ms < cutoff {
                std::fs::remove_file(entry.path()).ok();
            }
        }
    }

    // 6. Full sync + commit after cleanup
    let final_mems = memory::memories_for_runbox(runbox_id).await.unwrap_or_default();
    filesystem::sync_to_fs(runbox_id, cwd, &final_mems).await;

    if deleted + merged > 0 {
        filesystem::commit_memory_async(
            cwd,
            format!("defrag: deleted={deleted} merged={merged}"),
        );
        eprintln!("[sleep] defrag complete — deleted={deleted} merged={merged}");
    } else {
        eprintln!("[sleep] defrag complete — nothing to clean");
    }
}

// ── Defrag sentinel ────────────────────────────────────────────────────────────

/// Returns true if defrag hasn't run in the last 7 days.
pub fn is_defrag_due(cwd: &str) -> bool {
    let sentinel = filesystem::memory_dir(cwd).join(".last_defrag");
    if !sentinel.exists() { return true; }
    std::fs::metadata(&sentinel)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| std::time::SystemTime::now().duration_since(t).ok())
        .map(|d| d.as_secs() > 7 * 86_400)
        .unwrap_or(true)
}

/// Touch the defrag sentinel to record that defrag ran today.
pub fn mark_defrag_done(cwd: &str) {
    let sentinel = filesystem::memory_dir(cwd).join(".last_defrag");
    std::fs::create_dir_all(sentinel.parent().unwrap_or(std::path::Path::new("."))).ok();
    let _ = std::fs::write(&sentinel, "");
}