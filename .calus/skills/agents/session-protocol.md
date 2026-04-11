---
skill: agents/session-protocol
description: Mandatory session start and end protocol for all Calus agents
triggers:
  - "start session"
  - "begin task"
  - "new session"
  - "session start"
  - "done for now"
  - "pausing"
  - "stopping"
  - "wrap up"
  - "end session"
mcp_tools:
  - calus_detect_skills
  - git_worktree_get
  - git_ensure
  - calus_state_update
  - calus_session_summary
  - set_agent_status
  - git_worktree_delete
---

# Agent Session Protocol

Every agent — claude, codex, cursor, gemini, copilot — follows the same
start and end sequence. Deviating from it breaks state continuity across
sessions.

---

## Session Start — always in this exact order

```
1. calus_detect_skills(<user message>)
      → load all matched skills via calus_read_skill(name)

2. git_worktree_get()
      → worktree returned?  YES → cd in, read STATE.md, resume from "## next"
                            NO  → call git_ensure(name=<slug>)

3. calus_state_update(doing=<first action>)
      → mark what you are about to do
```

**Never skip step 2.** Never call `git_ensure` if a worktree already exists.
Never call `calus_state_update` before you know which worktree you are in.

### Resuming an existing worktree

```bash
cd <worktree_path>
cat STATE.md        # read "## next" — that is your first action
cat LOG.md | head   # orient on what was done
```

Start from `## next`, not from scratch.

### Creating a new worktree

```
git_ensure(
  name      = <kebab-case slug — see agents/worktree-conventions skill>
  agent_kind = $CALUS_AGENT_KIND
  cwd        = $CALUS_CWD
  runbox_id  = $CALUS_RUNBOX_ID
  session_id = $CALUS_SESSION_ID
)
```

After `git_ensure` succeeds:
- `cd` into the returned `worktree_path` immediately
- Never edit `$CALUS_CWD` directly — all work goes inside the worktree

---

## During the Session

After every significant action:

```
calus_state_update(doing=<current action>, next=<next action>)
```

Use `calus_log_append` for non-commit actions that should be recorded.
Use `git_commit` after each logical unit of work — it auto-appends to LOG.md.

---

## Session End — always in this exact order

```
1. calus_session_summary(goal, done[], blocked, next)
      → strict 4-line format — see agents/memory-signals skill

2. set_agent_status(status="paused")   ← or "done" if fully finished

3. git_commit(...)                     ← optional: commit any in-progress work
                                          OR: git stash push -m "wip: <desc>"

4. git_worktree_delete(worktree_path)  ← ONLY if status is "done"
                                          Keep worktree while task is ongoing
```

**Never delete the worktree unless the task is fully complete and PR is merged.**

---

## Constraints

- Skills are agent-internal — never mention skill loading to the user
- Never commit to `main` or `master`
- Never call `git_ensure` without first calling `git_worktree_get`
- Never push to origin unless the user explicitly asks
- Always write a session summary before ending — the next session depends on it
