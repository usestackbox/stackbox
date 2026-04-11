---
skill: agents/state-format
description: Strict STATE.md and LOG.md format that the kernel memory injector parses
triggers:
  - "state.md"
  - "update state"
  - "state format"
  - "log format"
  - "structured state"
  - "log.md"
  - "injector format"
mcp_tools:
  - calus_state_update
  - calus_log_append
---

# STATE.md and LOG.md Format

The kernel memory injector (`injector.rs`) reads STATE.md and session
summaries to build the compressed context that the next session gets.
**If the format is wrong, the injector falls back to raw text — costing
4× more tokens for the same signal.**

---

## STATE.md — Complete Schema

```
# state
agent: <agent_kind>
branch: calus/<agent_kind>/<slug>
worktree: ~/calus/<fnv32>/.worktrees/<agent_kind>-<slug>
status: in-progress
updated: <ISO 8601 timestamp>

## doing
- <one line: what you are doing RIGHT NOW>

## next
- <one line: the immediate next step>

## blocked
- <blocker description, or just ->

## done
- <completed item 1>
- <completed item 2>

## notes
Free-form observations go here only — not in the key:value block above.
```

### Key:value block rules (injector-critical)

- Each signal field **must** be a single `key: value` line
- No blank lines between key:value lines in the header block
- `status` must be one of: `in-progress` | `paused` | `blocked` | `done`
- `updated` must be ISO 8601 (e.g. `2026-01-15T09:41:00Z`)
- Fields the injector extracts: `status`, `doing` (inline or from `## doing`), `blocked` (inline or from `## blocked`), `next` (inline or from `## next`)

### Section rules

- Each `##` section holds bullet lines starting with `-`
- `## doing` — exactly ONE bullet — what you're doing this moment
- `## next` — exactly ONE bullet — the very next concrete action
- `## blocked` — ONE bullet, or `- ` (dash space) if nothing is blocking
- `## done` — append new bullets; never remove old ones
- `## notes` — free-form prose; injector ignores this section

### What the injector extracts

Given a STATE.md, the injector produces a single compact line:
```
status: in-progress | doing: implementing JWT middleware | blocked: none
```

This replaces the full 20-line STATE.md in the context window.
Every field you write correctly = fewer tokens burned on orientation.

---

## Updating STATE.md

Always update via MCP — never edit the file directly:

```
calus_state_update(
  doing   = "reading auth/middleware.ts"
  next    = "identify the redirect trigger point"
  blocked = "none"          ← always include, even if none
)
```

---

## LOG.md — Format

One line per action, newest at the **top**:

```
- [2026-01-15 09:44] identified redirect loop in middleware.ts line 87
- [2026-01-15 09:42] read auth/middleware.ts and auth/token.ts
- [2026-01-15 09:41] created worktree for fix-login-redirect
```

### Rules

- Timestamp: `[YYYY-MM-DD HH:MM]` — no seconds, no timezone
- Format: `action — reason` (reason optional for obvious actions)
- `git_commit` auto-prepends a log line — never duplicate it manually
- Use `calus_log_append` for non-commit actions
- Never delete log lines
- Keep each line under 100 characters

---

## Status Lifecycle

```
in-progress  →  paused    (user stops the session)
in-progress  →  blocked   (waiting on external dependency)
in-progress  →  done      (task fully complete, PR merged or closed)
paused       →  in-progress (session resumes)
blocked      →  in-progress (blocker resolved)
```

Set status via `set_agent_status(status=...)` — not by editing STATE.md directly.

---

## Constraints

- Free-form prose belongs ONLY in `## notes` — never in the key:value header
- `## doing` and `## next` must always have exactly one bullet
- `## blocked` must always be present — never omit it, even when nothing is blocking
- The injector trusts `key: value` lines; ambiguous formats fall back to expensive raw text