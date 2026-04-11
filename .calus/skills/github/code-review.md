---
skill: github/code-review
description: Review a PR or diff for correctness, standards, and reviewer signal
triggers:
  - "review this"
  - "review the PR"
  - "review the diff"
  - "code review"
  - "check the changes"
  - "look at this PR"
  - "feedback on"
---

# GitHub Code Review Skill

## Purpose
A review is an investment in the codebase. Focus on correctness, clarity, and
maintainability — not style nits (that's what linters are for).

## What to Review

### Layer 1 — Correctness (always)
- Does the code do what the PR says it does?
- Are there off-by-one errors, null deref risks, unhandled exceptions?
- Are edge cases handled? (empty input, concurrent calls, large payload)
- Are there race conditions or state mutation issues?

### Layer 2 — Security (always)
- Is user input validated and sanitized?
- Are auth/permission checks in place at every boundary?
- Are secrets or tokens hardcoded or logged?
- Is error output leaking internal details?

### Layer 3 — Design (for non-trivial changes)
- Does this fit the existing architecture patterns?
- Is the abstraction at the right level?
- Is there unnecessary coupling introduced?
- Will this be easy to change in 6 months?

### Layer 4 — Tests (when logic changes)
- Are the tests actually testing the behavior, not the implementation?
- Are edge cases covered?
- Can the tests fail for the right reasons?

### Layer 5 — Standards (check against AGENTS.md)
- Read `CLAUDE.md` / `AGENTS.md` at root
- Read any `AGENTS.md` in subdirectories touched
- Flag deviations explicitly

## Review Output Format

```markdown
## Code Review

### Summary
<1-2 sentences: overall impression, biggest concern if any>

### 🔴 Blocking Issues
Issues that must be fixed before merge.

**[File: path/to/file.ts, line N]**
> <quoted or described code>
Issue: <what's wrong>
Suggestion: <concrete fix>

### 🟡 Non-Blocking (should fix)
Issues worth addressing but not merge-blockers.

**[File: path/to/file.ts]**
Issue: <what could be improved>
Suggestion: <recommendation>

### 🟢 Nits (optional)
Style, naming, minor clarity items. Reviewer's discretion.

- `path/to/file.ts:45` — rename `x` to `sessionToken` for clarity

### ✅ Looks Good
- <things done well — reinforces good patterns>
```

## Severity Definitions

| Severity | Meaning | Action |
|----------|---------|--------|
| 🔴 Blocking | Bug, security issue, broken contract | Must fix before merge |
| 🟡 Non-blocking | Tech debt, missing test, unclear naming | Should fix; can defer with note |
| 🟢 Nit | Style preference, minor clarity | Author's call |

## Steps

### 1. Get the diff
```bash
# For a PR:
gh pr diff <pr-number>
gh pr view <pr-number>

# For local branch vs main:
git diff origin/main..HEAD
git log origin/main..HEAD --oneline
```

### 2. Read the PR description first
Understand the intent before reading code — it changes what you look for.

### 3. Read changed files top-to-bottom
Don't just read the diff. Read the full context of each changed file if
the change is non-trivial.

### 4. Cross-reference AGENTS.md
```bash
cat CLAUDE.md
cat AGENTS.md
# Check any relevant subdirectory AGENTS.md
```

### 5. Write structured review output
Use the format above. Be specific — "this looks wrong" is not useful.
"Line 87: this will throw if `session` is null when cookie is expired" is.

## Constraints
- Don't nit-pick style — that's linters' job
- Every blocking issue needs a concrete suggested fix
- Be honest about things that look good — positive signal matters
- If you can't fully understand a change, say so — don't fake confidence
- Never approve a PR with unresolved 🔴 blocking issues
