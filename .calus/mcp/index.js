#!/usr/bin/env node
/**
 * Calus MCP Server — stdio bridge to kernel HTTP backend
 *
 * Agents connect here via stdio (Claude Code, Codex, Cursor, Gemini, Copilot).
 * Proxies to kernel HTTP at http://127.0.0.1:<CALUS_PORT>/mcp.
 * Falls back to direct git/fs ops if kernel is unreachable.
 *
 * ── Kernel tools (proxied to Rust backend) ──
 *   git_ensure          — create worktree + branch, records in DB
 *   git_worktree_get    — check existing worktree from DB
 *   git_commit          — git add -A + commit in worktree
 *   git_worktree_delete — remove worktree dir (branch kept)
 *   set_agent_status    — update DB status (working/done/merged/cancelled)
 *
 * ── Local tools (STATE.md / LOG.md / skills) ──
 *   calus_state_update   — update STATE.md doing/next/blocked/done
 *   calus_log_append     — append one line to LOG.md
 *   calus_session_summary — write structured end-of-session summary
 *   calus_detect_skills  — match message to skill names
 *   calus_read_skill     — read skill file content
 *   calus_list_skills    — list all skills + triggers
 *
 * ── Env vars injected by kernel at PTY spawn ──
 *   CALUS_PORT       kernel HTTP port (default 7547)
 *   CALUS_RUNBOX_ID  workspace identifier
 *   CALUS_SESSION_ID unique agent session identifier
 *   CALUS_CWD        absolute path to workspace root
 *   CALUS_AGENT_KIND claude | codex | cursor | gemini | copilot
 *   CALUS_TOKEN      Bearer token for kernel auth
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { env } from "process";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Env ──────────────────────────────────────────────────────────────────────

const PORT       = process.env.CALUS_PORT       || "7547";
const RUNBOX_ID  = process.env.CALUS_RUNBOX_ID  || "";
const SESSION_ID = process.env.CALUS_SESSION_ID || RUNBOX_ID;
const CWD        = process.env.CALUS_CWD        || process.cwd();
const AGENT_KIND = process.env.CALUS_AGENT_KIND || "claude";
const TOKEN      = process.env.CALUS_TOKEN      || "";

const KERNEL_URL = `http://127.0.0.1:${PORT}/mcp`;
const SKILLS_DIR = join(__dirname, "../skills");

// ─── Path helpers — mirrors persistent.rs exactly ────────────────────────────

/**
 * FNV-1a 32-bit hash.
 * Matches Rust: cwd.bytes().fold(2166136261u32, |a,b| a.wrapping_mul(16777619) ^ b)
 */
function fnv32(str) {
  let h = 2166136261;
  for (const b of Buffer.from(str, "utf8")) {
    h = (Math.imul(h, 16777619) ^ b) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * AppData\Local\calus\<hash>\.worktrees\ — matches worktrees_base() in persistent.rs
 * Windows: %LOCALAPPDATA%\calus\<hash>\.worktrees
 * macOS/Linux: ~/.local/share/calus/<hash>/.worktrees  (XDG data home)
 */
function appDataLocal() {
  if (env.LOCALAPPDATA) return env.LOCALAPPDATA;          // Windows
  if (env.XDG_DATA_HOME) return env.XDG_DATA_HOME;       // Linux XDG
  return join(homedir(), ".local", "share");              // Linux fallback
}

function worktreesBase(cwd) {
  return join(appDataLocal(), "calus", fnv32(cwd), ".worktrees");
}

/** STATE.md path inside a worktree — matches state_path() */
function statePath(wtPath) {
  return join(wtPath, "STATE.md");
}

/** LOG.md path inside a worktree — matches log_path() */
function logPath(wtPath) {
  return join(wtPath, "LOG.md");
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

// ─── STATE.md / LOG.md helpers ────────────────────────────────────────────────

/**
 * Write initial STATE.md.
 * Matches register_agent() in persistent.rs exactly.
 *
 * # state
 * agent: {agent_kind}
 * branch: {branch}
 * worktree: {wt_path}
 * status: in-progress
 * updated: {iso}
 *
 * ## doing
 * -
 * ...
 */
function initStateFile(wtPath, agentKind, branch) {
  const sp = statePath(wtPath);
  if (existsSync(sp)) return; // kernel already created it
  const now = nowIso();
  writeFileSync(sp, [
    "# state",
    `agent: ${agentKind}`,
    `branch: ${branch}`,
    `worktree: ${wtPath}`,
    `status: in-progress`,
    `updated: ${now}`,
    "",
    "## doing",
    "- ",
    "",
    "## next",
    "- ",
    "",
    "## blocked",
    "- ",
    "",
    "## done",
    "- ",
    "",
    "## notes",
    "Free-form observations go here only — not above.",
    "",
  ].join("\n"));
}

function initLogFile(wtPath) {
  const lp = logPath(wtPath);
  if (!existsSync(lp)) writeFileSync(lp, "");
}

/**
 * Update STATE.md.
 * - Updates header key:value lines (status, updated)
 * - Replaces content under section headers (## doing, ## next, ## blocked, ## done)
 */
function updateState(wtPath, updates = {}) {
  const sp = statePath(wtPath);
  if (!existsSync(sp)) return;

  let lines = readFileSync(sp, "utf8").split("\n");
  const now = nowIso();

  // Update header fields
  lines = lines.map((line) => {
    if (updates.status !== undefined && line.startsWith("status:")) return `status: ${updates.status}`;
    if (line.startsWith("updated:")) return `updated: ${now}`;
    return line;
  });

  // Update section bullet lists
  for (const key of ["doing", "next", "blocked", "done"]) {
    if (updates[key] === undefined) continue;
    const hi = lines.findIndex((l) => l === `## ${key}`);
    if (hi === -1) continue;
    // Find end of section (next ## or EOF)
    let end = hi + 1;
    while (end < lines.length && !lines[end].startsWith("## ")) end++;
    const bullets = Array.isArray(updates[key])
      ? updates[key].map((b) => `- ${b}`)
      : [`- ${updates[key]}`];
    lines.splice(hi + 1, end - (hi + 1), "", ...bullets, "");
  }

  writeFileSync(sp, lines.join("\n"));
}

/**
 * Append one line to LOG.md.
 * Format: `- [timestamp] action — reason`
 * Matches: LOG FORMAT rule in persistent.rs build_skill()
 */
function appendLog(wtPath, action, reason = "") {
  const lp = logPath(wtPath);
  const now = nowIso();
  const detail = reason ? ` — ${reason}` : "";
  const line = `- [${now}] ${action}${detail}\n`;
  const existing = existsSync(lp) ? readFileSync(lp, "utf8") : "";
  writeFileSync(lp, line + existing);
}

// ─── Kernel HTTP bridge ───────────────────────────────────────────────────────

let _rpcId = 1;

async function kernelCall(toolName, toolArgs) {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: _rpcId++,
    method: "tools/call",
    params: { name: toolName, arguments: toolArgs },
  });

  const headers = {
    "Content-Type": "application/json",
    "Content-Length": String(Buffer.byteLength(body)),
  };
  if (TOKEN) headers["Authorization"] = `Bearer ${TOKEN}`;

  const res = await fetch(KERNEL_URL, { method: "POST", headers, body });
  if (!res.ok) throw new Error(`kernel HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message ?? JSON.stringify(json.error));

  // Kernel wraps results in content[0].text (MCP format)
  const text = json.result?.content?.[0]?.text ?? JSON.stringify(json.result);
  try { return JSON.parse(text); } catch { return { result: text }; }
}

// ─── Fallback local implementations ──────────────────────────────────────────

function localGitEnsure(cwd, agentKind, name) {
  const wtBase = worktreesBase(cwd);
  const wtPath = join(wtBase, `${agentKind}-${name}`);
  const branch = `calus/${agentKind}/${name}`;
  const isNew = !existsSync(wtPath);

  mkdirSync(wtBase, { recursive: true });

  if (isNew) {
    try {
      execSync(`git worktree add -b "${branch}" "${wtPath}" HEAD`, { cwd, stdio: "pipe" });
    } catch {
      execSync(`git worktree add "${wtPath}" "${branch}"`, { cwd, stdio: "pipe" });
    }
  }

  return { worktree_path: wtPath, branch, is_new: isNew };
}

function localWorktreeGet(cwd, agentKind) {
  const base = worktreesBase(cwd);
  if (!existsSync(base)) return { worktree_path: null, branch: null, status: null };
  const dirs = readdirSync(base).filter((d) => d.startsWith(`${agentKind}-`));
  if (!dirs.length) return { worktree_path: null, branch: null, status: null };
  const latest = dirs
    .map((d) => ({ d, mtime: statSync(join(base, d)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0].d;
  const wtPath = join(base, latest);
  const name = latest.slice(agentKind.length + 1);
  return { worktree_path: wtPath, branch: `calus/${agentKind}/${name}`, status: "working" };
}

function localCommit(wtPath, message) {
  try {
    execSync("git add -A", { cwd: wtPath, stdio: "pipe" });
    const out = execSync(`git commit -m ${JSON.stringify(message)}`, {
      cwd: wtPath, encoding: "utf8", stdio: "pipe",
    });
    return { result: out.trim() };
  } catch (e) {
    const msg = e.stderr?.toString() ?? e.message;
    if (msg.includes("nothing to commit")) return { result: "nothing to commit" };
    throw new Error(msg.trim());
  }
}

function localWorktreeDelete(wtPath) {
  const repoRoot = wtPath.split("/.worktrees/")[0] || CWD;
  try { execSync(`git worktree remove --force "${wtPath}"`, { cwd: repoRoot, stdio: "pipe" }); } catch {}
  try { execSync("git worktree prune", { cwd: repoRoot, stdio: "pipe" }); } catch {}
  return { deleted: true };
}

// ─── Skill registry ───────────────────────────────────────────────────────────

const SKILL_TRIGGERS = {
  "git/worktree":                  ["new task", "start working", "create worktree", "isolate", "spin up", "begin work", "start task", "fresh branch", "new branch"],
  "git/commit":                    ["commit", "save progress", "checkpoint", "push changes", "stage files", "push", "save work"],
  "git/branch-strategy":           ["branch", "branching", "merge strategy", "branch from", "what branch", "base branch", "which branch"],
  "git/session-summary":           ["end session", "stopping", "wrap up", "session done", "pausing", "done for today", "calling it", "finish up"],
  "github/create-pr":              ["open PR", "create PR", "pull request", "submit for review", "make a PR", "push and PR"],
  "github/code-review":            ["review this", "review the PR", "review the diff", "code review", "check the changes", "look at this PR"],
  "github/respond-to-pr-comments": ["respond to PR", "address review", "PR has comments", "reviewer feedback", "fix review notes"],
  "planning/create-plan":          ["create a plan", "plan this out", "before we start", "execplan", "plan the work", "scope this"],
  "planning/task-breakdown":       ["break this down", "how do we approach", "this is big", "chunk this", "subtasks", "sequencing"],
};

// ─── Tool registry ────────────────────────────────────────────────────────────

const TOOLS = {

  // ════════════════════════════════════════════════════════════════════════════
  // KERNEL PROXY TOOLS
  // ════════════════════════════════════════════════════════════════════════════

  git_worktree_get: {
    description:
      "Check if your worktree already exists. " +
      "Call this FIRST at every session start before git_ensure. " +
      "If worktree_path is returned → resume it, read STATE.md, do NOT call git_ensure.",
    inputSchema: {
      type: "object",
      properties: {
        runbox_id: { type: "string", description: "From CALUS_RUNBOX_ID env var" },
      },
      required: [],
    },
    async handler(args) {
      const runbox_id = args.runbox_id || RUNBOX_ID;
      try {
        return await kernelCall("git_worktree_get", { runbox_id });
      } catch {
        return localWorktreeGet(CWD, AGENT_KIND);
      }
    },
  },

  git_ensure: {
    description:
      "Create your git worktree and branch. " +
      "Only call AFTER git_worktree_get returns no existing worktree. " +
      "Writes STATE.md + LOG.md in the worktree. Records branch in kernel DB.",
    inputSchema: {
      type: "object",
      properties: {
        name:        { type: "string", description: "Kebab-case slug. e.g. fix-null-crash, feat-oauth. No spaces, max 5 words." },
        runbox_id:   { type: "string", description: "From CALUS_RUNBOX_ID env var" },
        session_id:  { type: "string", description: "From CALUS_SESSION_ID env var" },
        agent_kind:  { type: "string", enum: ["claude", "codex", "cursor", "gemini", "copilot"] },
        cwd:         { type: "string", description: "Workspace root from CALUS_CWD env var" },
      },
      required: ["name"],
    },
    async handler(args) {
      const runbox_id  = args.runbox_id  || RUNBOX_ID;
      const session_id = args.session_id || SESSION_ID;
      const agent_kind = args.agent_kind || AGENT_KIND;
      const cwd        = args.cwd        || CWD;
      const { name }   = args;

      let result;
      try {
        result = await kernelCall("git_ensure", { runbox_id, session_id, agent_kind, cwd, name });
      } catch {
        result = localGitEnsure(cwd, agent_kind, name);
      }

      // Ensure STATE.md + LOG.md exist — kernel should have created them; this is the safety net
      const wtPath = result?.worktree_path;
      if (wtPath && existsSync(wtPath)) {
        initStateFile(wtPath, agent_kind, result.branch ?? `calus/${agent_kind}/${name}`);
        initLogFile(wtPath);
        if (result.is_new) {
          appendLog(wtPath, `worktree created for ${name}`, `agent=${agent_kind} branch=${result.branch}`);
        } else {
          appendLog(wtPath, `resumed session for ${name}`, `agent=${agent_kind}`);
        }
      }

      return result;
    },
  },

  git_commit: {
    description:
      "Stage ALL changes (git add -A) and commit. " +
      "Call after completing a logical unit of work. " +
      "Automatically appends a log entry to LOG.md.",
    inputSchema: {
      type: "object",
      properties: {
        worktree_path: { type: "string", description: "Absolute path to your worktree" },
        message:       { type: "string", description: "Conventional commit message: type(scope): summary" },
      },
      required: ["worktree_path", "message"],
    },
    async handler(args) {
      const { worktree_path, message } = args;

      let result;
      try {
        result = await kernelCall("git_commit", { worktree_path, message });
      } catch {
        result = localCommit(worktree_path, message);
      }

      if (existsSync(worktree_path)) {
        appendLog(worktree_path, `commit: ${message.split("\n")[0]}`);
      }

      return result;
    },
  },

  git_worktree_delete: {
    description:
      "Remove your worktree directory when task is complete. " +
      "Branch is KEPT so user can review and merge. " +
      "Call set_agent_status with 'done' before this.",
    inputSchema: {
      type: "object",
      properties: {
        worktree_path: { type: "string", description: "Absolute path to your worktree" },
      },
      required: ["worktree_path"],
    },
    async handler(args) {
      const { worktree_path } = args;
      if (existsSync(worktree_path)) {
        appendLog(worktree_path, "worktree removed — branch kept for review");
      }
      try {
        return await kernelCall("git_worktree_delete", { worktree_path });
      } catch {
        return localWorktreeDelete(worktree_path);
      }
    },
  },

  set_agent_status: {
    description:
      "Update task status in kernel DB and STATE.md. " +
      "Call 'done' when finished, 'working' while active, 'cancelled' if abandoning.",
    inputSchema: {
      type: "object",
      properties: {
        runbox_id:     { type: "string", description: "From CALUS_RUNBOX_ID env var" },
        status:        { type: "string", enum: ["working", "done", "merged", "cancelled"] },
        worktree_path: { type: "string", description: "Your worktree path — for STATE.md update" },
      },
      required: ["status"],
    },
    async handler(args) {
      const runbox_id      = args.runbox_id || RUNBOX_ID;
      const { status, worktree_path } = args;

      // Update STATE.md immediately — don't wait for kernel
      if (worktree_path && existsSync(worktree_path)) {
        updateState(worktree_path, { status });
        appendLog(worktree_path, `status → ${status}`);
      }

      try {
        return await kernelCall("set_agent_status", { runbox_id, status });
      } catch {
        return { ok: true, status };
      }
    },
  },

  // ════════════════════════════════════════════════════════════════════════════
  // LOCAL STATE TOOLS
  // ════════════════════════════════════════════════════════════════════════════

  calus_state_update: {
    description:
      "Update STATE.md sections and append a log line. " +
      "Call after every significant action — this is how context survives across sessions. " +
      "Only pass the fields you want to change.",
    inputSchema: {
      type: "object",
      properties: {
        worktree_path: { type: "string", description: "Absolute path to your worktree" },
        status:  { type: "string", description: "in-progress | paused | blocked | done" },
        doing:   { type: "string", description: "What you are doing right now" },
        next:    { type: "string", description: "Next concrete action after current" },
        blocked: { type: "string", description: "What is blocking, or 'none'" },
        done:    { type: "string", description: "What was just completed" },
        log:     { type: "string", description: "One-line log entry to append" },
      },
      required: ["worktree_path"],
    },
    handler(args) {
      const { worktree_path, log: logMsg, ...rest } = args;
      if (!existsSync(worktree_path)) return { error: `worktree not found: ${worktree_path}` };

      const updates = {};
      for (const k of ["status", "doing", "next", "blocked", "done"]) {
        if (rest[k] !== undefined) updates[k] = rest[k];
      }

      updateState(worktree_path, updates);
      if (logMsg) appendLog(worktree_path, logMsg);

      return { ok: true, updated: Object.keys(updates) };
    },
  },

  calus_log_append: {
    description:
      "Append one line to LOG.md. " +
      "Format written: `- [timestamp] action — reason`. " +
      "Call for significant actions that aren't commits.",
    inputSchema: {
      type: "object",
      properties: {
        worktree_path: { type: "string" },
        action:        { type: "string", description: "What was done" },
        reason:        { type: "string", description: "Why (optional context)" },
      },
      required: ["worktree_path", "action"],
    },
    handler(args) {
      const { worktree_path, action, reason } = args;
      if (!existsSync(worktree_path)) return { error: `worktree not found: ${worktree_path}` };
      appendLog(worktree_path, action, reason);
      return { ok: true };
    },
  },

  calus_session_summary: {
    description:
      "Write a structured end-of-session summary to LOG.md and set STATE.md status to 'paused'. " +
      "ALWAYS call this when user says done/stopping/pausing. The next session reads this to resume.",
    inputSchema: {
      type: "object",
      properties: {
        worktree_path: { type: "string", description: "Absolute path to your worktree" },
        goal:    { type: "string", description: "What the task is trying to achieve — 1 sentence" },
        done:    { type: "array", items: { type: "string" }, description: "What was completed this session" },
        blocked: { type: "string", default: "none", description: "Blocker, or 'none'" },
        next:    { type: "string", description: "First concrete action the NEXT session should take" },
      },
      required: ["worktree_path", "goal", "done", "next"],
    },
    handler(args) {
      const { worktree_path, goal, done, blocked = "none", next } = args;
      if (!existsSync(worktree_path)) return { error: `worktree not found: ${worktree_path}` };

      const now = nowIso();
      const block = [
        `--- session ${now} ---`,
        `goal: ${goal}`,
        `done: ${done.join(", ")}`,
        `blocked: ${blocked}`,
        `next: ${next}`,
        "---",
        "",
      ].join("\n");

      const lp = logPath(worktree_path);
      const existing = existsSync(lp) ? readFileSync(lp, "utf8") : "";
      writeFileSync(lp, block + existing);

      updateState(worktree_path, {
        status:  "paused",
        doing:   "session ended",
        next,
        blocked,
        done:    done.join("; "),
      });

      return { ok: true, summary: block.trim() };
    },
  },

  // ════════════════════════════════════════════════════════════════════════════
  // SKILL TOOLS
  // ════════════════════════════════════════════════════════════════════════════

  calus_detect_skills: {
    description:
      "Detect which skills apply to the current user message. " +
      "Call at the START of every session before any work. Then call calus_read_skill for each match.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "The user's raw message or task description" },
      },
      required: ["message"],
    },
    handler({ message }) {
      const lower = message.toLowerCase();
      const matched = Object.entries(SKILL_TRIGGERS)
        .filter(([, triggers]) => triggers.some((t) => lower.includes(t.toLowerCase())))
        .map(([name]) => name);
      return {
        skills: matched,
        message: matched.length
          ? `Load these skills before proceeding: ${matched.join(", ")}`
          : "No specific skills matched — proceed with general judgment",
      };
    },
  },

  calus_read_skill: {
    description:
      "Read the full content of a skill file. " +
      "Call for each skill name returned by calus_detect_skills.",
    inputSchema: {
      type: "object",
      properties: {
        skill: { type: "string", description: 'Skill path, e.g. "git/worktree" or "github/create-pr"' },
      },
      required: ["skill"],
    },
    handler({ skill }) {
      const file = join(SKILLS_DIR, skill + ".md");
      if (!existsSync(file)) {
        return { error: `Skill not found: ${skill}. Use calus_list_skills to see available.` };
      }
      return { skill, content: readFileSync(file, "utf8") };
    },
  },

  calus_list_skills: {
    description: "List all available skills with their trigger keywords.",
    inputSchema: { type: "object", properties: {} },
    handler() {
      return {
        skills: Object.entries(SKILL_TRIGGERS).map(([name, triggers]) => ({ name, triggers })),
      };
    },
  },
};

// ─── MCP stdio protocol ───────────────────────────────────────────────────────

function send(obj) {
  const msg = JSON.stringify(obj);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`);
}

const reply  = (id, result) => send({ jsonrpc: "2.0", id, result });
const replyE = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  while (true) {
    const hEnd = buf.indexOf("\r\n\r\n");
    if (hEnd === -1) break;
    const m = buf.slice(0, hEnd).match(/Content-Length:\s*(\d+)/i);
    if (!m) { buf = buf.slice(hEnd + 4); continue; }
    const len = parseInt(m[1]);
    if (buf.length < hEnd + 4 + len) break;
    const body = buf.slice(hEnd + 4, hEnd + 4 + len);
    buf = buf.slice(hEnd + 4 + len);
    let req;
    try { req = JSON.parse(body); } catch { continue; }
    handle(req).catch((e) => process.stderr.write(`[mcp] unhandled: ${e.message}\n`));
  }
});

async function handle(req) {
  const { id, method, params } = req;

  if (method === "initialize") {
    return reply(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "calus-mcp", version: "3.0.0" },
    });
  }

  if (method === "notifications/initialized") return;

  if (method === "tools/list") {
    return reply(id, {
      tools: Object.entries(TOOLS).map(([name, t]) => ({
        name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    });
  }

  if (method === "tools/call") {
    const { name, arguments: args = {} } = params ?? {};
    const tool = TOOLS[name];
    if (!tool) return replyE(id, -32601, `Unknown tool: ${name}`);
    try {
      const result = await tool.handler(args);
      return reply(id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      });
    } catch (e) {
      return reply(id, {
        content: [{ type: "text", text: JSON.stringify({ error: e.message }) }],
        isError: true,
      });
    }
  }

  if (id !== undefined) replyE(id, -32601, `Method not found: ${method}`);
}
