---
skill: planning/task-breakdown
description: Break a large task into ordered, shippable subtasks before starting work
triggers:
  - "break this down"
  - "how do we approach"
  - "where do we start"
  - "this is big"
  - "chunk this"
  - "subtasks"
  - "sequencing"
  - "order of operations"
---

# Planning — Task Breakdown Skill

## Purpose
Big tasks done in one shot produce big PRs that are hard to review, hard to
test, and hard to roll back. Breaking them into ordered subtasks means each
piece is shippable, testable, and reviewable on its own.

## Breakdown Principles

### 1. Each subtask must be independently shippable
- It passes all tests on its own
- It doesn't leave the codebase broken mid-way
- If it never gets followed up, the codebase is still in a good state

### 2. Order by dependency, not preference
- Foundation first (schema, types, interfaces)
- Then behavior (logic, handlers)
- Then surface (UI, API routes)
- Then polish (error states, edge cases, tests)

### 3. Keep subtasks small enough to fit one PR
A subtask that takes more than one session is probably still too big.

### 4. Be explicit about what each subtask is NOT doing
This prevents scope creep inside the subtask.

## Breakdown Format

```markdown
## Task: <Overall Task Name>

**Goal:** <What will be true when all subtasks are done?>

---

### Subtask 1: <Name>
**Goal:** <What this subtask achieves>
**Branch:** `calus/claude/<slug>-1`
**Depends on:** none

Steps:
- [ ] <step>
- [ ] <step>

Out of scope: <explicitly excluded>
Expected PR size: small / standard / large

---

### Subtask 2: <Name>
**Goal:** <What this subtask achieves>
**Branch:** `calus/claude/<slug>-2`
**Depends on:** Subtask 1 merged

Steps:
- [ ] <step>
- [ ] <step>

Out of scope: <explicitly excluded>
Expected PR size: small / standard / large

---

### Subtask 3: <Name>
...
```

## Example

Task: "Add Google OAuth login"

```markdown
## Task: Add Google OAuth Login

**Goal:** Users can sign in with their Google account as an alternative to email/password.

---

### Subtask 1: OAuth provider infrastructure
**Goal:** Passport.js configured, Google strategy registered, env vars documented
**Branch:** `calus/claude/oauth-infra`
**Depends on:** none

Steps:
- [ ] Install passport, passport-google-oauth20
- [ ] Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET to .env.example
- [ ] Register Google strategy with placeholder callbacks

Out of scope: actual login flow, UI, session handling
Expected PR size: small

---

### Subtask 2: Auth routes and session handling
**Goal:** /auth/google and /auth/google/callback routes work end-to-end
**Branch:** `calus/claude/oauth-routes`
**Depends on:** Subtask 1 merged

Steps:
- [ ] Create /auth/google route (redirects to Google)
- [ ] Create /auth/google/callback (handles token exchange)
- [ ] Upsert user in DB on first login
- [ ] Set session cookie after successful auth

Out of scope: UI button, error pages
Expected PR size: standard

---

### Subtask 3: UI and error states
**Goal:** Login page has "Sign in with Google" button, errors are user-friendly
**Branch:** `calus/claude/oauth-ui`
**Depends on:** Subtask 2 merged

Steps:
- [ ] Add Google login button to /login page
- [ ] Handle auth errors gracefully (/auth/error route)
- [ ] Add loading state during redirect

Out of scope: account linking for existing users
Expected PR size: small
```

## Steps

### 1. Understand the full scope first
Read relevant existing code. Don't break down what you don't understand.

### 2. Identify natural seams
Where does behavior naturally separate? Schema / logic / UI is a common seam.
Another: read-path first, then write-path.

### 3. Write the breakdown
Present to user for confirmation before starting any subtask.

### 4. Work one subtask at a time
Complete (PR merged) before starting the next. Don't work in parallel
unless explicitly asked.

## Constraints
- Never start subtask N+1 before subtask N is merged
- Each subtask must leave the codebase passing all tests
- "Out of scope" is mandatory for every subtask
- If a subtask grows beyond what was planned, stop and re-scope
