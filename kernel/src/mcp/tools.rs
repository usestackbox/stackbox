// src-tauri/src/mcp/tools.rs
//
// MCP tool definitions exposed to agents.
// Agents call these via their MCP client (built into Claude Code, Codex, etc).
//
// Tools the agent uses to self-manage its worktree lifecycle:
//   git_ensure          → create or get worktree
//   git_commit          → stage + commit
//   git_push_pr         → push branch + open PR
//   git_worktree_delete → clean up after merge
//   git_worktree_get    → check if worktree exists (read-only)

use serde_json::{json, Value};
use crate::{db, git, state::AppState};

// ── tool registry ─────────────────────────────────────────────────────────────

pub fn tool_definitions() -> Value {
    json!([
        {
            "name": "git_ensure",
            "description": "Create your git worktree if it does not exist, or return the path if it does. Call this at the start of every task before editing any files.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "runbox_id":  { "type": "string", "description": "Your runbox ID from STACKBOX_RUNBOX_ID env var" },
                    "agent_kind": { "type": "string", "description": "Your agent type: claude-code, codex, cursor, shell" },
                    "cwd":        { "type": "string", "description": "Workspace root path from STACKBOX_CWD env var" }
                },
                "required": ["runbox_id", "agent_kind", "cwd"]
            }
        },
        {
            "name": "git_worktree_get",
            "description": "Check if your worktree already exists. Returns path if yes, null if not.",
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
            "description": "Stage all changes and commit. Call after completing your work.",
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
            "name": "git_push_pr",
            "description": "Push your branch and open a GitHub PR to main. Call after committing.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "worktree_path": { "type": "string" },
                    "runbox_id":     { "type": "string" },
                    "title":         { "type": "string", "description": "PR title" },
                    "body":          { "type": "string", "description": "PR description" }
                },
                "required": ["worktree_path", "runbox_id"]
            }
        },
        {
            "name": "git_worktree_delete",
            "description": "Delete your worktree and branch after PR is merged. Also call with force=true if task is cancelled.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "cwd":        { "type": "string" },
                    "runbox_id":  { "type": "string" },
                    "agent_kind": { "type": "string" },
                    "force":      { "type": "boolean", "description": "true = force delete (PR cancelled). false = safe delete (PR merged, default)" }
                },
                "required": ["cwd", "runbox_id", "agent_kind"]
            }
        },
        {
            "name": "set_agent_status",
            "description": "Update your task status. Values: working | pr_open | changes_requested | merged | cancelled",
            "input_schema": {
                "type": "object",
                "properties": {
                    "runbox_id": { "type": "string" },
                    "status":    { "type": "string", "enum": ["working", "pr_open", "changes_requested", "merged", "cancelled"] }
                },
                "required": ["runbox_id", "status"]
            }
        }
    ])
}

// ── tool dispatcher ───────────────────────────────────────────────────────────

pub async fn dispatch(
    tool_name: &str,
    input:     &Value,
    state:     &AppState,
    db:        &crate::db::Db,
) -> Result<Value, String> {
    match tool_name {
        "git_ensure" => {
            let cwd        = str_field(input, "cwd")?;
            let runbox_id  = str_field(input, "runbox_id")?;
            let agent_kind = input["agent_kind"].as_str().unwrap_or("shell");

            git::repo::ensure_git_repo(&cwd, &runbox_id)?;
            let wt = git::repo::ensure_worktree(&cwd, &runbox_id, agent_kind);

            if let Some(ref w) = wt {
                db::runboxes::runbox_set_worktree(
                    &state.db, &runbox_id, agent_kind,
                    Some(&w.path), Some(&w.branch),
                ).ok();
            }

            Ok(json!({
                "worktree_path": wt.as_ref().map(|w| &w.path),
                "branch":        wt.as_ref().map(|w| &w.branch),
                "is_new":        wt.as_ref().map(|w| w.is_new).unwrap_or(false),
            }))
        }

        "git_worktree_get" => {
            let runbox_id = str_field(input, "runbox_id")?;
            let record = db::runboxes::runbox_get_worktree_record(&state.db, &runbox_id);
            Ok(json!({
                "worktree_path": record.as_ref().and_then(|r| r.worktree_path.as_deref()),
                "branch":        record.as_ref().and_then(|r| r.branch.as_deref()),
                "status":        record.as_ref().map(|r| r.status.as_str()),
            }))
        }

        "git_commit" => {
            let worktree_path = str_field(input, "worktree_path")?;
            let message       = str_field(input, "message")?;
            let result        = git::commands::commit_direct(&worktree_path, &message)?;
            Ok(json!({ "result": result }))
        }

        "git_push_pr" => {
            let worktree_path = str_field(input, "worktree_path")?;
            let runbox_id     = str_field(input, "runbox_id")?;
            let title         = input["title"].as_str().map(str::to_string);
            let body          = input["body"].as_str().map(str::to_string);

            let result = git::commands::push_pr_direct(
                &worktree_path, &runbox_id, title, body, None, db,
            ).await?;

            Ok(json!({
                "pr_url": result.pr_url,
                "branch": result.branch,
                "pushed": result.pushed,
            }))
        }

        "git_worktree_delete" => {
            let cwd        = str_field(input, "cwd")?;
            let runbox_id  = str_field(input, "runbox_id")?;
            let agent_kind = input["agent_kind"].as_str().unwrap_or("shell");
            let force      = input["force"].as_bool().unwrap_or(false);

            git::repo::delete_worktree(&cwd, &runbox_id, agent_kind, !force)?;
            db::runboxes::runbox_delete_worktree(&state.db, &runbox_id).ok();

            Ok(json!({ "deleted": true }))
        }

        "set_agent_status" => {
            let runbox_id = str_field(input, "runbox_id")?;
            let status    = str_field(input, "status")?;
            db::runboxes::runbox_set_status(&state.db, &runbox_id, &status)
                .map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true }))
        }

        other => Err(format!("unknown MCP tool: {other}")),
    }
}

// ── helpers ───────────────────────────────────────────────────────────────────

fn str_field<'a>(v: &'a Value, key: &str) -> Result<String, String> {
    v[key]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| format!("missing field: {key}"))
}