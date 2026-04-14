// src/git/inject.rs
//
// Called inside git_ensure — writes the agent instruction file into the user's
// repo root the first time an agent session starts, then seeds skill directories
// that each agent natively discovers.
//
// Instruction files (write-if-missing):
//   claude  → CLAUDE.md
//   codex   → AGENTS.md
//   gemini  → GEMINI.md
//   cursor  → .cursorrules  +  .cursor/rules/calus.mdc  (new Cursor 2.x format)
//   copilot → .github/copilot-instructions.md
//
// Skill directories created for each agent:
//   .agents/skills/          ← universal (all agents that follow the spec)
//   .claude/skills/          ← Claude Code + Cursor compatibility
//   .codex/skills/           ← Codex + Cursor compatibility
//   .cursor/skills/          ← Cursor native
//   .gemini/skills/          ← Gemini CLI
//
// Each skill dir gets three Calus skills:
//   calus-git/SKILL.md       ← git worktree workflow
//   calus-state/SKILL.md     ← STATE.md + LOG.md format
//   calus-session/SKILL.md   ← session summary format

use std::path::Path;

// ── Agent instruction file contents ──────────────────────────────────────────

const CLAUDE_MD: &str = r###"# Calus — Agent Instructions (Claude)

## Session Start — Always in this order

```
1. calus_detect_skills(<user message>)        — load relevant skills
2. git_worktree_get()                          — check existing worktree
   → if worktree_path returned: read STATE.md, resume from "## next"
   → if null: call git_ensure(name=<slug>)
3. calus_state_update(doing=<first action>)   — mark what you're doing
```

Never skip step 2. Never call git_ensure if a worktree already exists.

---

## Env Vars (injected by Calus at spawn)

| Var               | Description |
|-------------------|-------------|
| `CALUS_RUNBOX_ID` | Pass to `runbox_id` in all kernel tools |
| `CALUS_SESSION_ID`| Pass to `session_id` in git_ensure |
| `CALUS_CWD`       | Pass to `cwd` in git_ensure |
| `CALUS_AGENT_KIND`| Your agent type — pass to `agent_kind` |
| `CALUS_PORT`      | Kernel HTTP port (MCP server reads this) |

---

## MCP Tools

### Kernel tools (proxied to Rust backend + DB)

| Tool | When |
|------|------|
| `git_worktree_get` | **First call every session** — check before creating |
| `git_ensure` | Only when get returns no worktree |
| `git_commit` | After each logical unit of work — auto-logs to LOG.md |
| `git_worktree_delete` | When task is fully done (branch kept) |
| `set_agent_status` | Status changes: working → done / cancelled |

### Local state tools

| Tool | When |
|------|------|
| `calus_state_update` | After every significant action |
| `calus_log_append` | For actions that aren't commits |
| `calus_session_summary` | When user says done / pausing / stopping |

### Skill tools

| Tool | When |
|------|------|
| `calus_detect_skills` | Start of every session |
| `calus_read_skill` | For each skill returned by detect |
| `calus_list_skills` | When unsure what skills exist |

---

## STATE.md Format

Kernel creates this on `git_ensure`. Keep it current.

```
# state
agent: claude
branch: calus/claude/<slug>
worktree: ~/calus/<hash>/.worktrees/claude-<slug>
status: in-progress
updated: 2026-01-15T09:41:00Z

## doing
- <what you're doing right now>

## next
- <next concrete action>

## blocked
- none

## done
- <what was completed>

## notes
Free-form observations go here only — not above.
```

Update via `calus_state_update`. Never edit manually.

---

## Session End Checklist

When user says done / stopping / pausing:

```
1. calus_session_summary(goal, done[], blocked, next)
2. set_agent_status(status="done", worktree_path=...)
3. git_commit (if uncommitted work)       ← optional
4. git_worktree_delete(worktree_path)     ← only if fully done
```

---

## Constraints

- Never commit to `main` or `master`
- Never call `git_ensure` without first calling `git_worktree_get`
- Never delete worktree without first setting status to `done`
- Never push to origin unless explicitly asked
- Skills are agent-internal — never mention them to the user
"###;

const AGENTS_MD: &str = r###"# Calus — Agent Instructions (Codex)

## First Action Every Session

Before doing anything else, call:

```
calus_detect_skills(<user's message>)
```

Then call `calus_read_skill(name)` for each matched skill.
Apply the skill guidance silently — do not narrate it to the user.

---

## Core Principles

### 1. Worktree-first
Every task gets its own git worktree. Never work on main directly.
- `git_worktree_get` → check first, resume if found
- `git_ensure` → create only if nothing exists
- Agent kind for all worktree/branch names: `codex`

Branch pattern: `calus/codex/<slug>`
Worktree path: `~/calus/<repo-hash>/.worktrees/codex-<slug>/`

### 2. Keep STATE.md current
```
status: in-progress | paused | blocked | done
goal:   <one sentence>
doing:  <current action>
next:   <next concrete action>
blocked: none | <blocker>
branch: calus/codex/<slug>
```

Call `calus_state_update` whenever your current action changes.

### 3. End sessions cleanly
When the user is done or pausing:
1. `calus_session_summary` — 4-line format, next session depends on it
2. `set_agent_status("paused")`
3. Commit or stash in-progress work

---

## MCP Tools Reference

| Tool | When |
|------|------|
| `calus_detect_skills` | Start of every session |
| `git_worktree_get` | Before any task — always check first |
| `git_ensure` | Create worktree if get returns exists=false |
| `git_commit` | Stage + commit + auto-log |
| `set_agent_status` | When task status changes |
| `calus_state_update` | After each significant action |
| `calus_session_summary` | When user is done / pausing |

---

## Constraints

- Never commit to `main` or `master`
- Never `git add .` without reviewing staged content
- Never create a PR unless explicitly asked
- Skills are agent-internal — never expose them to the user
"###;

const GEMINI_MD: &str = r###"# Calus — Agent Instructions (Gemini)

## First Action Every Session

Before doing anything else, call:

```
calus_detect_skills(<user's message>)
```

Then call `calus_read_skill(name)` for each matched skill.
Apply guidance internally — do not narrate to the user.

---

## Core Principles

### 1. Worktree-first
Every task runs in an isolated git worktree. Never touch main directly.
- `git_worktree_get` → always check before creating
- `git_ensure` → create only when nothing exists
- Agent kind identifier: `gemini`

Branch pattern: `calus/gemini/<slug>`
Worktree path: `~/calus/<repo-hash>/.worktrees/gemini-<slug>/`

### 2. Maintain STATE.md
```
status: in-progress
goal:   <one sentence>
doing:  <current action>
next:   <next concrete action>
blocked: none
branch: calus/gemini/<slug>
```

Call `calus_state_update` after every significant action.

### 3. Session summaries are mandatory
When the user indicates they're done or pausing:
1. `calus_session_summary(goal, done[], blocked, next)`
2. `set_agent_status("paused")`
3. Stash or commit any in-progress work

---

## MCP Tools

| Tool | Purpose |
|------|---------|
| `calus_detect_skills` | First call every session |
| `git_worktree_get` | Check existing worktree state |
| `git_ensure` | Create worktree + STATE.md + LOG.md |
| `git_commit` | Stage + commit + append to LOG.md |
| `set_agent_status` | Update status field |
| `calus_state_update` | Update doing/next/blocked + log |
| `calus_session_summary` | Write end-of-session summary |

---

## Constraints

- Never commit directly to `main` or `master`
- Never stage all files blindly — review before `git add`
- Only create PRs when explicitly asked
- Never mention skill loading to the user
"###;

// Cursor: written to .cursorrules (legacy) and .cursor/rules/calus.mdc (Cursor 2.x)
const CURSORRULES_BODY: &str = r###"# Calus — Agent Instructions (Cursor)

## First Action Every Session

Before doing anything else, call:

```
calus_detect_skills(<user's message>)
```

Then call `calus_read_skill(name)` for each matched skill.
Apply the skill guidance silently — do not mention it to the user.

---

## Core Principles

### 1. Worktree-first
Every task gets its own git worktree. Never work on main directly.
- Always call `git_worktree_get` first — resume existing worktrees
- Only call `git_ensure` if nothing exists
- Agent kind identifier: `cursor`

Branch pattern: `calus/cursor/<slug>`
Worktree path: `~/calus/<repo-hash>/.worktrees/cursor-<slug>/`

### 2. Keep STATE.md current
```
status: in-progress
goal:   <one sentence>
doing:  <what you're doing right now>
next:   <next step>
blocked: none
```

### 3. End sessions cleanly
1. `calus_session_summary(goal, done[], blocked, next)`
2. `set_agent_status("paused")`
3. Commit or stash in-progress work

---

## MCP Tools

| Tool | Purpose |
|------|---------|
| `calus_detect_skills` | Match task to skills (run first, every session) |
| `git_worktree_get` | Check for existing worktree |
| `git_ensure` | Create new worktree |
| `git_commit` | Commit + auto-log |
| `set_agent_status` | Update status in STATE.md |
| `calus_state_update` | Update doing/next/blocked |
| `calus_session_summary` | End-of-session 4-line summary |

---

## Constraints

- Never commit to `main` or `master`
- Never `git add .` blindly — stage intentionally
- Never create a PR unless explicitly asked
- Never expose skill machinery to the user
"###;

// Cursor 2.x MDC rule format — wraps the same body with frontmatter
const CURSOR_MDC: &str = r###"---
description: Calus agent workflow rules — git worktrees, state tracking, session summaries.
alwaysApply: true
---
# Calus — Agent Instructions (Cursor)

## First Action Every Session

Before doing anything else, call:

```
calus_detect_skills(<user's message>)
```

Then call `calus_read_skill(name)` for each matched skill.
Apply the skill guidance silently — do not mention it to the user.

---

## Core Principles

### 1. Worktree-first
Every task gets its own git worktree. Never work on main directly.
- Always call `git_worktree_get` first — resume existing worktrees
- Only call `git_ensure` if nothing exists
- Agent kind identifier: `cursor`

Branch pattern: `calus/cursor/<slug>`
Worktree path: `~/calus/<repo-hash>/.worktrees/cursor-<slug>/`

### 2. Keep STATE.md current
```
status: in-progress
goal:   <one sentence>
doing:  <what you're doing right now>
next:   <next step>
blocked: none
```

### 3. End sessions cleanly
1. `calus_session_summary(goal, done[], blocked, next)`
2. `set_agent_status("paused")`
3. Commit or stash in-progress work

---

## MCP Tools

| Tool | Purpose |
|------|---------|
| `calus_detect_skills` | Match task to skills (run first, every session) |
| `git_worktree_get` | Check for existing worktree |
| `git_ensure` | Create new worktree |
| `git_commit` | Commit + auto-log |
| `set_agent_status` | Update status in STATE.md |
| `calus_state_update` | Update doing/next/blocked |
| `calus_session_summary` | End-of-session 4-line summary |

---

## Constraints

- Never commit to `main` or `master`
- Never `git add .` blindly — stage intentionally
- Never create a PR unless explicitly asked
- Never expose skill machinery to the user
"###;

const COPILOT_MD: &str = r###"# Calus — Agent Instructions (Copilot)

## First Action Every Session

Before doing anything else, call:

```
calus_detect_skills(<user's message>)
```

Then call `calus_read_skill(name)` for each matched skill.
Apply the skill guidance silently — never surface the machinery to the user.

---

## Core Principles

### 1. Worktree-first
Every task gets an isolated git worktree. Never work on main directly.
- Always call `git_worktree_get` first — resume if found
- Only call `git_ensure` if the worktree doesn't exist
- Agent kind identifier: `copilot`

Branch pattern: `calus/copilot/<slug>`
Worktree path: `~/calus/<repo-hash>/.worktrees/copilot-<slug>/`

### 2. Keep STATE.md current
```
status: in-progress
goal:   <one sentence>
doing:  <current action>
next:   <next concrete action>
blocked: none
branch: calus/copilot/<slug>
```

Update via `calus_state_update` after each significant action.

### 3. End every session cleanly
1. `calus_session_summary(goal, done[], blocked, next)`
2. `set_agent_status("paused")`
3. Commit or stash any in-progress work

---

## MCP Tools

| Tool | Purpose |
|------|---------|
| `calus_detect_skills` | Start of every session — always first |
| `git_worktree_get` | Check if worktree exists (always call first) |
| `git_ensure` | Create worktree + STATE.md + LOG.md |
| `git_commit` | Stage + commit + auto-append LOG.md |
| `set_agent_status` | Update status field in STATE.md |
| `calus_state_update` | Update doing/next/blocked + log line |
| `calus_session_summary` | Write end-of-session 4-line summary |

---

## Constraints

- Never commit to `main` or `master`
- Never `git add .` without reviewing what's staged
- Never create a PR unless the user explicitly asks for it
- Never mention skills or MCP tools to the user
"###;

// ── Skill file contents ───────────────────────────────────────────────────────
// Three skills are seeded into every skill directory.
// Agents discover these natively — no MCP tool call required.

const SKILL_GIT: &str = r###"---
name: calus-git
description: Calus git worktree workflow. Use at the start of every task to set up an isolated worktree, and at the end to clean up. Relevant whenever the user asks to start a task, fix something, or build a feature.
---
# calus-git — Git Worktree Workflow

Every task runs in an isolated git worktree managed by Calus.
Never edit the main repo directory directly.

## Session Start

1. Call `git_worktree_get` with your `runbox_id` (from `CALUS_RUNBOX_ID` env var).
   - If a worktree is returned → `cd` into it and read `STATE.md` to resume.
   - If null → proceed to step 2.
2. Call `git_ensure` with a short task slug:
   - Required fields: `runbox_id`, `agent_kind`, `cwd` (from `CALUS_CWD`), `name`
   - Good slugs: `fix-null-crash`, `feat-oauth`, `bug-login-loop`
   - Bad slugs: `task`, `work`, `fix` (too vague)
3. `cd` into the returned `worktree_path` before touching any file.

## During Work

- Commit regularly with `git_commit(worktree_path, message)`.
- Keep commit messages short and descriptive: `fix: null check in auth middleware`.
- Never commit to `main` or `master`.
- Never `git add .` without reviewing what will be staged.

## Session End

1. Call `git_commit` for any uncommitted changes.
2. Call `git_worktree_delete(worktree_path)` — directory removed, branch kept.
3. The human reviews the branch diff and triggers merge from the UI.

## Branch Naming

Branches follow the pattern `calus/<agent_kind>/<slug>`.
Example: `calus/claude/fix-null-crash`

## Constraints

- Never merge your own branch — that is the human's job.
- Never push to origin unless explicitly asked.
- Never create a new worktree if one already exists for this task.
"###;

const SKILL_STATE: &str = r###"---
name: calus-state
description: Calus STATE.md and LOG.md format. Use whenever reading or writing task state, tracking progress, or logging actions. Relevant for any task that spans more than one action.
---
# calus-state — State and Log Format

Calus creates `STATE.md` and `LOG.md` inside your worktree on `git_ensure`.
Keep them current throughout the session.

## STATE.md Format

```
# state
agent: <your kind>
branch: calus/<kind>/<slug>
worktree: <absolute path>
status: in-progress
updated: <ISO 8601 timestamp>

## doing
- <one line: exactly what you are doing RIGHT NOW>

## next
- <one line: the immediate next step>

## blocked
- none

## done
- <completed item>

## notes
Free-form observations here only — not above.
```

### Status values

| Value | Meaning |
|-------|---------|
| `in-progress` | Actively working |
| `paused` | Session ended, resumable |
| `blocked` | Waiting on something external |
| `done` | Task fully complete |

### Rules

- Signal fields (`status`, `doing`, `next`, `blocked`) must be single `key: value` lines.
- Never put prose in signal fields — use `## notes` for that.
- Update `doing` and `next` after every significant action.
- Set `status: done` before calling `git_worktree_delete`.

## LOG.md Format

Each line is one action:

```
- [YYYY-MM-DD HH:MM] <action> — <reason>
```

Example:
```
- [2026-04-13 09:15] read STATE.md — resuming paused session
- [2026-04-13 09:17] fixed null check in auth.rs — was crashing on empty token
- [2026-04-13 09:22] committed fix-null-crash — ready for review
```

## Updating State

Use `calus_state_update` MCP tool — do not edit STATE.md manually.
Use `calus_log_append` for log entries that are not git commits.
"###;

const SKILL_SESSION: &str = r###"---
name: calus-session
description: Calus session summary format. Use at the end of every session when the user says done, pausing, stopping, or thanks. Required before ending any agent session.
---
# calus-session — Session Summary

Call `calus_session_summary` at the end of every session.
The next session (same or different agent) depends on this summary to resume correctly.

## Summary Format — Strict

Exactly four `key: value` lines. No prose. No headers. No bullet lists.

```
goal: <one sentence describing the overall task>
done: <comma-separated list of completed items>
blocked: <blocker, or ->
next: <first concrete action on resume>
```

### Good example

```
goal: implement JWT authentication middleware
done: token validation, refresh endpoint, error handling
blocked: -
next: write integration tests for refresh flow
```

### Bad example (do not do this)

```
## Summary
I worked on the auth module today. I completed the token validation
and refresh endpoint. Next I will write tests.
```

## When to Call

Call `calus_session_summary` when the user says any of:
- "done", "finished", "that's it", "stop here"
- "pause", "pausing", "I'll continue later"
- "thanks", "thank you", "good job"
- Any explicit sign-off

## Full Session End Sequence

```
1. calus_session_summary(goal, done, blocked, next)
2. set_agent_status(runbox_id, "done")         ← or "paused" if resumable
3. git_commit(worktree_path, message)           ← if uncommitted work
4. git_worktree_delete(worktree_path)           ← only if status = done
```

Never skip the summary — the next agent session will start blind without it.
"###;

// ── Public entry point ────────────────────────────────────────────────────────

/// Inject agent instruction file + skill directories into the user's repo.
/// Called from `git_ensure` (MCP) and PTY spawn.
/// `cwd` is the user's actual repo root — never the worktree.
/// `kind` is the kind_str: "claude" | "codex" | "gemini" | "cursor" | "copilot"
pub fn inject_into_repo(cwd: &Path, kind: &str) {
    // 1. Write the per-agent instruction file (tells the agent how to use Calus).
    inject_instruction_file(cwd, kind);

    // 2. Seed skill directories so agents discover Calus skills natively.
    //    The universal .agents/skills/ path covers all spec-compliant agents.
    //    Agent-specific paths cover native discovery per agent.
    inject_skills(cwd, kind);
}

// ── Instruction file ──────────────────────────────────────────────────────────

fn inject_instruction_file(cwd: &Path, kind: &str) {
    match kind {
        "claude" => {
            write_if_missing(&cwd.join("CLAUDE.md"), CLAUDE_MD);
        }
        "codex" => {
            write_if_missing(&cwd.join("AGENTS.md"), AGENTS_MD);
        }
        "gemini" => {
            write_if_missing(&cwd.join("GEMINI.md"), GEMINI_MD);
        }
        "cursor" => {
            // Legacy format — still read by older Cursor versions
            write_if_missing(&cwd.join(".cursorrules"), CURSORRULES_BODY);

            // Cursor 2.x native format — .cursor/rules/*.mdc with frontmatter
            let rules_dir = cwd.join(".cursor").join("rules");
            let _ = std::fs::create_dir_all(&rules_dir);
            write_if_missing(&rules_dir.join("calus.mdc"), CURSOR_MDC);
        }
        "copilot" => {
            let dir = cwd.join(".github");
            let _ = std::fs::create_dir_all(&dir);
            write_if_missing(&dir.join("copilot-instructions.md"), COPILOT_MD);
        }
        _ => {} // shell or unknown — nothing to inject
    }
}

// ── Skill directories ─────────────────────────────────────────────────────────

fn inject_skills(cwd: &Path, kind: &str) {
    // Universal — all agents that follow the Agent Skills spec read this.
    write_skill_dir(&cwd.join(".agents").join("skills"));

    // Per-agent native directories.
    // Cursor also reads .claude/skills/ and .codex/skills/ for compatibility
    // (per Cursor docs), so those are always written regardless of agent kind.
    match kind {
        "claude" => {
            write_skill_dir(&cwd.join(".claude").join("skills"));
        }
        "codex" => {
            write_skill_dir(&cwd.join(".codex").join("skills"));
        }
        "gemini" => {
            write_skill_dir(&cwd.join(".gemini").join("skills"));
        }
        "cursor" => {
            // Cursor reads all three of these natively
            write_skill_dir(&cwd.join(".cursor").join("skills"));
            write_skill_dir(&cwd.join(".claude").join("skills"));
            write_skill_dir(&cwd.join(".codex").join("skills"));
        }
        "copilot" => {
            // No native skill dir spec for Copilot yet — universal covers it
        }
        _ => {}
    }
}

/// Write the three Calus skills into a skill directory root.
/// Each skill is a subfolder with a SKILL.md — the Agent Skills standard format.
fn write_skill_dir(skills_root: &Path) {
    let _ = std::fs::create_dir_all(skills_root);

    write_skill(skills_root, "calus-git", SKILL_GIT);
    write_skill(skills_root, "calus-state", SKILL_STATE);
    write_skill(skills_root, "calus-session", SKILL_SESSION);
}

/// Write a single skill folder: <skills_root>/<name>/SKILL.md
fn write_skill(skills_root: &Path, name: &str, content: &str) {
    let skill_dir = skills_root.join(name);
    let _ = std::fs::create_dir_all(&skill_dir);
    write_if_missing(&skill_dir.join("SKILL.md"), content);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn write_if_missing(path: &Path, content: &str) {
    if !path.exists() {
        let _ = std::fs::write(path, content);
    }
}
