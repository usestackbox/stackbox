#!/usr/bin/env bash
# scripts/build-local.sh — Full local production build for all targets
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'
fail() { echo -e "${RED}✗ $*${RESET}" >&2; exit 1; }
ok()   { echo -e "${GREEN}✓ $*${RESET}"; }
warn() { echo -e "${YELLOW}⚠ $*${RESET}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# ── Pre-flight ────────────────────────────────────────────────────────────────
command -v bun    &>/dev/null || fail "bun not found"
command -v rustc  &>/dev/null || fail "rustc not found"
command -v cargo  &>/dev/null || fail "cargo not found"

RUST_VER=$(rustc --version | awk '{print $2}')
ok "Rust $RUST_VER"
ok "Bun $(bun --version)"

# ── Validate env ──────────────────────────────────────────────────────────────
if [[ -f "$ROOT_DIR/scripts/check-env.sh" ]]; then
  "$ROOT_DIR/scripts/check-env.sh" || warn "Some env vars missing — build may succeed but runtime may fail"
fi

# ── Install frontend deps ─────────────────────────────────────────────────────
echo ""
echo "Installing frontend deps..."
(cd "$ROOT_DIR" && bun install)
ok "Dependencies installed"

# ── Build ─────────────────────────────────────────────────────────────────────
echo ""
echo "Building Stackbox (production)..."
echo "This takes a few minutes the first time..."
echo ""

cd "$ROOT_DIR"
bun tauri build

echo ""
ok "Build complete!"
echo ""
echo "Artifacts:"
find kernel/target/release/bundle -type f \( \
  -name "*.dmg" -o \
  -name "*.app.tar.gz" -o \
  -name "*.AppImage" -o \
  -name "*.deb" -o \
  -name "*.msi" -o \
  -name "*.exe" \
\) 2>/dev/null | while read -r f; do
  SIZE=$(du -sh "$f" | cut -f1)
  echo "  $SIZE  $f"
done
