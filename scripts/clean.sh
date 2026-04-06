#!/usr/bin/env bash
# scripts/clean.sh — Remove all build/cache artifacts
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}✓${RESET} $*"; }
info() { echo -e "${YELLOW}→${RESET} $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

rm_if_exists() {
  if [[ -e "$1" ]]; then
    rm -rf "$1"
    ok "Removed $1"
  else
    info "Skip $1 (not found)"
  fi
}

echo "Cleaning Stackbox build artifacts..."
echo ""

rm_if_exists "$ROOT_DIR/dist"
rm_if_exists "$ROOT_DIR/kernel/target"
rm_if_exists "$ROOT_DIR/.turbo"
rm_if_exists "$ROOT_DIR/node_modules/.vite"
rm_if_exists "$ROOT_DIR/.bun-cache"

echo ""
ok "Clean complete."
echo "Run 'bun install' then 'bun tauri dev' to rebuild from scratch."
