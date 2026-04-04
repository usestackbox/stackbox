// src-tauri/src/workspace/context.rs
// Supercontext V3 — 4 tools: memory_context / remember / session_log / session_summary
//
// Stackbox context system — files written to every worktree at session start:
//
//   .stackbox/roadmap.md              — project goal + milestones, shared across all agents
//   .stackbox/log/{branch}.md         — append-only execution trace, agent can cat/grep
//   .stackbox/meta/{branch}.yaml      — live project metadata: stack, files, env keys, port
//   .stackbox/commands/ci-check.md    — run lint/typecheck/test before any PR
//   .stackbox/commands/plan.md        — write a plan before coding anything non-trivial
//   .stackbox/commands/pr.md          — full PR flow: commit → push → gh pr create
//   .stackbox/commands/clean-code.md  — remove noise, simplify, self-documenting code
//   .stackbox/commands/sync.md        — fetch origin, see teammate changes, resolve conflicts
//
// Agent-specific context files (each agent reads its own format):
//   CLAUDE.md                         — Claude Code
//   AGENTS.md                         — Codex
//   GEMINI.md                         — Gemini CLI
//   .cursor/rules                     — Cursor Agent
//   .github/copilot-instructions.md   — GitHub Copilot
//
// Plus live snapshots injected into each agent file at session start:
//   git status · diff vs main · recent commits · other active agents · open PRs · file tree

use crate::agent::kind::AgentKind;

pub const MEMORY_PORT: u16 = 7547;

pub async fn rewrite_context(
    db:         &crate::db::Db,
    runbox_id:  &str,
    session_id: &str,
    cwd:        &str,
    agent:      &AgentKind,
) -> Result<(), String> {
    let content = build(db, runbox_id, session_id, cwd, agent).await?;
    let path    = std::path::Path::new(cwd).join(".stackbox-context.md");
    std::fs::write(&path, &content).map_err(|e| format!("write context: {e}"))?;
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// .stackbox/commands/ — shared playbooks for all agents
// ─────────────────────────────────────────────────────────────────────────────

/// Write the .stackbox/commands/ directory with 5 playbook files.
/// These are written once and never overwritten — agents own them after first creation.
/// All 5 agents (Claude, Codex, Gemini, Cursor, Copilot) read the same markdown files.
pub fn write_commands_dir(cwd: &str) {
    let commands_dir = std::path::Path::new(cwd).join(".stackbox").join("commands");
    let _ = std::fs::create_dir_all(&commands_dir);

    // ── ci-check.md ──────────────────────────────────────────────────────────
    let ci = commands_dir.join("ci-check.md");
    if !ci.exists() {
        let _ = std::fs::write(&ci, r#"# CI Check — Run Before Every PR

Run all checks locally before pushing. Never open a PR with failing checks.

## When to use
- Before `git push` or `gh pr create`
- After making significant changes
- When you suspect something broke

## Steps

Run these checks. Stop and fix any failure before continuing.

### 1. Detect the stack and run the right checks

**Node / Bun project** (has `package.json`):
```sh
# Check what scripts exist
cat package.json | grep -A 20 '"scripts"'

# Run in order — stop at first failure
bun run lint        # or: npm run lint / yarn lint
bun run typecheck   # or: npx tsc --noEmit
bun test            # or: npm test
```

**Rust project** (has `Cargo.toml`):
```sh
cargo fmt --check   # formatting
cargo clippy        # lints
cargo test          # tests
```

**Python project** (has `pyproject.toml` or `requirements.txt`):
```sh
ruff check .        # lints (if ruff installed)
mypy .              # types (if mypy installed)
pytest              # tests
```

**Go project** (has `go.mod`):
```sh
go vet ./...
go test ./...
```

### 2. Report results

After all checks, append to your log:
```
[ci] lint=pass typecheck=pass test=pass — ready for PR
[ci] lint=FAIL typecheck=pass test=pass — fixing lint errors
```

### 3. Fix failures before PR

- Fix every error — warnings that fail CI count as errors
- Re-run the failing check to confirm it passes cleanly
- Do not open a PR until all checks pass

## Common fixes

**Lint auto-fix:**
```sh
bun run lint:fix     # biome / eslint --fix
cargo fmt            # rust
ruff check --fix .   # python
```

**Type errors:** read the error message carefully — it tells you exactly what type is wrong.

**Test failures:** run the specific failing test file in isolation first.
"#);
    }

    // ── plan.md ───────────────────────────────────────────────────────────────
    let plan = commands_dir.join("plan.md");
    if !plan.exists() {
        let _ = std::fs::write(&plan, r#"# Plan — Write Before Coding Anything Non-Trivial

Before writing code for any task that touches more than 2 files or takes more than 15 minutes, write a plan first. This prevents wasted work and makes your changes reviewable.

## When to use
- Any feature that touches multiple files or modules
- Any bug fix where the root cause is not immediately obvious
- Any refactor that changes how things connect
- When you are unsure where to start

## When to skip
- Single-file typo or copy fix
- Renaming a variable with no logic change
- Adding a missing import

## How to write a plan

Create a plan file at `.stackbox/plans/{YYYY-MM-DD}-{short-title}.md`:

```sh
mkdir -p .stackbox/plans
# then write the file
```

### Plan template

```markdown
# Plan: {what you are doing}

## Why
One sentence: what problem does this solve for the user?

## What changes
List every file you expect to touch and what changes in each.
Be specific — name functions, modules, types.

## Approach
Describe the sequence of changes in prose.
Explain any non-obvious decisions.

## Risks
What could go wrong? What are you unsure about?

## How to verify
Exact commands to run and what output to expect.

## Steps
- [ ] Step 1
- [ ] Step 2
- [ ] Step 3
```

## Rules

- Read the existing code before writing the plan — do not plan from assumption
- Name every file you will touch with its full path
- Include exact commands to verify the result
- Update the plan as you discover things — it is a living document
- When done, mark all steps complete and update `.stackbox/roadmap.md`

## Log the plan

After writing, append to your log:
```
[plan] wrote .stackbox/plans/2024-01-15-auth-refactor.md — 4 files, 3 steps
```
"#);
    }

    // ── pr.md ─────────────────────────────────────────────────────────────────
    let pr = commands_dir.join("pr.md");
    if !pr.exists() {
        let _ = std::fs::write(&pr, r#"# PR — Push Branch and Open Pull Request

Full flow from finished work to open PR. Follow every step in order.

## When to use
- When your work is complete and all CI checks pass
- Never open a PR with failing checks — run `.stackbox/commands/ci-check.md` first

## Steps

### 1. Make sure everything is committed
```sh
git status          # should show clean or only intentional untracked files
git add -A
git commit -m "type: short description of what changed"
```

**Commit message format:**
- `feat: add user authentication`
- `fix: resolve race condition in session cleanup`
- `refactor: simplify worktree detection logic`
- `chore: update dependencies`
- `docs: add setup instructions`

### 2. Run CI checks
```sh
# Read .stackbox/commands/ci-check.md and run the right checks for this stack
# Do not proceed until all pass
```

### 3. Push the branch
```sh
git push origin HEAD
# If first push: git push --set-upstream origin HEAD
```

### 4. Open the PR

**If gh CLI is installed:**
```sh
gh pr create \
  --title "type: clear description of what this PR does" \
  --body "$(cat <<'EOF'
## What changed
- Bullet point every meaningful change

## Why
One sentence explaining the problem this solves

## How to verify
Exact steps to test this manually

## Notes
Anything the reviewer should know
EOF
)" \
  --base main
```

**If gh CLI is not installed:**
```sh
git push origin HEAD
# Then open the compare URL printed by git push in your browser
```

### 5. Log the PR
```
[done] PR opened — https://github.com/org/repo/pull/123
```

Also update `.stackbox/roadmap.md` to mark the milestone complete.

## Good PR title examples
- `feat: add worktree isolation per agent session`
- `fix: prevent double worktree creation on spawn`
- `refactor: move context injection to workspace module`

## Bad PR title examples
- `updates` — says nothing
- `fix bug` — which bug?
- `WIP` — never open a WIP PR from a stackbox branch
"#);
    }

    // ── clean-code.md ─────────────────────────────────────────────────────────
    let clean = commands_dir.join("clean-code.md");
    if !clean.exists() {
        let _ = std::fs::write(&clean, r#"# Clean Code — Apply Before Committing

Apply these rules to any file you touch. Leave code cleaner than you found it.

## Comments — remove noise, keep signal

**Remove these immediately:**
- Comments that restate what the code does (`// increment counter` before `counter++`)
- Commented-out code blocks — version control exists, delete them
- TODO/FIXME that will never be addressed — delete or create a real task
- Outdated comments that no longer match the code

**Keep or add only:**
- Why a non-obvious decision was made (`// use i32 not usize — wasm target has 32-bit pointers`)
- External constraints not obvious from code (`// Stripe requires idempotency key on retry`)
- Warnings about non-intuitive edge cases
- Public API documentation (JSDoc, rustdoc, docstrings)

**Rule:** if you need a comment to explain *what* the code does, rewrite the code to be clearer instead.

## Naming — make it self-documenting

Bad → Good:
- `d` → `elapsed_ms`
- `tmp` → `normalized_path`
- `flag` → `is_authenticated`
- `do_thing()` → `remove_orphan_worktrees()`
- `handle()` → `handle_pr_merge_event()`

## Structure — reduce complexity

- Use early returns to reduce nesting depth
- Extract well-named functions instead of commenting code blocks
- Remove dead code, unused variables, unreachable branches
- Prefer explicit over clever (`if is_empty` not `if !items.len() > 0`)

## Temp files — never create them

Never create:
- `payload.json`, `test.py`, `fix.sh`, `debug.txt`
- Any file that exists only to help you during development

If you need to test something, write a proper test. If you need to store data, use the appropriate mechanism.

## After applying clean code

Run CI checks to confirm nothing broke:
```sh
# See .stackbox/commands/ci-check.md
```

Log it:
```
[clean] removed 12 noise comments, renamed 3 variables, deleted unused function in auth.ts
```
"#);
    }

    // ── sync.md ───────────────────────────────────────────────────────────────
    let sync = commands_dir.join("sync.md");
    if !sync.exists() {
        let _ = std::fs::write(&sync, r#"# Sync — Stay Up to Date With Teammates

Use this when you want to see what other agents have done, pull their merged work, or resolve conflicts.

## When to use
- Before starting a new task (get latest from main)
- When you see other agents in the Workspace Snapshot
- When `git merge` or `git rebase` reports conflicts
- After a teammate's PR is merged and you need their changes

## See what teammates are doing

```sh
# List all active agent worktrees
ls ../stackbox-wt-*/

# See another agent's branch and last commit
git -C ../stackbox-wt-{their-id}/ log -3 --oneline

# Diff your branch against theirs
git fetch origin
git diff HEAD..origin/stackbox/{their-id}

# See what files they changed
git diff --name-only HEAD..origin/stackbox/{their-id}
```

## Pull merged work from main

```sh
# Get latest from origin
git fetch origin

# See what merged since your branch was created
git log HEAD..origin/main --oneline

# Merge main into your branch (keeps your commits on top)
git merge origin/main

# Or rebase (cleaner history, requires force-push after)
git rebase origin/main
```

## Resolve conflicts

If merge or rebase reports conflicts:

```sh
# See which files have conflicts
git status

# For each conflicted file — open it and look for:
# <<<<<<< HEAD         (your changes)
# =======
# >>>>>>> origin/main  (their changes)

# Edit the file to keep the right combination of both
# Then mark resolved:
git add {file}

# Continue the merge/rebase
git merge --continue
# or
git rebase --continue
```

**Conflict resolution rules:**
- Read both sides carefully before choosing
- When in doubt, keep both changes (combine them)
- Never delete the other agent's work without understanding why it was added
- After resolving, run CI checks to make sure nothing broke

## Log after syncing

```
[sync] merged origin/main — 3 commits pulled, no conflicts
[sync] resolved conflict in src/auth.ts — kept both JWT and session changes
```
"#);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// .stackbox/ directory — persistent workspace intelligence
// ─────────────────────────────────────────────────────────────────────────────

/// Write (or update) the .stackbox/ directory in the worktree.
///
/// Layout:
///   .stackbox/
///   ├── roadmap.md            — project goal + milestones (created once, agent updates it)
///   ├── log/
///   │   └── {branch}.md       — append-only execution trace (agent appends, never deletes)
///   ├── meta/
///   │   └── {branch}.yaml     — project metadata snapshot (refreshed each session)
///   ├── plans/                — agent-written plan files (created by agents via plan.md command)
///   └── commands/
///       ├── ci-check.md       — run checks before PR
///       ├── plan.md           — write plan before coding
///       ├── pr.md             — full PR flow
///       ├── clean-code.md     — code quality rules
///       └── sync.md           — sync with teammates
pub fn write_stackbox_dir(cwd: &str, branch: &str, pane_port: u16) {
    let root     = std::path::Path::new(cwd).join(".stackbox");
    let log_dir  = root.join("log");
    let meta_dir = root.join("meta");
    let plans_dir = root.join("plans");

    let _ = std::fs::create_dir_all(&log_dir);
    let _ = std::fs::create_dir_all(&meta_dir);
    let _ = std::fs::create_dir_all(&plans_dir);

    // Write the 5 command playbooks (idempotent — skipped if already exist)
    write_commands_dir(cwd);

    // Sanitise branch name for use as filename (stackbox/abc123 → stackbox_abc123)
    let branch_file = branch.replace('/', "_");

    // ── roadmap.md — created once, never overwritten by Stackbox ─────────────
    let roadmap = root.join("roadmap.md");
    if !roadmap.exists() {
        let _ = std::fs::write(&roadmap, format!(
r#"# Project Roadmap
*Maintained by agents. Update as the project evolves.*

## Goal
<!-- Describe the overall project goal here. -->

## Milestones
- [ ] <!-- Add milestones as you discover them -->

## Decisions
<!-- Key architectural decisions, constraints, things never to change -->

## Active Agents
<!-- Updated automatically by Stackbox on each session start -->
"#
        ));
    }
    refresh_roadmap_agents(&roadmap, cwd);

    // ── log/{branch}.md — created if not exists, session header appended ─────
    let log_file = log_dir.join(format!("{branch_file}.md"));
    if !log_file.exists() {
        let _ = std::fs::write(&log_file, format!(
r#"# Execution Log — {branch}
*Append-only. Each line is one [step]/[done]/[error]/[blocked] entry.*
*Do not edit previous entries. Only append.*

---
"#
        ));
    } else {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new().append(true).open(&log_file) {
            let _ = writeln!(f, "\n--- session resumed (ts:{ts}) ---\n");
        }
    }

    // ── meta/{branch}.yaml — refreshed every session ─────────────────────────
    let meta_file = meta_dir.join(format!("{branch_file}.yaml"));
    let yaml = build_meta_yaml(cwd, branch, pane_port);
    let _ = std::fs::write(&meta_file, yaml);
}

/// Refresh the "Active Agents" section of roadmap.md with current worktree list.
fn refresh_roadmap_agents(roadmap: &std::path::Path, cwd: &str) {
    let parent = match std::path::Path::new(cwd).parent() {
        Some(p) => p,
        None    => return,
    };

    let mut lines: Vec<String> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(parent) {
        for entry in entries.filter_map(|e| e.ok()) {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("stackbox-wt-") { continue; }

            let branch = std::process::Command::new("git")
                .args(["rev-parse", "--abbrev-ref", "HEAD"])
                .current_dir(entry.path())
                .output()
                .ok()
                .filter(|o| o.status.success())
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .unwrap_or_else(|| "unknown".to_string());

            let last = std::process::Command::new("git")
                .args(["log", "-1", "--oneline", "--no-decorate"])
                .current_dir(entry.path())
                .output()
                .ok()
                .filter(|o| o.status.success())
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .unwrap_or_else(|| "no commits".to_string());

            lines.push(format!("- `{branch}` — {last}"));
        }
    }

    let existing = std::fs::read_to_string(roadmap).unwrap_or_default();
    const MARKER: &str = "## Active Agents";
    const NEXT:   &str = "\n## ";

    let section = format!(
        "## Active Agents\n{}\n",
        if lines.is_empty() { "- (none)".to_string() } else { lines.join("\n") }
    );

    let updated = if let Some(s) = existing.find(MARKER) {
        let tail = &existing[s + MARKER.len()..];
        let end  = tail.find(NEXT).map(|i| s + MARKER.len() + i).unwrap_or(existing.len());
        format!("{}{}{}", &existing[..s], section, &existing[end..])
    } else {
        format!("{existing}\n{section}")
    };

    let _ = std::fs::write(roadmap, updated);
}

/// Build the meta/{branch}.yaml content — refreshed at every session start.
fn build_meta_yaml(cwd: &str, branch: &str, pane_port: u16) -> String {
    let has = |name: &str| std::path::Path::new(cwd).join(name).exists();

    let stack = if has("package.json") {
        let pkg = std::fs::read_to_string(std::path::Path::new(cwd).join("package.json"))
            .unwrap_or_default();
        if pkg.contains("\"next\"")    { "nextjs" }
        else if pkg.contains("\"react\"")  { "react" }
        else if pkg.contains("\"vue\"")    { "vue" }
        else if pkg.contains("\"svelte\"") { "svelte" }
        else { "nodejs" }
    } else if has("Cargo.toml")                                  { "rust" }
      else if has("pyproject.toml") || has("requirements.txt")   { "python" }
      else if has("go.mod")                                       { "go" }
      else if has("pom.xml") || has("build.gradle")              { "java" }
      else                                                        { "unknown" };

    let ignore = [
        "node_modules", ".git", "target", "dist", "build",
        ".next", ".cache", "__pycache__", ".venv", "venv",
        ".stackbox", ".claude", ".codex", ".stackbox-context.md",
        "CLAUDE.md", "AGENTS.md", "GEMINI.md",
    ];

    let mut files: Vec<String> = std::fs::read_dir(cwd)
        .map(|rd| rd.filter_map(|r| r.ok())
            .filter_map(|r| {
                let name = r.file_name().to_string_lossy().to_string();
                if ignore.contains(&name.as_str()) { return None; }
                if name.starts_with('.') && name != ".env" && name != ".github" { return None; }
                let is_dir = r.file_type().map(|t| t.is_dir()).unwrap_or(false);
                Some(if is_dir { format!("{name}/") } else { name })
            })
            .collect())
        .unwrap_or_default();
    files.sort();

    let env_keys: Vec<String> = std::fs::read_to_string(
            std::path::Path::new(cwd).join(".env")
        )
        .unwrap_or_default()
        .lines()
        .filter(|l| !l.trim().is_empty() && !l.starts_with('#'))
        .filter_map(|l| l.split('=').next().map(str::trim).map(str::to_string))
        .collect();

    format!(
r#"branch: "{branch}"
stack: "{stack}"
port: {pane_port}

files:
{files_yaml}

env_keys:
{env_yaml}

# Add architectural notes below — these persist across sessions
# examples:
#   auth: "JWT, 1h expiry, refresh at 50min"
#   db: "postgres via prisma, migrations in prisma/migrations/"
#   api: "REST, base https://api.example.com/v2"
notes:
"#,
        files_yaml = if files.is_empty() {
            "  []".to_string()
        } else {
            files.iter().map(|f| format!("  - \"{f}\"")).collect::<Vec<_>>().join("\n")
        },
        env_yaml = if env_keys.is_empty() {
            "  []".to_string()
        } else {
            env_keys.iter().map(|k| format!("  - {k}")).collect::<Vec<_>>().join("\n")
        },
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Live snapshot helpers — all non-fatal, called during build()
// ─────────────────────────────────────────────────────────────────────────────

fn branch_from_worktree(cwd: &str) -> String {
    if let Ok(out) = std::process::Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(cwd)
        .output()
    {
        let b = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !b.is_empty() && b != "HEAD" { return b; }
    }
    std::path::Path::new(cwd)
        .file_name()
        .and_then(|n| n.to_str())
        .and_then(|n| n.strip_prefix("stackbox-wt-"))
        .map(|s| format!("stackbox/{s}"))
        .unwrap_or_else(|| "stackbox/unknown".to_string())
}

fn git_status_snapshot(cwd: &str) -> String {
    let out = std::process::Command::new("git")
        .args(["status", "--short", "--untracked-files=normal"])
        .current_dir(cwd)
        .output();
    match out {
        Ok(o) if o.status.success() => {
            let text = String::from_utf8_lossy(&o.stdout).to_string();
            if text.trim().is_empty() {
                "  (clean — no changes yet)".to_string()
            } else {
                let lines: Vec<&str> = text.lines().collect();
                if lines.len() > 30 {
                    format!("{}\n  … ({} more)", lines[..30].join("\n"), lines.len() - 30)
                } else {
                    text.trim_end().to_string()
                }
            }
        }
        _ => "  (git status unavailable)".to_string(),
    }
}

fn git_log_main(cwd: &str) -> String {
    for base in &["origin/main", "main", "origin/master", "master"] {
        let out = std::process::Command::new("git")
            .args(["log", base, "--oneline", "-5", "--no-decorate"])
            .current_dir(cwd)
            .output();
        if let Ok(o) = out {
            if o.status.success() {
                let text = String::from_utf8_lossy(&o.stdout).trim().to_string();
                if !text.is_empty() { return text; }
            }
        }
    }
    "  (no commits on main yet)".to_string()
}

fn other_agents_snapshot(cwd: &str) -> String {
    let parent = match std::path::Path::new(cwd).parent() {
        Some(p) => p,
        None    => return "  (none)".to_string(),
    };
    let my_folder = std::path::Path::new(cwd)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");

    let mut rows: Vec<String> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(parent) {
        for entry in entries.filter_map(|e| e.ok()) {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("stackbox-wt-") || name == my_folder { continue; }

            let wt = entry.path();

            let branch = std::process::Command::new("git")
                .args(["rev-parse", "--abbrev-ref", "HEAD"])
                .current_dir(&wt).output().ok()
                .filter(|o| o.status.success())
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .unwrap_or_else(|| "unknown".to_string());

            let commit = std::process::Command::new("git")
                .args(["log", "-1", "--oneline", "--no-decorate"])
                .current_dir(&wt).output().ok()
                .filter(|o| o.status.success())
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .unwrap_or_else(|| "no commits".to_string());

            let changed = std::process::Command::new("git")
                .args(["status", "--short"])
                .current_dir(&wt).output().ok()
                .filter(|o| o.status.success())
                .map(|o| {
                    let n = String::from_utf8_lossy(&o.stdout)
                        .lines().filter(|l| !l.trim().is_empty()).count();
                    if n == 0 { "clean".to_string() } else { format!("{n} changed") }
                })
                .unwrap_or_else(|| "?".to_string());

            rows.push(format!("  {branch:<32} {changed:<14} last: {commit}"));
        }
    }

    if rows.is_empty() { "  (you are the only active agent)".to_string() }
    else { rows.join("\n") }
}

fn file_tree_snapshot(cwd: &str) -> String {
    let ignore = [
        "node_modules", ".git", "target", "dist", "build",
        ".next", ".cache", "__pycache__", ".venv", "venv",
        ".stackbox", ".claude", ".codex",
        ".stackbox-context.md", "CLAUDE.md", "AGENTS.md", "GEMINI.md",
    ];

    let mut top: Vec<String> = std::fs::read_dir(cwd)
        .map(|rd| rd.filter_map(|e| e.ok())
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                if ignore.contains(&name.as_str()) { return None; }
                if name.starts_with('.') && name != ".env" && name != ".github" { return None; }
                let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
                if is_dir {
                    let n = std::fs::read_dir(e.path()).map(|r| r.count()).unwrap_or(0);
                    Some(format!("{name}/  ({n} items)"))
                } else {
                    Some(name)
                }
            })
            .collect())
        .unwrap_or_default();

    top.sort();
    if top.is_empty() { return "  (empty worktree)".to_string(); }

    let capped = if top.len() > 40 {
        let mut v = top[..40].to_vec();
        v.push(format!("… ({} more)", top.len() - 40));
        v
    } else { top };

    capped.iter().map(|s| format!("  {s}")).collect::<Vec<_>>().join("\n")
}

fn open_prs_snapshot(cwd: &str) -> String {
    let gh_ok = std::process::Command::new("gh")
        .arg("--version").output()
        .map(|o| o.status.success()).unwrap_or(false);

    if !gh_ok { return "  (gh CLI not installed)".to_string(); }

    let out = std::process::Command::new("gh")
        .args(["pr", "list", "--state", "open",
               "--json", "number,title,headRefName,author",
               "--template",
               "{{range .}}  #{{.number}} [{{.headRefName}}] {{.title}} — {{.author.login}}\n{{end}}"])
        .current_dir(cwd).output();

    match out {
        Ok(o) if o.status.success() => {
            let text = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if text.is_empty() { return "  (no open PRs)".to_string(); }
            let lines: Vec<&str> = text.lines().collect();
            if lines.len() > 10 {
                format!("{}\n  … ({} more)", lines[..10].join("\n"), lines.len() - 10)
            } else { text }
        }
        _ => "  (could not fetch PRs — run `gh auth login` if needed)".to_string(),
    }
}

fn diff_stat_vs_main(cwd: &str, branch: &str) -> String {
    for base in &["origin/main", "main", "origin/master", "master"] {
        let out = std::process::Command::new("git")
            .args(["diff", "--stat", base, branch])
            .current_dir(cwd).output();
        if let Ok(o) = out {
            if o.status.success() {
                let text = String::from_utf8_lossy(&o.stdout).trim().to_string();
                if !text.is_empty() { return text; }
            }
        }
    }
    "  (nothing committed yet on this branch)".to_string()
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent-specific context file builder
// Shared content for all 5 agents — each gets the same snapshot + commands ref
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Lean startup context — ~60 tokens, not ~400.
//
// Design principles:
//   1. LOCKED rules only at startup — max 5 rules, zero noise
//   2. Git status inline — agent needs this to know where it is
//   3. Full snapshot deferred to .stackbox/snapshot.md — cat lazily
//   4. memory_context(task=...) called ONCE per NEW task only
//   5. Playbooks referenced by path, never inlined
//   6. remember() + session_summary() only at task completion
// ─────────────────────────────────────────────────────────────────────────────

fn build_agent_context(
    agent_name:      &str,
    short_sid:       &str,
    runbox_id:       &str,
    pane_port:       u16,
    cwd:             &str,
    branch:          &str,
    branch_file:     &str,
    locked_block:    &str,
    status_snapshot: &str,
) -> String {
    let locked_section = if locked_block.trim().is_empty() {
        String::new()
    } else {
        format!("{}\n\n---\n\n", locked_block.trim())
    };

    format!(
r#"# Stackbox — {agent_name}
> session `{short_sid}` · runbox `{runbox_id}` · port `{pane_port}` · branch `{branch}`

{locked_section}## Working Tree
```
{status_snapshot}
```

Full workspace snapshot (diff, file tree, open PRs, other agents):
`cat .stackbox/snapshot.md`

---

## Starting a task
1. **NEW task** → `memory_context(task="<what you are doing")` — loads relevant context
2. **Continuing** previous task → skip memory_context, just work
3. **Coding >2 files** → `cat .stackbox/commands/plan.md` first
4. **Before PR** → `cat .stackbox/commands/ci-check.md` then `cat .stackbox/commands/pr.md`

## Finishing a task
```
session_summary(text="What you did. Port {pane_port}. Branch {branch}. Next steps.")
remember(content="key=value", level="PREFERRED")   ← 1-2 key facts only
```
Also update `.stackbox/roadmap.md` to mark completed milestones.

## Logging (append as you work — also mirror to .stackbox/log/{branch_file}.md)
```
session_log(entry="[step] what you did")
session_log(entry="[done] result — port {pane_port}")
session_log(entry="[blocked] reason")
```

---

## Rules
- Stay inside `{cwd}` — never `cd` above it
- Branch is `{branch}` — never push to `main` directly
- Port is `{pane_port}` — not 3000
- No temp files (`fix.py`, `payload.json`, etc.)
- Commit before session ends — uncommitted work deleted on cleanup
- LOCKED rules above are absolute — stop and report if they conflict with task

*Stackbox · session `{short_sid}` · do not edit this file*
"#,
        locked_section  = locked_section,
        agent_name      = agent_name,
        short_sid       = short_sid,
        runbox_id       = runbox_id,
        pane_port       = pane_port,
        cwd             = cwd,
        branch          = branch,
        branch_file     = branch_file,
        status_snapshot = status_snapshot,
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// snapshot.md — verbose data written at session start, read on demand.
// Agent calls `cat .stackbox/snapshot.md` only when it needs orientation.
// Keeps startup context small while preserving full workspace intelligence.
// ─────────────────────────────────────────────────────────────────────────────

fn write_snapshot_file(
    cwd:         &str,
    branch:      &str,
    branch_file: &str,
    pane_port:   u16,
) {
    let path = std::path::Path::new(cwd)
        .join(".stackbox")
        .join("snapshot.md");

    let diff_vs_main = diff_stat_vs_main(cwd, branch);
    let log_main     = git_log_main(cwd);
    let other_agents = other_agents_snapshot(cwd);
    let open_prs     = open_prs_snapshot(cwd);
    let file_tree    = file_tree_snapshot(cwd);

    let content = format!(
r#"# Workspace Snapshot
*Written at session start. Use git commands for live state.*

## Your Changes vs main
```
{diff_vs_main}
```

## Recent Commits on main
```
{log_main}
```

## Other Active Agents
```
{other_agents}
```

## Open Pull Requests
```
{open_prs}
```

## Project File Tree
```
{file_tree}
```

---

## Persistent Files
| File | Purpose |
|------|---------|
| `.stackbox/roadmap.md` | Project goals + milestones — update as you work |
| `.stackbox/log/{branch_file}.md` | Execution trace — append, never delete |
| `.stackbox/meta/{branch_file}.yaml` | Stack, env keys, port `{pane_port}` — add notes |
| `.stackbox/plans/` | Plans before non-trivial coding |

## Playbooks
| Situation | Command |
|-----------|---------|
| Before any PR | `cat .stackbox/commands/ci-check.md` |
| Before coding >2 files | `cat .stackbox/commands/plan.md` |
| Open a PR | `cat .stackbox/commands/pr.md` |
| Clean up code | `cat .stackbox/commands/clean-code.md` |
| Sync with teammates | `cat .stackbox/commands/sync.md` |

## Quick Commands
```sh
cat .stackbox/roadmap.md
cat .stackbox/log/{branch_file}.md
grep "error" .stackbox/log/{branch_file}.md
cat .stackbox/meta/{branch_file}.yaml
ls .stackbox/plans/
git fetch origin && git diff HEAD..origin/main --stat
```
"#,
        diff_vs_main = diff_vs_main,
        log_main     = log_main,
        other_agents = other_agents,
        open_prs     = open_prs,
        file_tree    = file_tree,
        branch_file  = branch_file,
        pane_port    = pane_port,
    );

    let _ = std::fs::write(&path, content);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main build — pure content builder, returns String, zero agent-file I/O.
// All agent-file writes are owned by agent/context.rs inject().
// ─────────────────────────────────────────────────────────────────────────────

pub async fn build(
    _db:        &crate::db::Db,
    runbox_id:  &str,
    session_id: &str,
    cwd:        &str,
    agent:      &AgentKind,
) -> Result<String, String> {
    let short_sid  = &session_id[..session_id.len().min(8)];
    let agent_name = agent.display_name();
    let branch     = branch_from_worktree(cwd);

    let pane_port: u16 = {
        let mut hash: u32 = 0x811c9dc5;
        for b in runbox_id.as_bytes() {
            hash ^= *b as u32;
            hash = hash.wrapping_mul(0x01000193);
        }
        3100u16 + (hash % 900) as u16
    };

    let agent_type = crate::memory::agent_type_from_name(agent.display_name());
    let _agent_id  = crate::memory::make_agent_id(&agent_type, session_id);

    // Startup: LOCKED rules only — ~30 tokens.
    // Full memory (SESSION, PREFERRED, TEMPORARY) loaded on-demand via
    // memory_context(task="...") when the agent starts an actual task.
    let locked_block = if *agent != AgentKind::Shell {
        crate::agent::injector::build_locked_only(runbox_id).await
    } else {
        String::new()
    };

    // ── Write .stackbox/ directory (roadmap, log, meta, plans, commands) ──────
    if *agent != AgentKind::Shell {
        write_stackbox_dir(cwd, &branch, pane_port);
        // Write verbose snapshot to .stackbox/snapshot.md — agent pulls lazily
        let branch_file = branch.replace('/', "_");
        write_snapshot_file(cwd, &branch, &branch_file, pane_port);
    }

    // ── Inline: git status only — everything else is in snapshot.md ──────────
    let status_snapshot = git_status_snapshot(cwd);
    let branch_file     = branch.replace('/', "_");

    // ── Build lean startup context ────────────────────────────────────────────
    let content = build_agent_context(
        agent_name,
        short_sid,
        runbox_id,
        pane_port,
        cwd,
        &branch,
        &branch_file,
        &locked_block,
        &status_snapshot,
    );

    Ok(content)
}