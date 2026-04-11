// kernel/src/mcp/tools.rs
//
// MCP tool definitions exposed to agents via the calus MCP server.
// Agent calls git_ensure with a name slug — Calus creates the worktree.

use crate::{db, git, state::AppState};
use git::inject::inject_into_repo;
use serde_json::{json, Value};

pub fn tool_definitions() -> Value {
    json!([
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

            // Agent provides the name — Calus creates the worktree
            let wt = git::repo::ensure_worktree(&cwd, &runbox_id, &name, agent_kind);
            // Inject agent instruction file into repo root (write-if-missing).
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
            let message = str_field(input, "message")?;
            let result = git::commands::commit_direct(&worktree_path, &message)?;
            Ok(json!({ "result": result }))
        }

        "git_worktree_delete" => {
            let worktree_path = str_field(input, "worktree_path")?;
            git::repo::remove_worktree_only(&worktree_path);
            Ok(json!({ "deleted": true }))
        }

        "set_agent_status" => {
            let runbox_id = str_field(input, "runbox_id")?;
            let status = str_field(input, "status")?;
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
