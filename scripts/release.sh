#!/usr/bin/env bash
# scripts/release.sh — Bump version, push tag, open Actions run in browser
# Usage: ./scripts/release.sh <new-version>
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; RESET='\033[0m'
fail() { echo -e "${RED}✗ $*${RESET}" >&2; exit 1; }
ok()   { echo -e "${GREEN}✓ $*${RESET}"; }
info() { echo -e "${CYAN}→ $*${RESET}"; }

NEW_VERSION="${1:-}"
if [[ -z "$NEW_VERSION" ]]; then
  fail "Usage: $0 <new-version>  (e.g. 0.2.0)"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Step 1: Bump versions and commit+tag
info "Bumping version to $NEW_VERSION..."
"$SCRIPT_DIR/bump-version.sh" "$NEW_VERSION"

# Step 2: Push main + tag
info "Pushing main and tag v$NEW_VERSION..."
git -C "$ROOT_DIR" push origin main
git -C "$ROOT_DIR" push origin "v$NEW_VERSION"
ok "Pushed v$NEW_VERSION"

# Step 3: Open GitHub Actions in browser
REPO_URL=$(git -C "$ROOT_DIR" remote get-url origin \
  | sed 's/git@github.com:/https:\/\/github.com\//' \
  | sed 's/\.git$//')
ACTIONS_URL="$REPO_URL/actions"

info "Opening Actions run: $ACTIONS_URL"
if command -v xdg-open &>/dev/null; then
  xdg-open "$ACTIONS_URL"
elif command -v open &>/dev/null; then
  open "$ACTIONS_URL"
else
  echo "Open manually: $ACTIONS_URL"
fi

echo ""
ok "Release v$NEW_VERSION triggered 🚀"
