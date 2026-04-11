---
skill: github/respond-to-pr-comments
description: Read PR review comments, address them in code, and respond to reviewers
triggers:
  - "respond to PR comments"
  - "address review feedback"
  - "PR has comments"
  - "reviewer feedback"
  - "fix review notes"
  - "pr feedback"
---

# GitHub Respond to PR Comments Skill

## Purpose
Reviewer time is valuable. Responses should be fast to read, clear about what
changed, and honest about what was deferred and why.

## Steps

### 1. Read all comments first
```bash
gh pr view <pr-number> --comments
```

Read everything before making any changes. Group comments by:
- Same file / same issue (can be fixed together)
- Blocking vs non-blocking (fix blocking first)
- Agree vs disagree (needs discussion before fixing)

### 2. Categorize each comment

| Category | Action |
|----------|--------|
| Bug / correctness | Fix immediately |
| Agree on improvement | Fix, respond with what changed |
| Disagree | Discuss in comment before touching code |
| Nit — agree | Fix if quick, skip if not worth it |
| Nit — disagree | Respond explaining your reasoning, no fix needed |
| Already fixed elsewhere | Explain in comment |
| Out of scope | Respond with "deferred to follow-up, created issue #N" |

### 3. Make the code changes
Use `git/commit` skill. One commit per logical group of fixes is fine.
Don't make a commit per comment — that's noise.

Good commit message for review responses:
```
fix(auth): address PR review feedback

- validate session before redirect (blocker from @reviewer)
- rename `x` to `sessionToken` for clarity
- add null guard on cookie parse
```

### 4. Respond to each comment on GitHub

For every addressed comment, reply:
```bash
gh api repos/:owner/:repo/pulls/comments/<comment-id>/replies \
  -f body="<response>"
```

Or use the GitHub web UI if faster.

## Response Templates

**Fixed:**
```
Fixed in <commit-hash>. <One sentence on what changed and why.>
```

**Fixed with different approach:**
```
Fixed, but took a slightly different approach — <explain what you did and why it's better or equivalent>.
```

**Deferred (agreed):**
```
Good call. Deferred to #<issue-number> to keep this PR focused. Will tackle in the next session.
```

**Disagree — explaining:**
```
I see the concern, but here's the reasoning: <explanation>.
Happy to change it if you feel strongly — let me know.
```

**Disagree — deferring the discussion:**
```
Let's sync on this — it's a broader pattern question. Keeping as-is for now and flagging in PR Known Limitations.
```

**Already handled:**
```
This is handled in <file>:<line> — <brief explanation of existing behavior>.
```

### 5. Push updated branch
```bash
git push origin calus/claude/<slug>
```

GitHub will automatically link new commits to the open PR.

### 6. Leave a top-level summary comment on the PR
After addressing all comments:
```
## Review Response Summary

All blocking issues addressed. Summary of changes:

- **Fixed**: <issue 1>
- **Fixed**: <issue 2>
- **Deferred**: <issue 3> → #<issue-number>
- **Kept as-is**: <issue 4> — <reasoning>

Ready for re-review.
```

## Constraints
- Never silently ignore a comment — every comment gets a response
- Never mark a comment as resolved without actually fixing it
- Don't re-open a discussion if the reviewer marked it resolved
- If you strongly disagree with a blocking comment, discuss before overriding
- Keep responses short — reviewers read many PRs
