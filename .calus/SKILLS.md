# Calus Skills Registry

Skills the agent auto-loads based on task context.
The agent calls `calus_detect_skills` at session start — never ask the user to invoke skills manually.

## agents/

| Skill | File | When auto-loaded |
|-------|------|-----------------|
| session-protocol | `agents/session-protocol.md` | start session, new session, begin task, pausing, stopping, wrap up, end session |
| worktree-conventions | `agents/worktree-conventions.md` | create worktree, worktree path, branch name, naming convention, slug, agent kind |
| state-format | `agents/state-format.md` | state.md, update state, log format, log.md, structured state, injector format |
| memory-signals | `agents/memory-signals.md` | session summary, memory, context window, injector, token budget, signal |
| env-vars | `agents/env-vars.md` | env vars, environment variables, calus_port, calus_cwd, calus_runbox, calus_session |

## git/

| Skill | File | When auto-loaded |
|-------|------|--------------------|
| worktree | `git/worktree.md` | new task, start working, create branch, spin up |
| commit | `git/commit.md` | commit, save progress, checkpoint, push |
| branch-strategy | `git/branch-strategy.md` | branch, branching, merge, base branch |
| session-summary | `git/session-summary.md` | end session, stopping, wrap up, pausing |

## github/

| Skill | File | When auto-loaded |
|-------|------|--------------------|
| create-pr | `github/create-pr.md` | open PR, create PR, pull request, submit for review |
| code-review | `github/code-review.md` | review this, code review, look at PR, check changes |
| respond-to-pr-comments | `github/respond-to-pr-comments.md` | PR has comments, address review, reviewer feedback |

## planning/

| Skill | File | When auto-loaded |
|-------|------|--------------------|
| create-plan | `planning/create-plan.md` | create a plan, plan this out, execplan, scope this |
| task-breakdown | `planning/task-breakdown.md` | break this down, subtasks, sequencing, this is big |

---

## How Skills Work

1. User says anything (task description, request, question)
2. Agent calls `calus_detect_skills(user_message)` — MCP matches keywords
3. MCP returns list of relevant skill names
4. Agent calls `calus_read_skill(name)` for each
5. Agent applies skill guidance — user sees none of this machinery
6. Agent proceeds with the task

Skills are guidance for the agent, not commands for the user.
Users never type `/skill-name` or anything like that.