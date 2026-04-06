// src-tauri/src/mcp/tools.rs
//
// MCP tool definitions exposed to agents.
//
// FIX: Removed push_pr_direct / git_push_pr (PR workflow replaced by local
//   branch merge). Fixed delete_worktree → remove_worktree_only.
//   ensure_worktree now requires 4 args (added session_id).

use serde_json::{json, Value};
use crate::{db, git, state::AppState};

pub fn tool_definitions() -> Value {
    json!([
        {
            "name": "git_ensure",
            "description": "Create your git worktree if it does not exist, or return the path if it does. Call this at the start of every task before editing any files.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "runbox_id":  { "type": "string", "description": "Your runbox ID from STACKBOX_RUNBOX_ID env var" },
                    "session_id": { "type": "string", "description": "Your session ID from STACKBOX_SESSION_ID env var" },
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
            "name": "git_worktree_delete",
            "description": "Remove your worktree directory. The branch is preserved so humans can merge it later.",
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
            "description": "Update your task status. Values: working | done | merged | cancelled",
            "input_schema": {
                "type": "object",
                "properties": {
                    "runbox_id": { "type": "string" },
                    "status":    { "type": "string", "enum": ["working", "done", "merged", "cancelled"] }
                },
                "required": ["runbox_id", "status"]
            }
        }
    ])
}

// ── tool dispatcher ───────────────────────────────────────────────────────────

pub async fn dispatch(
    tool_name:   &str,
    input:       &Value,
    state:       &AppState,
    _db:         &crate::db::Db,
    _agent_name: &str,
) -> Result<Value, String> {
    match tool_name {
        "git_ensure" => {
            let cwd        = str_field(input, "cwd")?;
            let runbox_id  = str_field(input, "runbox_id")?;
            let agent_kind = input["agent_kind"].as_str().unwrap_or("shell");
            let session_id = input["session_id"].as_str().unwrap_or(&runbox_id).to_string();

            git::repo::ensure_git_repo(&cwd, &runbox_id)?;
            let wt = git::repo::ensure_worktree(&cwd, &runbox_id, &session_id, agent_kind);

            if let Some(ref w) = wt {
                db::runboxes::runbox_set_worktree(
                    &state.db, &runbox_id, agent_kind,
                    Some(&w.path), Some(&w.branch),
                ).ok();
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

        "git_worktree_delete" => {
            let worktree_path = str_field(input, "worktree_path")?;
            git::repo::remove_worktree_only(&worktree_path);
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

fn str_field(v: &Value, key: &str) -> Result<String, String> {
    v[key]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| format!("missing field: {key}"))
}
