#!/usr/bin/env bash
# scripts/verify-signature.sh
# Verify a Tauri release artifact's .sig file against the public key.
# Usage: ./scripts/verify-signature.sh <artifact> <artifact.sig> [pubkey-file]
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}✓${RESET} $*"; }
info() { echo -e "${CYAN}→${RESET} $*"; }
fail() { echo -e "${RED}✗${RESET} $*" >&2; exit 1; }

ARTIFACT="${1:-}"
SIG_FILE="${2:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
PUBKEY_FILE="${3:-$ROOT_DIR/.keys/stackbox.pub}"

if [[ -z "$ARTIFACT" || -z "$SIG_FILE" ]]; then
  echo "Usage: $0 <artifact> <artifact.sig> [pubkey-file]"
  echo ""
  echo "Example:"
  echo "  $0 stackbox_0.2.0_amd64.AppImage stackbox_0.2.0_amd64.AppImage.sig"
  exit 1
fi

[[ -f "$ARTIFACT"   ]] || fail "Artifact not found: $ARTIFACT"
[[ -f "$SIG_FILE"   ]] || fail "Signature file not found: $SIG_FILE"
[[ -f "$PUBKEY_FILE"]] || fail "Public key not found: $PUBKEY_FILE — pass it as the third argument or place at .keys/stackbox.pub"

# Check for minisign
if ! command -v minisign &>/dev/null; then
  info "minisign not found — trying via cargo..."
  if command -v cargo &>/dev/null; then
    cargo install minisign --quiet
  else
    fail "minisign not installed. Install via:\n  brew install minisign\n  or: https://jedisct1.github.io/minisign/"
  fi
fi

info "Verifying $ARTIFACT"
info "Signature: $SIG_FILE"
info "Public key: $PUBKEY_FILE"
echo ""

if minisign -V -p "$PUBKEY_FILE" -m "$ARTIFACT" -x "$SIG_FILE"; then
  echo ""
  ok "Signature VALID — artifact is authentic and untampered."
else
  echo ""
  fail "Signature INVALID — do NOT use this artifact."
fi
