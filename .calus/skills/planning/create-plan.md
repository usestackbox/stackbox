---
skill: planning/create-plan
description: Write an ExecPlan markdown file before starting complex or multi-step work
triggers:
  - "create a plan"
  - "plan this out"
  - "before we start"
  - "execplan"
  - "plan the work"
  - "scope this"
  - "spec this out"
  - "design the approach"
---

# Planning — Create ExecPlan Skill

## Purpose
An ExecPlan is a written contract between you and the codebase. For anything
that takes more than one session or touches more than two files, write the plan
first. It prevents scope creep, makes PRs reviewable, and gives the next
session a map.

## When to Write an ExecPlan

Write one when:
- The task will take more than one session
- You'll touch more than 3 files
- The approach isn't obvious (multiple viable paths)
- There's a risk of breaking existing behavior
- The user says "plan this first"

Skip it for:
- Single-file fixes with an obvious solution
- Typos, docs, config tweaks

## File Location and Naming

```
plans/<YYYYMMDD>-<HHMM>-<slug>.md
```

Example:
```
plans/20260115-0941-fix-auth-redirect.md
```

After the PR merges, move it:
```
plans/done/20260115-0941-fix-auth-redirect.md
```

And fill in the Outcomes section before closing.

## ExecPlan Template

```markdown
# ExecPlan: <Title>

**Created:** <YYYY-MM-DD HH:MM>
**Status:** draft | approved | in-progress | done | abandoned
**Branch:** calus/claude/<slug>

## Goal
<One paragraph. What will be true when this is done? Why does it matter?>

## Background / Context
<What exists today? What's broken or missing? Link to relevant code.>

## Approach

### Option A — <Name> (chosen)
<Description of the approach>

**Pros:**
- ...

**Cons:**
- ...

### Option B — <Name> (considered, rejected)
<Why you didn't go with this>

## Implementation Plan

### Phase 1: <Name>
- [ ] <concrete step>
- [ ] <concrete step>

### Phase 2: <Name>
- [ ] <concrete step>
- [ ] <concrete step>

### Phase 3: <Name> (if needed)
- [ ] <concrete step>

## Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `src/auth/middleware.ts` | modify | fix redirect logic |
| `src/auth/middleware.test.ts` | create | add tests for new behavior |

## Out of Scope
<Explicitly list what this plan does NOT cover. Prevents scope creep.>

## Risks
- **Risk 1**: <description> → Mitigation: <how you'll handle it>
- **Risk 2**: <description> → Mitigation: <how you'll handle it>

## Success Criteria
- [ ] <measurable outcome>
- [ ] <measurable outcome>
- [ ] All existing tests pass
- [ ] PR approved and merged

## Outcomes & Retrospective
_(Fill in after PR merges)_

**What shipped:** ...
**What deviated from plan:** ...
**What was deferred:** ...
**What to do differently next time:** ...
```

## Steps

### 1. Explore the codebase first
Before writing, understand what exists:
```bash
find src -type f -name "*.ts" | head -30
cat src/auth/middleware.ts
git log --oneline -10 -- src/auth/
```

### 2. Identify the approach options
Don't jump to the first solution. Consider 2-3 paths, even briefly.

### 3. Write the plan
Save to `plans/<date>-<slug>.md`. Commit it:
```bash
git add plans/<date>-<slug>.md
git commit -m "docs(plans): add execplan for <slug>"
```

### 4. Get confirmation before starting
Present the plan to the user. Wait for "looks good" or revisions.
Don't start implementation until the plan is confirmed.

## Constraints
- Plan before code — never start implementing a complex task without a plan
- Keep the plan updated as you work (check off completed steps)
- Outcomes section is mandatory before moving plan to `done/`
- "Out of Scope" section is mandatory — it prevents drift
