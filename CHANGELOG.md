# Changelog

All notable changes to Stackbox are documented here.  
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)  
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

> The `release.yml` workflow extracts the top-most `## [x.y.z]` block as
> the GitHub Release body automatically — keep each entry under that block.

---

## [Unreleased]

### Added
- Command Palette (`⌘K`) — fuzzy search over workspaces, git actions, settings,
  files, and terminal shortcuts with keyboard navigation
- Notification system — global toast queue with auto-dismiss, history centre,
  and unread badge on the bell icon
- Frontend hooks: `useKeyboard`, `useLocalStorage`, `useDebounce`,
  `useClickOutside`, `useOnline`, `useVersion`, `useTheme`

### Changed
- Theme CSS custom properties are now applied via `useTheme` hook; font size
  and density tokens are injected on `:root` at startup

### Fixed
- _Nothing yet — first pass_

---

## [0.1.0] — 2026-04-05

### Added
- Initial private release
- Tauri v2 kernel with Rust 1.77
- Split-pane terminal (xterm.js + WebGL renderer)
- File tree with live watcher
- Git panel: changes, history, branches, worktrees, GitHub tab
- Memory system with vector store and sleep/wake lifecycle
- MCP server integration (stdio + SSE transports)
- Agent context injection and supercontext builder
- Inline diff viewer with syntax highlighting
- Workspace session persistence via SQLite

[Unreleased]: https://github.com/your-org/stackbox/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/your-org/stackbox/releases/tag/v0.1.0
