---
skill: git/worktree
description: Create, resume, and manage git worktrees for isolated agent work
triggers:
  - "new task"
  - "start working on"
  - "create worktree"
  - "isolate work"
  - "new branch"
  - "spin up"
mcp_tools:
  - git_worktree_get
  - git_ensure
---

# Git Worktree Skill

## Purpose
Every task gets its own worktree. This keeps your main branch clean and lets
you work on multiple tasks simultaneously without interference.

## Worktree Path Convention
Worktrees live OUTSIDE the repo:

```
~/calus/<repo-hash>/.worktrees/<agent-kind>-<slug>/
```

- `<repo-hash>` — FNV hash of the absolute repo path (stable per machine)
- `<agent-kind>` — `claude`, `codex`, `cursor`, `gemini`, `shell`
- `<slug>` — kebab-case from the task description, max 5 words

Example:
```
~/calus/a3f9c2b1/.worktrees/claude-fix-login-redirect/
```

## Branch Naming
```
calus/<agent-kind>/<slug>
```

Examples:
- `calus/claude/fix-login-redirect`
- `calus/claude/add-oauth-google`
- `calus/claude/refactor-auth-service`

Branch type prefix inside slug:
- `fix-*`      → bug fix
- `feat-*`     → new feature
- `chore-*`    → maintenance / deps
- `docs-*`     → documentation only
- `refactor-*` → code refactor, no behavior change

## Steps

### 1. Always check for existing worktree first
```
git_worktree_get(slug)
```
- If it exists → resume it, do NOT create a new one
- If it doesn't exist → proceed to step 2

### 2. Create the worktree
```
git_ensure(repo_path, slug, agent_kind, base_branch)
```

This creates:
```
<worktree>/
  STATE.md    ← structured task state (parsed by injector)
  LOG.md      ← one line per action
```

### 3. STATE.md format (strict — parser depends on it)
```
status: in-progress
goal: <one sentence>
doing: <current action>
next: <next action>
blocked: none
branch: calus/claude/<slug>
worktree: ~/calus/<hash>/.worktrees/claude-<slug>
```

Only `key: value` — no markdown, no blank lines between keys.

### 4. LOG.md format
One line per action, newest at top:
```
[2026-01-15 09:41] created worktree for fix-login-redirect
[2026-01-15 09:42] read auth/middleware.ts
[2026-01-15 09:44] identified redirect loop in line 87
```

## Constraints
- Never create a worktree inside the main repo directory
- Never commit directly to `main` or `master`
- Always update `status:` in STATE.md when work state changes
- Always write to LOG.md after each significant action
- Worktree stays until PR is merged — do not delete early
