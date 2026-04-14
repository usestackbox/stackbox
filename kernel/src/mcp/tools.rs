// kernel/src/mcp/tools.rs
//
// MCP tool definitions exposed to agents via the Calus MCP server.
//
// Memory tools (new):
//   calus_memory_read        — read MEMORY.md index or a named topic file
//   calus_memory_append      — append a learning to MEMORY.md
//   calus_memory_write_topic — create/replace a topic file in memory/
//   calus_session_summary    — record end-of-session summary + auto-feeds MEMORY.md

use crate::{db, git, state::AppState, workspace::{persistent, context}};
use git::inject::inject_into_repo;
use serde_json::{json, Value};

pub fn tool_definitions() -> Value {
    json!([
        // ── Git worktree tools ────────────────────────────────────────────────
        {
            "name": "git_ensure",
            "description": "Create your git worktree and branch. Call this at the start of every task before editing files. Pass a short slug that describes your task.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "runbox_id":  { "type": "string", "description": "Your runbox ID from CALUS_RUNBOX_ID env var" },
                    "session_id": { "type": "string", "description": "Your session ID from CALUS_SESSION_ID env var" },
                    "agent_kind": { "type": "string", "description": "Your agent type: claude, codex, cursor, gemini, copilot, shell" },
                    "cwd":        { "type": "string", "description": "Workspace root from CALUS_CWD env var" },
                    "name":       { "type": "string", "description": "Short slug describing your task. e.g. fix-null-crash, feat-oauth, bug-login. No spaces." }
                },
                "required": ["runbox_id", "agent_kind", "cwd", "name"]
            }
        },
        {
            "name": "git_worktree_get",
            "description": "Check if your worktree already exists. Returns path + branch if yes, null if not.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "runbox_id": { "type": "string" }
                },
                "required": ["runbox_id"]
            }
        },
        {
            "name": "git_commit",
            "description": "Stage all changes and commit. Call after completing a unit of work.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "worktree_path": { "type": "string", "description": "Absolute path to your worktree" },
                    "message":       { "type": "string", "description": "Commit message describing what you did" }
                },
                "required": ["worktree_path", "message"]
            }
        },
        {
            "name": "git_worktree_delete",
            "description": "Remove your worktree directory. Branch is kept so humans can review and merge.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "worktree_path": { "type": "string", "description": "Absolute path to your worktree" }
                },
                "required": ["worktree_path"]
            }
        },
        {
            "name": "set_agent_status",
            "description": "Update your task status. Call with 'done' when finished.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "runbox_id": { "type": "string" },
                    "status":    { "type": "string", "enum": ["working", "done", "merged", "cancelled"] }
                },
                "required": ["runbox_id", "status"]
            }
        },

        // ── Memory tools ──────────────────────────────────────────────────────
        {
            "name": "calus_memory_read",
            "description": "Read cross-agent memory. Without a topic, returns the MEMORY.md index (shared by all agents). With a topic name, returns that topic file from memory/. Use this at session start to recall past learnings before beginning work.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "cwd":   { "type": "string", "description": "Workspace root from CALUS_CWD env var" },
                    "topic": { "type": "string", "description": "Optional topic name (e.g. 'debugging', 'patterns'). Omit to read the MEMORY.md index." }
                },
                "required": ["cwd"]
            }
        },
        {
            "name": "calus_memory_append",
            "description": "Append a learning or insight to the shared MEMORY.md. Use this when you discover something other agents should know — build commands, architecture decisions, gotchas, debugging insights. Keep it to one concise line.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "cwd":        { "type": "string", "description": "Workspace root from CALUS_CWD env var" },
                    "agent_kind": { "type": "string", "description": "Your agent kind from CALUS_AGENT_KIND env var" },
                    "learning":   { "type": "string", "description": "One concise line describing what you learned. e.g. 'run npm test before committing — CI requires it'" }
                },
                "required": ["cwd", "agent_kind", "learning"]
            }
        },
        {
            "name": "calus_memory_set_command",
            "description": "Record a build/test/lint/run command in shared memory so all agents know how to operate this project. Replaces any existing value for the same key.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "cwd":   { "type": "string", "description": "Workspace root from CALUS_CWD env var" },
                    "key":   { "type": "string", "description": "Command name: build, test, lint, run, migrate, seed, or similar" },
                    "value": { "type": "string", "description": "The exact shell command to run" }
                },
                "required": ["cwd", "key", "value"]
            }
        },
        {
            "name": "calus_memory_write_topic",
            "description": "Write detailed notes to a named topic file in memory/. Topic files are NOT loaded at session start — agents load them on demand with calus_memory_read(topic). Use for deep notes that would bloat the MEMORY.md index.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "cwd":     { "type": "string", "description": "Workspace root from CALUS_CWD env var" },
                    "topic":   { "type": "string", "description": "Topic name: debugging, patterns, api, auth, etc. Becomes memory/<topic>.md" },
                    "content": { "type": "string", "description": "Full markdown content to write" },
                    "append":  { "type": "boolean", "description": "If true, append to existing content instead of replacing. Default: false." }
                },
                "required": ["cwd", "topic", "content"]
            }
        },
        {
            "name": "calus_memory_list_topics",
            "description": "List all topic files available in memory/. Use this when unsure what detailed notes exist.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "cwd": { "type": "string", "description": "Workspace root from CALUS_CWD env var" }
                },
                "required": ["cwd"]
            }
        },

        // ── Session summary ───────────────────────────────────────────────────
        {
            "name": "calus_session_summary",
            "description": "Record an end-of-session summary. Call this when the user says done, pausing, stopping, or thanks. Automatically feeds key learnings into shared MEMORY.md so the next agent session (same or different agent) can resume with context.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "cwd":        { "type": "string", "description": "Workspace root from CALUS_CWD env var" },
                    "agent_kind": { "type": "string", "description": "Your agent kind from CALUS_AGENT_KIND env var" },
                    "goal":       { "type": "string", "description": "One sentence: what was the overall task?" },
                    "done":       { "type": "string", "description": "Comma-separated list of completed items" },
                    "blocked":    { "type": "string", "description": "Current blocker, or '-' if none" },
                    "next":       { "type": "string", "description": "First concrete action to take on resume" }
                },
                "required": ["cwd", "agent_kind", "goal", "done", "blocked", "next"]
            }
        }
    ])
}

// ── Tool dispatcher ───────────────────────────────────────────────────────────

pub async fn dispatch(
    tool_name: &str,
    input: &Value,
    state: &AppState,
    _db: &crate::db::Db,
    _agent_name: &str,
) -> Result<Value, String> {
    match tool_name {

        // ── git_ensure ────────────────────────────────────────────────────────
        "git_ensure" => {
            let cwd = str_field(input, "cwd")?;
            let runbox_id = str_field(input, "runbox_id")?;
            let agent_kind = input["agent_kind"].as_str().unwrap_or("shell");
            let name = str_field(input, "name")?;
            let session_id = input["session_id"]
                .as_str()
                .unwrap_or(&runbox_id)
                .to_string();

            git::repo::ensure_git_repo(&cwd, &runbox_id)?;

            let wt = git::repo::ensure_worktree(&cwd, &runbox_id, &name, agent_kind);
            inject_into_repo(std::path::Path::new(&cwd), agent_kind);

            if let Some(ref w) = wt {
                db::runboxes::runbox_set_worktree(
                    &state.db,
                    &runbox_id,
                    agent_kind,
                    Some(&w.path),
                    Some(&w.branch),
                )
                .ok();
                let _ = db::branches::record_branch_start(
                    &state.db,
                    &runbox_id,
                    &session_id,
                    agent_kind,
                    &w.branch,
                    &w.path,
                );
            }

            Ok(json!({
                "worktree_path": wt.as_ref().map(|w| &w.path),
                "branch":        wt.as_ref().map(|w| &w.branch),
                "is_new":        wt.as_ref().map(|w| w.is_new).unwrap_or(false),
            }))
        }

        // ── git_worktree_get ──────────────────────────────────────────────────
        "git_worktree_get" => {
            let runbox_id = str_field(input, "runbox_id")?;
            let record = db::runboxes::runbox_get_worktree_record(&state.db, &runbox_id);
            Ok(json!({
                "worktree_path": record.as_ref().and_then(|r| r.worktree_path.as_deref()),
                "branch":        record.as_ref().and_then(|r| r.branch.as_deref()),
                "status":        record.as_ref().map(|r| r.status.as_str()),
            }))
        }

        // ── git_commit ────────────────────────────────────────────────────────
        "git_commit" => {
            let worktree_path = str_field(input, "worktree_path")?;
            let message = str_field(input, "message")?;
            let result = git::commands::commit_direct(&worktree_path, &message)?;
            Ok(json!({ "result": result }))
        }

        // ── git_worktree_delete ───────────────────────────────────────────────
        "git_worktree_delete" => {
            let worktree_path = str_field(input, "worktree_path")?;
            git::repo::remove_worktree_only(&worktree_path);
            Ok(json!({ "deleted": true }))
        }

        // ── set_agent_status ──────────────────────────────────────────────────
        "set_agent_status" => {
            let runbox_id = str_field(input, "runbox_id")?;
            let status = str_field(input, "status")?;
            db::runboxes::runbox_set_status(&state.db, &runbox_id, &status)
                .map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true }))
        }

        // ── calus_memory_read ─────────────────────────────────────────────────
        "calus_memory_read" => {
            let cwd = str_field(input, "cwd")?;
            let topic = input["topic"].as_str();

            let content = match topic {
                Some(t) => {
                    // Read a named topic file
                    context::read_memory_topic(&cwd, t)
                        .ok_or_else(|| format!("topic '{t}' not found — use calus_memory_list_topics to see available topics"))?
                }
                None => {
                    // Read the MEMORY.md index (enforcing the line/byte limits)
                    let idx = context::read_memory_index(&cwd);
                    if idx.is_empty() {
                        "MEMORY.md is empty or does not exist yet.".to_string()
                    } else {
                        idx
                    }
                }
            };

            Ok(json!({ "content": content }))
        }

        // ── calus_memory_append ───────────────────────────────────────────────
        "calus_memory_append" => {
            let cwd = str_field(input, "cwd")?;
            let agent_kind = input["agent_kind"].as_str().unwrap_or("agent");
            let learning = str_field(input, "learning")?;

            context::append_memory_learning(&cwd, agent_kind, &learning)?;
            Ok(json!({ "ok": true, "memory": context::memory_md_path(&cwd).to_string_lossy() }))
        }

        // ── calus_memory_set_command ──────────────────────────────────────────
        "calus_memory_set_command" => {
            let cwd = str_field(input, "cwd")?;
            let key = str_field(input, "key")?;
            let value = str_field(input, "value")?;

            context::set_memory_command(&cwd, &key, &value)?;
            Ok(json!({ "ok": true }))
        }

        // ── calus_memory_write_topic ──────────────────────────────────────────
        "calus_memory_write_topic" => {
            let cwd = str_field(input, "cwd")?;
            let topic = str_field(input, "topic")?;
            let content = str_field(input, "content")?;
            let append = input["append"].as_bool().unwrap_or(false);

            if append {
                context::append_memory_topic(&cwd, &topic, &content)?;
            } else {
                context::write_memory_topic(&cwd, &topic, &content)?;
            }

            // Register the topic in MEMORY.md's ## topics section so agents know it exists
            register_topic_in_index(&cwd, &topic);

            Ok(json!({
                "ok": true,
                "path": context::memory_topic_path(&cwd, &topic).to_string_lossy()
            }))
        }

        // ── calus_memory_list_topics ──────────────────────────────────────────
        "calus_memory_list_topics" => {
            let cwd = str_field(input, "cwd")?;
            let topics = context::list_memory_topics(&cwd);
            Ok(json!({ "topics": topics }))
        }

        // ── calus_session_summary ─────────────────────────────────────────────
        "calus_session_summary" => {
            let cwd = str_field(input, "cwd")?;
            let agent_kind = input["agent_kind"].as_str().unwrap_or("agent");
            let goal = str_field(input, "goal")?;
            let done = str_field(input, "done")?;
            let blocked = str_field(input, "blocked")?;
            let next = str_field(input, "next")?;

            // Auto-feed key fields into shared MEMORY.md so all agents benefit
            context::feed_session_to_memory(&cwd, agent_kind, &goal, &done, &blocked)?;

            // Return confirmation with what was recorded
            Ok(json!({
                "recorded": true,
                "summary": {
                    "goal":    goal,
                    "done":    done,
                    "blocked": blocked,
                    "next":    next,
                },
                "memory_updated": context::memory_md_path(&cwd).to_string_lossy()
            }))
        }

        other => Err(format!("unknown MCP tool: {other}")),
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn str_field(v: &Value, key: &str) -> Result<String, String> {
    v[key]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| format!("missing field: {key}"))
}

/// Add `- <topic> → memory/<topic>.md` to the ## topics section of MEMORY.md
/// if it isn't already listed.
fn register_topic_in_index(cwd: &str, topic: &str) {
    let mp = context::memory_md_path(cwd);
    let Ok(raw) = std::fs::read_to_string(&mp) else { return };
    let entry = format!("- {topic} → memory/{topic}.md");
    if raw.contains(&entry) {
        return;
    }
    let updated = if let Some(idx) = raw.find("## topics") {
        let after = &raw[idx..];
        if let Some(nl) = after.find('\n') {
            let insert_pos = idx + nl + 1;
            format!("{}{}\n{}", &raw[..insert_pos], entry, &raw[insert_pos..])
        } else {
            format!("{raw}\n{entry}\n")
        }
    } else {
        format!("{raw}\n## topics\n{entry}\n")
    };
    let _ = std::fs::write(&mp, updated);
}
