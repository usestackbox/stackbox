---
skill: agents/memory-signals
description: How the kernel memory injector reads and compresses agent signals — write correctly to minimise token cost
triggers:
  - "memory"
  - "context window"
  - "session summary"
  - "memory injector"
  - "signal"
  - "compress"
  - "token budget"
  - "inject context"
mcp_tools:
  - calus_session_summary
  - calus_state_update
  - calus_log_append
---

# Memory Signals — How the Injector Works

The kernel memory injector runs before every agent session starts.
It reads your STATE.md and past session summaries, compresses them,
and injects a compact block into your context window.

**Writing signals in the correct format = ~4× fewer tokens spent on
orientation = more room for actual work.**

---

## What the Injector Reads

The injector handles four memory levels, each with a token budget:

| Level     | What it holds                              | Budget   |
|-----------|--------------------------------------------|----------|
| Locked    | Permanent facts (goals, constraints)       | 120 tok  |
| Preferred | Patterns, preferences, recurring context   | 120 tok  |
| Session   | Session summaries from past runs           | 80 tok   |
| Temporary | Short-lived notes (cleared after done)     | 60 tok   |
| **Total** |                                            | **480 tok** |

---

## Session Summary Signal

The injector calls `extract_session_signal` on every session summary
stored in memory. It looks for these exact keys:

```
goal:    <one sentence — what this task achieves>
done:    <comma-separated list of completed items>
blocked: <blocker or "none">
next:    <first action for the next session>
```

**If it finds ≥ 2 of these keys** → emits a compact pipe-separated line:
```
goal: fix login redirect | done: read middleware, wrote fix | blocked: none | next: run tests
```

**If it does NOT find structured keys** → falls back to first 2 raw lines,
truncated to 70 chars each. This wastes token budget on prose formatting.

### Write session summaries via MCP — always

```
calus_session_summary(
  goal    = "fix redirect loop on expired session"
  done    = ["read middleware.ts", "identified root cause line 87", "wrote fix", "added test"]
  blocked = "none"
  next    = "run full test suite, commit, open PR"
)
```

Never write a session summary as free-form prose — the injector won't
extract structured signal from it.

---

## STATE.md Signal

The injector calls `extract_state_signal` on your STATE.md.
It extracts: `status`, `doing`, `blocked`, `next`.

**Structured output** (what you want):
```
status: in-progress | doing: implementing JWT middleware | blocked: none
```

**Fallback** (what happens when STATE.md has prose or wrong format):
```
implementing auth module for the new dashboard feature that the PM requested...
```

The fallback burns ~3× more tokens for ~30% of the signal value.

### Rule: keep signal fields as single `key: value` lines

```
# state
agent: claude
branch: calus/claude/fix-login-redirect
status: in-progress          ← injector reads this
updated: 2026-01-15T09:41Z

## doing
- implementing JWT middleware ← injector reads this
```

See `agents/state-format` skill for the full schema.

---

## Memory Type Tags

When writing memories via `calus_state_update` or session summary,
the injector uses internal type tags to categorise them:

| Tag          | Meaning                                      |
|--------------|----------------------------------------------|
| `goal`       | What this task is trying to achieve          |
| `session`    | End-of-session summary                       |
| `blocker`    | Something blocking progress                  |
| `failure`    | Approach that was tried and failed           |

The injector surfaces `blocker` and `failure` memories with high
priority — they prevent wasted re-attempts in the next session.

**Always record blockers explicitly:**
```
calus_state_update(
  blocked = "Redis unavailable in test env — using in-memory cache"
)
```

**Record failed approaches in ## notes:**
```
## notes
Tried approach: wrapping token refresh in a try/catch at line 87 — did not
work because the redirect was already committed before the catch ran.
```

---

## Cross-Agent Visibility

The injector can surface session summaries from *other* agents working
on the same workspace. Own-agent sessions get priority, but cross-agent
summaries fill remaining budget.

This means: if Claude left a clear session summary, Codex picks it up
on its next run — and vice versa.

Write good summaries not just for yourself but for any agent that might
continue the work.

---

## Constraints

- Never write session summaries as free-form prose — always use the 4-key format
- Never leave `blocked:` empty — write `none` if nothing is blocking
- `next:` must be a concrete first action, not a vague direction like "continue work"
- Record failed approaches in `## notes` — the injector uses `failure`-tagged memories
  to steer the next session away from dead ends
- Keep each session summary field to 1–3 sentences — compression is the goal