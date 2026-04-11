---
skill: git/commit
description: Stage, write, and push commits following conventional commit format
triggers:
  - "commit"
  - "save progress"
  - "checkpoint"
  - "push changes"
  - "stage files"
mcp_tools:
  - git_commit
  - set_agent_status
---

# Git Commit Skill

## Purpose
Commits are the audit trail. Write them so a reviewer — or future you — can
understand what changed and why, without reading the diff.

## Commit Message Format

```
<type>(<scope>): <short summary>

<body — what and why, not how>

<footer — refs, breaking changes>
```

### Type
| Type       | When to use |
|------------|-------------|
| `feat`     | New feature visible to users |
| `fix`      | Bug fix |
| `refactor` | Code change, no behavior change |
| `chore`    | Deps, config, tooling |
| `docs`     | Documentation only |
| `test`     | Tests only |
| `perf`     | Performance improvement |

### Scope
Optional. The module, file area, or feature affected.
Examples: `auth`, `api`, `worktree`, `sidebar`, `db`

### Short Summary
- Imperative mood: "add", "fix", "remove" (not "added", "fixes")
- Max 72 characters
- No period at the end

### Body (when needed)
- Explain **why**, not what the code does
- One blank line after summary
- Wrap at 72 chars

### Footer
- `Refs: #123` for issue links
- `BREAKING CHANGE: <description>` for breaking changes

## Examples

```
fix(auth): prevent redirect loop on expired session

Token refresh was running after the redirect was already initiated,
causing the user to bounce between /login and /dashboard.

Refs: #204
```

```
feat(worktree): create STATE.md on worktree init

Structured state file lets the memory injector compress 20 lines
of context into ~8 tokens across sessions.
```

```
chore: upgrade bun to 1.2.4
```

## Steps

### 1. Review what changed
```bash
git status
git diff --staged
git diff
```

### 2. Stage intentionally — not everything at once
```bash
# Stage specific files or hunks
git add src/auth/middleware.ts
git add -p src/api/routes.ts   # stage by hunk
```

Never `git add .` unless you've reviewed every change.

### 3. Commit via MCP
```
git_commit(message, paths[])
```

This also appends a log line to LOG.md automatically.

### 4. Update STATE.md after committing
```
set_agent_status(status, doing, next)
```

### 5. Push
```bash
git push origin calus/claude/<slug>
# First push:
git push -u origin calus/claude/<slug>
```

## Constraints
- Never commit secrets, tokens, or credentials
- Never `git add .` blindly — always review staged content
- Never commit directly to `main` or `master`
- One logical change per commit — split unrelated changes
- Use a HEREDOC for multi-line messages in bash:
  ```bash
  git commit -m "$(cat <<'EOF'
  fix(auth): prevent redirect loop

  Token refresh ran after redirect initiated.

  Refs: #204
  EOF
  )"
  ```
