#!/usr/bin/env bash
# scripts/check-env.sh — Validate all required env vars from .env.schema
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}✓${RESET} $*"; }
warn() { echo -e "${YELLOW}⚠${RESET} $*"; }
fail() { echo -e "${RED}✗${RESET} $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
SCHEMA="$ROOT_DIR/.env.schema"

if [[ ! -f "$SCHEMA" ]]; then
  warn ".env.schema not found — skipping env check"
  exit 0
fi

# Load .env if present
if [[ -f "$ROOT_DIR/.env" ]]; then
  # shellcheck disable=SC1091
  set -a; source "$ROOT_DIR/.env"; set +a
fi

MISSING=0
WARNED=0

while IFS= read -r line; do
  # Skip comments and blank lines
  [[ "$line" =~ ^# ]] && continue
  [[ -z "$line" ]]    && continue

  # Extract VAR_NAME — support  VAR=value  or  VAR=  or just  VAR
  VAR_NAME="${line%%=*}"
  VAR_NAME="${VAR_NAME//[[:space:]]/}"
  [[ -z "$VAR_NAME" ]] && continue

  # Check if marked optional (comment on same line contains "optional")
  if echo "$line" | grep -qi "optional"; then
    if [[ -z "${!VAR_NAME:-}" ]]; then
      warn "$VAR_NAME (optional, not set)"
      (( WARNED++ )) || true
    else
      ok "$VAR_NAME"
    fi
  else
    if [[ -z "${!VAR_NAME:-}" ]]; then
      fail "$VAR_NAME (REQUIRED, missing!)"
      (( MISSING++ )) || true
    else
      ok "$VAR_NAME"
    fi
  fi
done < "$SCHEMA"

echo ""
if (( MISSING > 0 )); then
  echo -e "${RED}$MISSING required variable(s) missing.${RESET}"
  echo "Copy .env.example to .env and fill in the missing values."
  exit 1
elif (( WARNED > 0 )); then
  echo -e "${YELLOW}$WARNED optional variable(s) not set — some features may be disabled.${RESET}"
  exit 0
else
  echo -e "${GREEN}All env vars present.${RESET}"
  exit 0
fi
