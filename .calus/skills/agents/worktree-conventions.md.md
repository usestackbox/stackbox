---
skill: agents/worktree-conventions
description: Worktree path formula, slug rules, and branch naming for all agent kinds
triggers:
  - "create worktree"
  - "name the worktree"
  - "worktree path"
  - "branch name"
  - "slug"
  - "naming convention"
  - "agent kind"
  - "new branch"
mcp_tools:
  - git_ensure
  - git_worktree_get
---

# Worktree & Branch Naming Conventions

All agents share the same path formula and slug rules.
Consistency is what makes cross-agent visibility work in the Calus UI.

---

## Agent Kind Strings

| Agent        | `CALUS_AGENT_KIND` | Branch prefix         | Launch command |
|--------------|--------------------|-----------------------|----------------|
| Claude Code  | `claude`           | `calus/claude/<slug>` | `claude`       |
| OpenAI Codex | `codex`            | `calus/codex/<slug>`  | `codex`        |
| Cursor Agent | `cursor`           | `calus/cursor/<slug>` | `agent`        |
| Gemini CLI   | `gemini`           | `calus/gemini/<slug>` | `gemini`       |
| GitHub Copilot | `copilot`        | `calus/copilot/<slug>`| `copilot`      |

Always read your kind from `$CALUS_AGENT_KIND` — never hardcode it.

---

## Worktree Path Formula

```
~/calus/<fnv32(cwd)>/.worktrees/<agent_kind>-<slug>/
```

- `fnv32(cwd)` — FNV-1a 32-bit hash of the absolute workspace path, hex, zero-padded to 8 chars.
  The kernel computes this — you never need to compute it yourself.
  It is stable per machine per workspace.
- `<agent_kind>` — your kind string from the table above
- `<slug>` — kebab-case task identifier (rules below)

**Example:**
```
~/calus/a3f9c2b1/.worktrees/claude-fix-login-redirect/
```

---

## Branch Formula

```
calus/<agent_kind>/<slug>
```

**Examples:**
```
calus/claude/fix-login-redirect
calus/codex/feat-oauth-google
calus/gemini/refactor-db-schema
calus/cursor/chore-upgrade-deps
```

Branch name must match the worktree slug exactly — the slug is the last segment.

---

## Slug Rules

- Kebab-case only: `fix-login-redirect` not `fix_login_redirect`
- Max 5 words
- Imperative form derived from the task description
- Starts with a type prefix:

| Prefix       | Use for                                 |
|--------------|-----------------------------------------|
| `fix-`       | Bug fix                                 |
| `feat-`      | New feature                             |
| `chore-`     | Deps, config, tooling, maintenance      |
| `docs-`      | Documentation only                      |
| `refactor-`  | Code restructure, no behaviour change   |
| `perf-`      | Performance improvement                 |
| `test-`      | Tests only                              |

**Good slugs:**
```
fix-null-crash
feat-oauth-google
chore-upgrade-bun
refactor-trpc-router
docs-update-readme
```

**Bad slugs:**
```
my-task          ← no type prefix
Fix_Login        ← not kebab-case, capitalised
implement-the-entire-authentication-flow-for-oauth  ← too long
```

---

## Files Inside Every Worktree

The kernel creates these on `git_ensure`. Never create them manually.

```
<worktree>/
  STATE.md    ← structured task state, read by the memory injector
  LOG.md      ← one action per line, append-only
```

See `agents/state-format` skill for the exact STATE.md schema.
See `agents/memory-signals` skill for how the injector reads these files.

---

## Constraints

- Worktrees live OUTSIDE the main repo directory — never inside it
- Never create more than one worktree per task
- Never rename a worktree directory manually — paths are recorded in the DB
- Worktree stays until PR is merged — do not delete early
- One logical task per worktree — do not bundle unrelated work