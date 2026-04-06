#!/usr/bin/env bash
# scripts/dev.sh — Pre-flight checks + tauri dev
set -euo pipefail

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; RESET='\033[0m'

fail()  { echo -e "${RED}✗ $*${RESET}" >&2; exit 1; }
warn()  { echo -e "${YELLOW}⚠ $*${RESET}"; }
ok()    { echo -e "${GREEN}✓ $*${RESET}"; }
info()  { echo -e "  $*"; }

echo ""
echo "╔══════════════════════════════════╗"
echo "║      Stackbox — dev startup      ║"
echo "╚══════════════════════════════════╝"
echo ""

# ── Rust ────────────────────────────────────────────────────────────────────
REQUIRED_RUST="1.77.2"
if ! command -v rustc &>/dev/null; then
  fail "Rust not found. Install via: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
fi
RUST_VER=$(rustc --version | awk '{print $2}')
if [[ "$RUST_VER" != "$REQUIRED_RUST" ]]; then
  warn "Rust version mismatch: got $RUST_VER, expected $REQUIRED_RUST"
  info "Run: rustup install $REQUIRED_RUST && rustup default $REQUIRED_RUST"
  info "Or add a rust-toolchain.toml — toolchain will be selected automatically."
else
  ok "Rust $RUST_VER"
fi

# ── Bun ─────────────────────────────────────────────────────────────────────
if ! command -v bun &>/dev/null; then
  fail "Bun not found. Install via: curl -fsSL https://bun.sh/install | bash"
fi
BUN_VER=$(bun --version)
ok "Bun $BUN_VER"

# ── Tauri CLI ────────────────────────────────────────────────────────────────
if ! command -v cargo-tauri &>/dev/null && ! bun tauri --version &>/dev/null 2>&1; then
  warn "Tauri CLI not found — attempting to install..."
  bun add -D @tauri-apps/cli@^2 || fail "Failed to install Tauri CLI"
fi
ok "Tauri CLI available"

# ── .env check ──────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

if [[ -f "$ROOT_DIR/.env.schema" && ! -f "$ROOT_DIR/.env" ]]; then
  warn ".env file missing — copying from .env.example"
  if [[ -f "$ROOT_DIR/.env.example" ]]; then
    cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
    ok "Created .env from .env.example"
  else
    warn "No .env.example found either. Some features may not work."
  fi
fi

# ── node_modules ─────────────────────────────────────────────────────────────
if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
  info "node_modules missing — running bun install..."
  (cd "$ROOT_DIR" && bun install)
fi

# ── Launch ───────────────────────────────────────────────────────────────────
echo ""
ok "Pre-flight complete — launching tauri dev"
echo ""
cd "$ROOT_DIR"
exec bun tauri dev
