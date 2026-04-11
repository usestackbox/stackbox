// src/git/inject.rs
//
// Called inside git_ensure — writes the agent instruction file into the user's
// repo root the first time an agent session starts.
//
// Rules:
//   - Only ONE file per agent, matched by kind string
//   - Never overwrites if the file already exists (user may have customised it)
//   - Skills are NEVER written here — they live in Calus's own .calus/ dir

use std::path::Path;

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

const CURSORRULES: &str = r###"# Calus — Agent Instructions (Cursor)

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

/// Inject the agent instruction file into the user's repo.
/// Called from `git_ensure` — cwd is the user's actual repo root.
/// kind is the kind_str: "claude" | "codex" | "gemini" | "cursor" | "copilot"
pub fn inject_into_repo(cwd: &Path, kind: &str) {
    match kind {
        "claude" => write_if_missing(&cwd.join("CLAUDE.md"), CLAUDE_MD),
        "codex" => write_if_missing(&cwd.join("AGENTS.md"), AGENTS_MD),
        "gemini" => write_if_missing(&cwd.join("GEMINI.md"), GEMINI_MD),
        "cursor" => write_if_missing(&cwd.join(".cursorrules"), CURSORRULES),
        "copilot" => {
            let dir = cwd.join(".github");
            let _ = std::fs::create_dir_all(&dir);
            write_if_missing(&dir.join("copilot-instructions.md"), COPILOT_MD);
        }
        _ => {} // shell or unknown — nothing to inject
    }
}

fn write_if_missing(path: &Path, content: &str) {
    if !path.exists() {
        let _ = std::fs::write(path, content);
    }
}