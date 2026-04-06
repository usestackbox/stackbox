#!/usr/bin/env bash
# scripts/gen-keypair.sh
# Generate a Tauri v2 minisign keypair for release signing.
# The private key goes into GitHub Secrets; the public key goes into tauri.conf.json.
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}✓${RESET} $*"; }
info() { echo -e "${CYAN}→${RESET} $*"; }
warn() { echo -e "${YELLOW}⚠${RESET} $*"; }
fail() { echo -e "${RED}✗${RESET} $*" >&2; exit 1; }

command -v bun   &>/dev/null || fail "bun not found"

# Confirm the user is intentional — existing keys would be rotated
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   Stackbox — Tauri signing key generator     ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
warn "This generates a NEW signing keypair."
warn "If you already have one, rotating it means old builds will no longer verify."
echo ""
read -rp "Continue? [y/N] " CONFIRM
[[ "$CONFIRM" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
KEY_DIR="$ROOT_DIR/.keys"
mkdir -p "$KEY_DIR"

PRIVATE_KEY_FILE="$KEY_DIR/stackbox.key"
PUBLIC_KEY_FILE="$KEY_DIR/stackbox.pub"

if [[ -f "$PRIVATE_KEY_FILE" ]]; then
  warn "Key files already exist at $KEY_DIR/"
  read -rp "Overwrite? [y/N] " OW
  [[ "$OW" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }
fi

echo ""
info "Generating keypair with Tauri CLI..."
echo ""

# Tauri v2 signer
bun tauri signer generate \
  --private-key-path "$PRIVATE_KEY_FILE" \
  --public-key-path  "$PUBLIC_KEY_FILE"

echo ""
ok "Keypair written to $KEY_DIR/"
echo ""

# Read keys
PUBKEY=$(cat "$PUBLIC_KEY_FILE")
PRIVKEY=$(cat "$PRIVATE_KEY_FILE")
PRIVKEY_B64=$(base64 < "$PRIVATE_KEY_FILE" | tr -d '\n')

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " PUBLIC KEY (→ kernel/tauri.conf.json)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "$PUBKEY"
echo ""
echo "Paste this as the value of  plugins.updater.pubkey  in kernel/tauri.conf.json"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " GITHUB SECRETS TO ADD"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. TAURI_SIGNING_PRIVATE_KEY"
echo "   Value: (contents of $PRIVATE_KEY_FILE)"
echo ""
echo "2. TAURI_SIGNING_PRIVATE_KEY_PASSWORD"
echo "   Value: (the password you entered above, if any)"
echo ""
echo "Add them at: https://github.com/usestackbox/stackbox/settings/secrets/actions"
echo ""

# Warn to never commit the private key
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
warn "NEVER commit $PRIVATE_KEY_FILE to the repository."
warn ".keys/ is in .gitignore — double-check before pushing."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Ensure .keys/ is gitignored
GITIGNORE="$ROOT_DIR/.gitignore"
if ! grep -q "^\.keys/" "$GITIGNORE" 2>/dev/null; then
  echo ".keys/" >> "$GITIGNORE"
  ok "Added .keys/ to .gitignore"
fi
