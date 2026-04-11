---
skill: agents/env-vars
description: CALUS_* environment variables injected by the kernel at agent spawn
triggers:
  - "env vars"
  - "environment variables"
  - "calus_port"
  - "calus_cwd"
  - "calus_runbox"
  - "calus_session"
  - "calus_agent_kind"
  - "calus_token"
---

# Calus Environment Variables

The kernel injects these variables into every agent PTY at spawn time.
Pass them to MCP tool calls exactly as shown — never hardcode the values.

---

## Variable Reference

| Variable           | Type   | Description                                                  |
|--------------------|--------|--------------------------------------------------------------|
| `CALUS_RUNBOX_ID`  | string | Workspace instance identifier — pass as `runbox_id` in all kernel MCP tools |
| `CALUS_SESSION_ID` | string | Unique identifier for this agent session — pass as `session_id` to `git_ensure` |
| `CALUS_CWD`        | string | Absolute path to the workspace root — pass as `cwd` to `git_ensure` |
| `CALUS_AGENT_KIND` | string | Your agent type string — pass as `agent_kind` to `git_ensure` and all worktree tools |
| `CALUS_PORT`       | int    | Kernel HTTP port the MCP server proxies to (default: `7547`) |
| `CALUS_TOKEN`      | string | Bearer token for kernel HTTP auth — the MCP server uses this automatically |

---

## Usage in MCP Tool Calls

```
git_ensure(
  name       = <your task slug>
  agent_kind = $CALUS_AGENT_KIND    ← always from env
  cwd        = $CALUS_CWD           ← always from env
  runbox_id  = $CALUS_RUNBOX_ID     ← always from env
  session_id = $CALUS_SESSION_ID    ← always from env
)

git_worktree_get(
  runbox_id = $CALUS_RUNBOX_ID
  cwd       = $CALUS_CWD
)

set_agent_status(
  status    = "done"
  runbox_id = $CALUS_RUNBOX_ID
)
```

---

## CALUS_AGENT_KIND values

| Value     | Agent            |
|-----------|------------------|
| `claude`  | Claude Code      |
| `codex`   | OpenAI Codex     |
| `cursor`  | Cursor Agent     |
| `gemini`  | Gemini CLI       |
| `copilot` | GitHub Copilot   |
| `shell`   | Plain shell (no agent auto-launch) |

---

## Constraints

- Never hardcode `CALUS_RUNBOX_ID`, `CALUS_SESSION_ID`, or `CALUS_CWD` — always read from env
- Never expose `CALUS_TOKEN` to the user or include it in logs
- If a variable is missing or empty, log the issue and halt — do not proceed with empty values
- `CALUS_PORT` is set by the kernel; the MCP server reads it automatically — you rarely need it directly