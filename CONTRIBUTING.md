# Contributing to Stackbox

Thank you for taking the time to contribute! This document covers everything
you need to go from zero to a working dev environment and submit your first PR.

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Rust | 1.77.2 (pinned) | `rustup install 1.77.2` |
| Bun | ≥ 1.1 | `curl -fsSL https://bun.sh/install \| bash` |
| Tauri CLI v2 | latest | `cargo install tauri-cli --version "^2"` |
| Git | any | For the git panel features |

> **macOS**: You also need Xcode Command Line Tools (`xcode-select --install`).  
> **Windows**: Install Visual Studio Build Tools 2022 (C++ workload).  
> **Linux**: Install `libwebkit2gtk-4.1-dev` and `libayatana-appindicator3-dev`.

---

## Getting Started

```bash
# 1. Clone
git clone https://github.com/your-org/stackbox.git
cd stackbox

# 2. Validate your environment
./scripts/check-env.sh

# 3. Install frontend dependencies
bun install

# 4. Copy env vars
cp .env.example .env
# Edit .env with your values (see .env.schema for docs)

# 5. Start the dev server (Tauri + Vite hot-reload)
./scripts/dev.sh
```

The app window opens automatically. The Vite dev server runs on port 1420.

---

## Project Structure

```
stackbox/
├── kernel/          # Rust/Tauri backend (commands, db, git, mcp, pty…)
│   └── src/
├── render/          # React frontend
│   ├── design/      # Design tokens & primitives
│   ├── features/    # Feature slices (files, git, terminal, palette…)
│   ├── hooks/       # Shared React hooks
│   ├── sidebar/     # Workspace sidebar
│   ├── types/       # Shared TypeScript types
│   └── ui/          # Generic UI primitives
├── scripts/         # Dev tooling shell scripts
└── .github/         # CI/CD workflows and templates
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for a deeper dive.

---

## Development Workflow

### Running lints

```bash
# TypeScript typecheck + Biome lint
bun run lint

# Rust clippy
cargo clippy --manifest-path kernel/Cargo.toml -- -D warnings
```

### Running tests

```bash
# Rust unit tests
cargo test --manifest-path kernel/Cargo.toml

# Frontend (add your own vitest tests in render/**/__tests__/)
bun test
```

### Formatting

```bash
# Biome (TS/JS) — also runs on save in VS Code
bun run format

# Rust
cargo fmt --manifest-path kernel/Cargo.toml
```

---

## Making Changes

1. **Create a branch** off `main`:
   ```bash
   git checkout -b feat/my-feature
   ```

2. **Write code** following the existing patterns (see design tokens in
   `render/design/tokens.ts`, use `C.*`, `FS.*`, `SP.*`).

3. **Add a CHANGELOG entry** under `## [Unreleased]`.

4. **Open a PR** against `main`. The PR template will walk you through
   the checklist.

### Commit style

We use conventional commits (loosely):
- `feat:` new user-facing feature
- `fix:` bug fix
- `chore:` tooling, deps, no user impact
- `docs:` documentation only
- `refactor:` no behaviour change

---

## Releasing

Maintainers only:
```bash
./scripts/release.sh <major|minor|patch>
```
This bumps versions atomically, commits, tags, and pushes — triggering the
`release.yml` CI workflow which builds and signs all platform artefacts.

---

## Code of Conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md).
Be kind, be constructive.
