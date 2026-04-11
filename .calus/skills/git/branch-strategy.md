---
skill: git/branch-strategy
description: Branching rules, naming conventions, and merge strategy
triggers:
  - "branch"
  - "branching"
  - "merge strategy"
  - "branch from"
  - "what branch"
  - "base branch"
---

# Git Branch Strategy Skill

## Purpose
Consistent branching keeps history clean and makes PR review, bisect, and
rollback predictable.

## Branch Types

| Branch | Pattern | Description |
|--------|---------|-------------|
| Agent work | `calus/<agent>/<slug>` | All agent-created branches |
| Feature | `feat/<slug>` | Human-created features |
| Fix | `fix/<slug>` | Human-created bug fixes |
| Release | `release/<version>` | Release prep |
| Hotfix | `hotfix/<slug>` | Emergency production fixes |

Agent branches always use the `calus/` prefix so they're easy to filter and clean up.

## Slug Rules
- Kebab-case only: `fix-login-redirect` not `fix_login_redirect`
- Max 5 words
- Derived from the task description, imperative form
- Examples:
  - `add-google-oauth`
  - `fix-session-expiry`
  - `refactor-trpc-router`
  - `docs-update-readme`

## Base Branch Rules

| Situation | Base from |
|-----------|-----------|
| Normal feature / fix | `main` |
| Hotfix on production | `main` (or release tag) |
| Stacked PR (depends on another branch) | The parent branch |
| Long-running feature | `main`, rebase frequently |

Always pull latest before branching:
```bash
git checkout main && git pull origin main
git checkout -b calus/claude/<slug>
```

## Keeping Branch Up to Date

Prefer **rebase** over merge to keep history linear:
```bash
git fetch origin
git rebase origin/main
```

If rebase produces conflicts → resolve, then:
```bash
git add <resolved-files>
git rebase --continue
```

Never `git merge main` into an agent branch — use rebase.

## Stale Branch Cleanup

After a PR merges:
```bash
git branch -d calus/claude/<slug>           # local
git push origin --delete calus/claude/<slug> # remote
git worktree remove ~/calus/<hash>/.worktrees/claude-<slug>
```

The worktree must be removed before the branch can be deleted locally.

## Constraints
- Never push directly to `main` or `master`
- Never force-push to shared branches
- Force-push is OK on your own agent branch before PR is reviewed:
  `git push --force-with-lease origin calus/claude/<slug>`
- One feature/fix per branch — no bundling unrelated work
- Branch name must match the worktree slug exactly
