# Stackbox Architecture

This document describes how the major subsystems fit together.

---

## High-Level Overview

```
┌──────────────────────────────────────────────────────┐
│                     OS / Hardware                    │
└─────────────┬────────────────────────┬───────────────┘
              │                        │
   ┌──────────▼──────────┐   ┌────────▼──────────────┐
   │   kernel/ (Rust)    │   │  External services    │
   │   Tauri v2 process  │   │  • Git remote         │
   │                     │   │  • MCP servers        │
   │  ┌───────────────┐  │   │  • GitHub API         │
   │  │  Tauri IPC    │  │   └───────────────────────┘
   │  │  (invoke/emit)│  │
   │  └──────┬────────┘  │
   │         │           │
   │  ┌──────▼────────┐  │
   │  │  axum server  │  │   ← /health + memory HTTP API
   │  │  :7547        │  │
   │  └───────────────┘  │
   └──────────┬──────────┘
              │  WebView IPC
   ┌──────────▼──────────┐
   │   render/ (React)   │
   │   Vite + TypeScript │
   │                     │
   │  ┌─────────────┐    │
   │  │  features/  │    │   ← files, git, terminal, palette…
   │  ├─────────────┤    │
   │  │  hooks/     │    │   ← useKeyboard, useTheme, useOnline…
   │  ├─────────────┤    │
   │  │  design/    │    │   ← tokens (C, FS, SP)
   │  └─────────────┘    │
   └─────────────────────┘
```

---

## Kernel (`kernel/`)

Written in Rust, compiled as a Tauri v2 application.

### Key modules

| Module | Responsibility |
|--------|---------------|
| `commands/` | Tauri `#[command]` handlers — the IPC surface exposed to the frontend |
| `git/` | libgit2 wrapper: status, diff, log, branches, worktrees, webhooks |
| `mcp/` | MCP server lifecycle manager (stdio + SSE) and tool dispatcher |
| `memory/` | Vector memory store with sleep/wake lifecycle and decision engine |
| `pty/` | Pseudo-terminal multiplexer — creates, reads, writes, watches shells |
| `agent/` | Context builder, embedder, scorer, supercontext aggregator |
| `db/` | SQLite via `rusqlite` — sessions, runboxes, branches, layout, events |
| `server/` | axum HTTP server for `/health` and the memory REST API |
| `workspace/` | Workspace context, events, and snapshot persistence |
| `browser/` | Embedded webview management |

### IPC Pattern

Frontend calls `invoke("command_name", { ...args })`.  
The kernel handler returns `Result<T, AppError>` which Tauri serialises to
`{ status: "ok", data: T }` or `{ status: "error", message: string }`.

Events flow the other way via `emit()` from Rust / `listen()` in TypeScript.

---

## Frontend (`render/`)

React 18 + TypeScript, bundled by Vite (with the Tauri Vite plugin).

### Feature Slice Pattern

Each feature lives in `render/features/<name>/` and exports:
- A primary component (e.g. `GitPanel.tsx`)
- A data hook (e.g. `useGitPanel.ts`)  
- An `index.ts` barrel re-export

Features talk to the kernel only through `invoke()` — never via shared module
state (except the notification store).

### Design System

All visual values come from `render/design/tokens.ts`:

```ts
import { C, FS, SP } from "../design/tokens";
// C.bg3, C.t0, C.green, C.border…  colour tokens
// FS.sm, FS.base…                   font sizes (px numbers)
// SP[4], SP[8]…                     spacing (px numbers)
```

Radius values are on `C.r1`–`C.r5`. Shadows: `C.shadowSm`, `C.shadow`,
`C.shadowLg`, `C.shadowXl`.

Nothing is hardcoded in components.

### Command Palette

`render/features/palette/` — `⌘K` fuzzy-search.  
Any feature can register actions at module load time:

```ts
import { registerActions } from "../palette";

registerActions([{
  id: "my-feature.action",
  label: "Do the thing",
  category: "tools",
  handler: () => doThing(),
}]);
```

### Notifications

`render/features/notifications/` — global toast queue backed by a module-level
store (no context provider needed):

```ts
import { pushNotification } from "../notifications";

pushNotification({ level: "success", title: "Committed", message: "3 files changed" });
```

---

## MCP Integration

MCP (Model Context Protocol) servers are configured in
`~/.config/stackbox/config.json`. The kernel spawns them on startup and
maintains a tool registry. The frontend's MCP tab in Settings provides
add/remove UI; changes are persisted and servers are hot-reloaded without
restarting the app.

---

## Memory System

The memory system runs as a background service in the kernel:

1. **Store** — HNSW vector index over semantic chunks extracted from workspace
   events (file saves, terminal output, git commits, agent messages).
2. **Sleep** — Periodically compacts and de-duplicates the index.
3. **Wake** — On workspace focus, pre-fetches the top-K most relevant memories
   and injects them into the agent context window.
4. **Decision** — Scores candidate memories by recency × relevance before
   injection.

---

## Data Flow: File Save → Memory → Agent

```
User saves file
      ↓
kernel/watcher detects change
      ↓
workspace::events::emit(FileChanged)
      ↓
memory::store::ingest(chunk)       ← embedding via local model
      ↓
agent::supercontext::build()       ← top-K retrieval
      ↓
MCP tool call with enriched context
```

---

## Security Model

- Tauri capabilities are scoped in `kernel/capabilities/default.json`.
- The kernel is the only process with filesystem / shell access.
- The frontend cannot escape the WebView sandbox.
- MCP servers run as child processes with no special OS privileges.
- Clipboard access is gated behind a capability permission.

See [SECURITY.md](./SECURITY.md) for the vulnerability disclosure policy.
