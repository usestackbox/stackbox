---
skill: github/create-pr
description: Create a pull request using gh CLI with a standards-checked, reviewer-friendly description
triggers:
  - "open PR"
  - "create PR"
  - "pull request"
  - "submit for review"
  - "make a PR"
  - "push and PR"
mcp_tools:
  - git_commit
  - calus_session_summary
---

# GitHub Create PR Skill

## Purpose
A PR description is a contract with reviewers. It answers: what changed, why
it exists, how to verify it, and what the risks are — proportionate to the
size and risk of the change.

## Pre-flight: Standards Review (blocking gate)

Before creating the PR, review the diff against project standards:

```bash
git diff origin/main..HEAD
```

Check against:
- `CLAUDE.md` or `AGENTS.md` at repo root — cross-app conventions
- Any `AGENTS.md` in subdirectories you touched

If you find discrepancies, **stop and report** to the user:
```
## Standards Review: Issues Found

### 1. [Issue]
File: path/to/file.ts
Standard: [rule from AGENTS.md]
Current code: ...
Issue: ...
Proposed fix: ...

Options:
1. Fix all — I'll update before creating PR
2. Fix some — tell me which to fix / skip
3. Proceed anyway — I'll note deviations in PR
4. Discuss — let's talk through it
```

Only proceed after user confirms.

## Workflow

### 1. Inspect changes
```bash
git status
git diff origin/main..HEAD --stat
git log origin/main..HEAD --oneline
```

### 2. Ensure on a feature branch
```bash
git branch --show-current   # must NOT be main/master
```

If on main: `git switch -c calus/claude/<slug>` first.

### 3. Stage and commit any remaining changes
Use `git/commit` skill for this step.

### 4. Push branch
```bash
# First push:
git push -u origin calus/claude/<slug>
# Subsequent:
git push origin calus/claude/<slug>
```

### 5. Create the PR with gh CLI
```bash
gh pr create \
  --title "<title>" \
  --body "$(cat <<'EOF'
<body>
EOF
)"
```

Always use HEREDOC — never inline the body.

## PR Title Format
Imperative, front-load impact:
- `fix(auth): prevent redirect loop on expired session`
- `feat(sidebar): add collapsible workspace groups`
- `refactor: consolidate tRPC router definitions`

Avoid: "WIP", "Fixes", "Changes", "Update stuff"

## PR Body Templates

Pick the smallest template that gives reviewers full context.
Delete sections that don't apply — never leave "N/A".

---

### Small PR (low risk, obvious diff, doc/config changes)
```markdown
## Summary
- <bullet: what changed>

## Testing
- `<typecheck/lint command>`
- Manual: <scenario you tested>
```

---

### Standard PR (behavior changes, multi-file, non-obvious logic)
```markdown
**Links**
- ExecPlan: `plans/<plan-name>.md` (if applicable)

## Summary
- <1-3 bullets: what changed and why it matters>

## Why / Context
<Why this change exists. What problem it solves.>

## How It Works
<High-level explanation of the approach. Skip if diff is self-explanatory.>

## Manual QA Checklist
- [ ] <happy path scenario>
- [ ] <edge case>
- [ ] <regression: old behavior still works>

## Testing
- `<typecheck command>`
- `<lint command>`
- `<test command>`

## Design Decisions (optional)
- **Why X instead of Y**: <trade-off reasoning>

## Known Limitations (optional)
- <gaps, deferred edge cases>

## Follow-ups (optional)
- <work intentionally deferred>
```

---

### High-Risk PR (schema changes, auth, broad blast radius, bundled features)
```markdown
**Links**
- ExecPlan: `plans/<plan-name>.md`

## Summary
This PR includes:
1. **Feature A** — description
2. **Feature B** — description

---

## Part 1: Feature A

### Why
### What / How
### Key Decisions
| Decision | Choice | Rationale |
|----------|--------|-----------|

---

## Part 2: Feature B

### Why
### What / How

---

## Manual QA Checklist

### Feature A
- [ ] ...

### Feature B
- [ ] ...

### Integration
- [ ] ...

## Testing
- `<all required commands>`

## Risks / Rollout / Rollback
- Risk: <what could go wrong>
- Rollout: <steps>
- Rollback: <how to revert>
```

## When to Use Which Template

| Template | Use when |
|----------|----------|
| Small | Low risk, obvious diff, docs/config only, no behavior change |
| Standard | Behavior changes, multi-file, needs context to review |
| High-Risk | Schema migrations, auth changes, bundled features, broad blast radius |

## Constraints
- Never push directly to `main`
- Standards review is a blocking gate — never skip
- Use HEREDOC for PR body — never inline multi-line strings
- Link ExecPlan in PR body if one exists
- Only create PR when explicitly asked — don't auto-create
