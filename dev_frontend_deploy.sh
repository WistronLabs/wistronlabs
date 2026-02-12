#!/usr/bin/env bash
set -euo pipefail

# Require bash 4+ (assoc arrays)
if [[ -z "${BASH_VERSINFO:-}" || "${BASH_VERSINFO[0]}" -lt 4 ]]; then
  echo "Error: This script requires bash 4+." >&2
  echo "On macOS:" >&2
  echo "  brew install bash" >&2
  echo "  /opt/homebrew/bin/bash ./dev_frontend_deploy.sh TSS_DEV" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF="$SCRIPT_DIR/backend_locations.conf"

FRONTEND_DIR="$SCRIPT_DIR/website_frontend"
ENV_FILE="$FRONTEND_DIR/.env"

die(){ echo "Error: $*" >&2; exit 1; }

[[ -f "$CONF" ]] || die "Missing backend_locations.conf at $CONF"
[[ -d "$FRONTEND_DIR" ]] || die "Missing website_frontend dir at $FRONTEND_DIR"

usage() {
  cat <<EOF
Usage:
  $0 list
  $0 <DEV_BACKEND_NAME>

Examples:
  $0 TSS_DEV
  $0 FRK_DEV

This will:
  - Map DEV backend -> source prod (e.g. TSS_DEV -> TSS)
  - Write website_frontend/.env:
      VITE_BACKEND_URL=https://devbackend.<site>.wistronlabs.com/api/v1
      VITE_URL=<prod frontend url from conf>
      VITE_LOCATION=<site>
  - Run: npm run dev
EOF
  exit 1
}

cmd="${1:-}"
[[ -n "$cmd" ]] || usage

# Load config (supports optional 9th field: source_prod)
declare -A HOST FRONTEND IS_DEV SOURCE_PROD
while IFS='|' read -r name host dir proj port frontend_url is_dev lockfile source_prod; do
  [[ -z "${name// }" ]] && continue
  [[ "$name" =~ ^# ]] && continue

  is_dev="${is_dev//$'\r'/}"; is_dev="${is_dev//[[:space:]]/}"
  source_prod="${source_prod//$'\r'/}"; source_prod="${source_prod//[[:space:]]/}"

  HOST["$name"]="$host"
  FRONTEND["$name"]="$frontend_url"
  IS_DEV["$name"]="$is_dev"
  SOURCE_PROD["$name"]="$source_prod"
done < "$CONF"

print_dev_locations() {
  echo ""
  echo "Available DEV backends (is_dev=1):"
  for k in "${!HOST[@]}"; do
    [[ "${IS_DEV[$k]:-}" == "1" ]] || continue
    local src="${SOURCE_PROD[$k]:-}"
    echo "  - $k   (source_prod=${src:-<none>})"
  done | sort
  echo ""
}

if [[ "$cmd" == "list" ]]; then
  print_dev_locations
  exit 0
fi

DEV_NAME="$cmd"

[[ -n "${HOST[$DEV_NAME]:-}" ]] || die "Unknown backend '$DEV_NAME' (check backend_locations.conf)"
[[ "${IS_DEV[$DEV_NAME]:-}" == "1" ]] || die "Refusing non-dev backend '$DEV_NAME'"

SITE="${SOURCE_PROD[$DEV_NAME]:-}"
[[ -n "$SITE" ]] || die "Config missing source_prod for '$DEV_NAME' (need TSS/FRK/etc)"

PROD_FRONTEND_URL="${FRONTEND[$SITE]:-}"
[[ -n "$PROD_FRONTEND_URL" ]] || die "Could not resolve prod frontend_url for '$SITE' from conf"

# dev backend URL convention you gave
DEV_BACKEND_URL="https://devbackend.$(echo "$SITE" | tr '[:upper:]' '[:lower:]').wistronlabs.com/api/v1"

echo ""
echo "============================================================"
echo "DEV FRONTEND DEPLOY (local)"
echo "  Dev backend target : $DEV_NAME"
echo "  Site (source_prod) : $SITE"
echo "  Write .env in      : $ENV_FILE"
echo "  VITE_BACKEND_URL   : $DEV_BACKEND_URL"
echo "  VITE_URL           : $PROD_FRONTEND_URL"
echo "  VITE_LOCATION      : $SITE"
echo "============================================================"

mkdir -p "$FRONTEND_DIR"

# Update or append a KEY=value in the .env file (preserve other keys)
set_env_kv() {
  local key="$1" val="$2" file="$3"
  if [[ -f "$file" ]] && grep -qE "^${key}=" "$file"; then
    # portable-ish sed: write to temp then move
    local tmp
    tmp="$(mktemp)"
    sed -E "s|^${key}=.*|${key}=${val}|" "$file" > "$tmp"
    mv "$tmp" "$file"
  else
    echo "${key}=${val}" >> "$file"
  fi
}

# Ensure file exists
touch "$ENV_FILE"

set_env_kv "VITE_BACKEND_URL" "$DEV_BACKEND_URL" "$ENV_FILE"
set_env_kv "VITE_URL" "$PROD_FRONTEND_URL" "$ENV_FILE"
set_env_kv "VITE_LOCATION" "$SITE" "$ENV_FILE"

echo ""
echo "Wrote:"
grep -E '^(VITE_BACKEND_URL|VITE_URL|VITE_LOCATION)=' "$ENV_FILE" || true

echo ""
echo "Starting Vite dev server..."
cd "$FRONTEND_DIR"
npm run dev
