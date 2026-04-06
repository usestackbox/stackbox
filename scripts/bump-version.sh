#!/usr/bin/env bash
# scripts/bump-version.sh — Atomically bump version across all manifests
# Usage: ./scripts/bump-version.sh <new-version>
#   e.g. ./scripts/bump-version.sh 0.2.0
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; RESET='\033[0m'
fail() { echo -e "${RED}✗ $*${RESET}" >&2; exit 1; }
ok()   { echo -e "${GREEN}✓ $*${RESET}"; }

NEW_VERSION="${1:-}"
if [[ -z "$NEW_VERSION" ]]; then
  fail "Usage: $0 <new-version>  (e.g. 0.2.0)"
fi

# Validate semver-ish
if ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
  fail "Invalid version format: $NEW_VERSION  (expected semver, e.g. 1.2.3 or 1.2.3-beta.1)"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# ── Guard: must be on main with clean working tree ───────────────────────────
BRANCH=$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD)
if [[ "$BRANCH" != "main" ]]; then
  fail "Must be on main branch (currently on '$BRANCH')"
fi
if ! git -C "$ROOT_DIR" diff --quiet; then
  fail "Working tree has uncommitted changes. Please commit or stash first."
fi

# ── Read current version ─────────────────────────────────────────────────────
CURRENT=$(jq -r '.version' "$ROOT_DIR/kernel/tauri.conf.json")
echo "Bumping: $CURRENT → $NEW_VERSION"

# ── tauri.conf.json ──────────────────────────────────────────────────────────
TMP=$(mktemp)
jq --arg v "$NEW_VERSION" '.version = $v' "$ROOT_DIR/kernel/tauri.conf.json" > "$TMP"
mv "$TMP" "$ROOT_DIR/kernel/tauri.conf.json"
ok "kernel/tauri.conf.json"

# ── kernel/Cargo.toml ────────────────────────────────────────────────────────
sed -i.bak "s/^version *= *\"$CURRENT\"/version = \"$NEW_VERSION\"/" "$ROOT_DIR/kernel/Cargo.toml"
rm -f "$ROOT_DIR/kernel/Cargo.toml.bak"
ok "kernel/Cargo.toml"

# ── package.json (root) ──────────────────────────────────────────────────────
if [[ -f "$ROOT_DIR/package.json" ]]; then
  TMP=$(mktemp)
  jq --arg v "$NEW_VERSION" '.version = $v' "$ROOT_DIR/package.json" > "$TMP"
  mv "$TMP" "$ROOT_DIR/package.json"
  ok "package.json"
fi

# ── Commit + tag ─────────────────────────────────────────────────────────────
git -C "$ROOT_DIR" add \
  kernel/tauri.conf.json \
  kernel/Cargo.toml \
  package.json 2>/dev/null || true

git -C "$ROOT_DIR" commit -m "chore: bump version to $NEW_VERSION"
git -C "$ROOT_DIR" tag "v$NEW_VERSION" -a -m "Release v$NEW_VERSION"

ok "Committed and tagged v$NEW_VERSION"
echo ""
echo "Next steps:"
echo "  Push:     git push origin main && git push origin v$NEW_VERSION"
echo "  Or run:   ./scripts/release.sh $NEW_VERSION"
