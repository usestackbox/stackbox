// src-tauri/src/workspace/context.rs
// Supercontext V3 — 4 tools: memory_context / remember / session_log / session_summary

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

pub async fn build(
    _db:        &crate::db::Db,
    runbox_id:  &str,
    session_id: &str,
    cwd:        &str,
    agent:      &AgentKind,
) -> Result<String, String> {
    let short_sid  = &session_id[..session_id.len().min(8)];
    let agent_name = agent.display_name();

    let pane_port: u16 = {
        let mut hash: u32 = 0x811c9dc5;
        for b in runbox_id.as_bytes() {
            hash ^= *b as u32;
            hash = hash.wrapping_mul(0x01000193);
        }
        3100u16 + (hash % 900) as u16
    };

    let agent_type = crate::memory::agent_type_from_name(agent.display_name());
    let agent_id   = crate::memory::make_agent_id(&agent_type, session_id);

    let memory_block = if *agent != AgentKind::Shell {
        let block = crate::agent::injector::build_context_v3(runbox_id, "", &agent_id).await;
        if block.trim().is_empty() {
            String::new()
        } else {
            format!("## Memory\n\n{block}\n")
        }
    } else {
        String::new()
    };

    Ok(format!(
r#"# Stackbox — {agent_name}
> session `{short_sid}` · runbox `{runbox_id}` · port `{pane_port}`

{memory_block}
---

## You have a memory system. Use it.

Every session you start, you are blank. You do not remember the last session.
You do not know what port the app runs on. You do not know what broke last time.
You do not know what your teammate already fixed.

All of that exists. You just have to read it first.

---

## Step 1 — Read before you touch anything

The very first thing you do, before reading files, before running commands, before
writing a single line of code:

```
memory_context(task="describe what you are about to do")
```

This returns:
- LOCKED rules — hard constraints you must never violate
- Recent session summaries — what other agents did before you arrived
- Preferred facts — env facts, port numbers, what tools work, what does not
- Your temporary notes — anything you wrote in a previous step this session

If you skip this, you will repeat work that is already done. You will hit errors
that are already solved. You will use the wrong port. Do not skip it.

---

## Step 2 — Obey LOCKED

LOCKED rules appear at the top of every memory_context response. They are set by
the user. They are hard constraints. They do not bend for any reason.

If a LOCKED rule says "UI is black/white only", every colour you write must be
black or white. If it says "never touch login-app/app.js", you do not open that
file. If it says "no new npm dependencies", you do not add any.

There are no exceptions. There is no "just this once". If completing the task
would require violating a LOCKED rule, you stop and tell the user.

---

## Step 3 — Log as you work

After each meaningful step, one line:

```
session_log(entry="[step] read styles.css — found 12 colour vars in :root")
session_log(entry="[step] changed --primary from #3b82f6 to #000")
session_log(entry="[error] port 3000 occupied — switching to {pane_port}")
session_log(entry="[done] all variables converted, verified at localhost:{pane_port}")
```

Prefixes:
  [step]    during work, after each meaningful action
  [done]    when something completes successfully
  [error]   when something fails
  [blocked] when you are stuck and cannot proceed

Keep it short. One line. No essays. This is for other agents and for you — if
something goes wrong mid-task, the log tells the next agent exactly where things
stood.

---

## Step 4 — Write facts when you learn them

When you discover something permanent, write it immediately. Do not wait.

```
remember(content="port={pane_port}", level="PREFERRED")
remember(content="python not available on this machine — use node/npm", level="PREFERRED")
remember(content="node=v18 working", level="PREFERRED")
remember(content="api base url=https://api.example.com/v2", level="PREFERRED")
```

Rules for PREFERRED facts:
- One fact per call. Not a paragraph, not a list — one fact.
- Use key=value for anything that can be expressed that way. "port={pane_port}" not
  "the app runs on port {pane_port}". "node=v18" not "node version 18 is installed".
- Writing a fact with the same key as an existing fact replaces it. "port={pane_port}"
  automatically resolves the old "port=3000". No duplicates.
- If you are unsure whether something is permanent, write it anyway. Stale facts
  decay. Undiscovered facts are just lost work.

For working notes that only matter this session:

```
remember(content="halfway through converting button colours in components/ui/", level="TEMPORARY")
remember(content="styles.css done, moving to components next", level="TEMPORARY")
```

TEMPORARY facts are private to you and vanish when the session ends. Use them
freely to track where you are mid-task.

---

## Step 5 — Summarise when you finish

When your task is complete, before you stop, write one paragraph:

```
session_summary(text="Converted styles.css and all components under components/ui/
to black/white palette. Changed 34 colour variables. Node v18, port {pane_port}.
Did not touch login-app/app.js per LOCKED rule.
Next: test mobile viewport at 375px, check button contrast ratios pass WCAG AA.")
```

Cover: what you changed · what you used (port, node version, key commands) ·
what you deliberately did not touch · what still needs doing.

The next agent starts their session and sees your summary first. Make it the brief
you would want to read if you were coming in cold.

If you crash or are killed mid-task, the system writes a fallback summary from
your session log. This is worse than what you would write. Write your own.

---

## Your port is {pane_port}

Every runbox gets a stable port. Yours is {pane_port}.

Use `$env:PORT` in commands or hardcode {pane_port} directly. Do not use 3000.
Do not guess. This port is stable across sessions for this runbox.

---

## Rules

- memory_context before any task. Every time. No exceptions.
- One fact per remember call. Key=value format where possible.
- LOCKED rules are absolute. Stop and tell the user if they block the task.
- session_log after each step. Prefix with [step] [done] [error] [blocked].
- session_summary when done. One paragraph. Assume the next agent reads nothing else.
- Never create temporary files like payload.json, fix.py, rewrite_app.js.
- Port is {pane_port}. Not 3000.

---

*Managed by Stackbox · session `{short_sid}` · Do not edit this file*
"#,
        agent_name   = agent_name,
        short_sid    = short_sid,
        runbox_id    = runbox_id,
        pane_port    = pane_port,
        memory_block = memory_block,
    ))
}