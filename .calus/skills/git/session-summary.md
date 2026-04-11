---
skill: git/session-summary
description: Write end-of-session summaries so the next session can resume with full context
triggers:
  - "end session"
  - "stopping for now"
  - "wrap up"
  - "session done"
  - "pausing"
  - "done for today"
mcp_tools:
  - calus_session_summary
  - set_agent_status
  - calus_state_update
---

# Git Session Summary Skill

## Purpose
Claude has no memory between sessions. A good session summary = a cold-start
agent can pick up exactly where you left off, with zero re-orientation cost.

The memory injector reads these summaries and compresses them into minimal
tokens for the next session's context window.

## When to Write
Always write a session summary when:
- The user says they're done, stopping, or pausing
- The session has been running for a long time
- You're about to hit context window limits
- After a PR is created

## Summary Format (strict 4-line structure)

```
goal: <what the task is trying to achieve — 1 sentence>
done: <what was completed this session — bullet list, comma-separated>
blocked: <what's blocking progress, or "none">
next: <first action the next session should take — 1 sentence>
```

Example:
```
goal: fix redirect loop on expired session in auth middleware
done: read middleware.ts, identified root cause at line 87, wrote fix, added test
blocked: none
next: run full test suite then commit and open PR
```

## Steps

### 1. Review work done this session
```bash
git log --oneline -10
git diff origin/main..HEAD --stat
cat LOG.md | head -20
```

### 2. Write the summary via MCP
```
calus_session_summary(goal, done[], blocked, next)
```

This writes to the worktree's session history file.

### 3. Update STATE.md
```
calus_state_update(doing="session ended", next=<next action>, blocked=<or none>)
set_agent_status("paused")
```

### 4. Final git checkpoint (if uncommitted work exists)
```bash
git stash push -m "wip: <description>"
# OR commit as WIP:
git add -p
git commit -m "wip: <description> [DO NOT MERGE]"
```

Prefer stash for truly in-progress work. WIP commit if you want it pushed.

## What Makes a Good Summary

**Good:**
```
goal: add Google OAuth login
done: installed passport-google, created /auth/google route, wrote callback handler, added env vars to .env.example
blocked: none
next: test the OAuth flow end-to-end, then write the session summary and open PR
```

**Bad:**
```
goal: oauth
done: stuff
blocked: no
next: finish
```

Bad summaries force the next session to re-read files and re-orient.
Good summaries are 30 seconds of reading and you're back in flow.

## Constraints
- Keep each field to 1-3 sentences max — compression is the goal
- `blocked:` is never blank — write "none" if nothing is blocking
- `next:` must be a concrete first action, not a vague direction
- Never write "see above" or "see LOG.md" — be explicit
