#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# prod_deploy.sh (CORRECTED)
#
# Deploys website_frontend (build -> upload) and website_backend (rsync -> build
# -> migrations -> start) to PROD locations defined in backend_locations.conf.
#
# Key behaviors:
# - ONLY allows PROD targets (is_dev=0)
# - Enforces local git main branch + clean tree + in-sync with origin/main
# - Preflight: ssh auth, /var/www/html exists, docker installed, and docker
#   compose runnable by falab (direct or via sudo -n)
# - Frontend:
#     * writes website_frontend/.env to match PROD site (backend.<site>...)
#     * npm ci (if possible) + npm run build
#     * uploads dist/* to /var/www/html
# - Backend:
#     * rsync backend code (preserving remote .env + env/*)
#     * bootstraps missing backend dir by:
#          - seeding runtime config if missing (SMTP_PASS prompted)
#          - bootstrapping DB from another existing PROD site (pg_dump|psql stream)
#          - WARNING: you must manually remove data when you’re done bootstrapping
#     * applies migrations based on db_migrations/*.sql + schema_migrations table
#
# Fixes vs broken “working” paste:
# - FIX: remote_psql_db_tab correctly passes SQL into remote shell (was undefined)
# - FIX: bootstrap_db_from_site properly attaches the DST heredoc to the 2nd ssh
# - FIX: remote_check_backend_bootstrap_prereqs avoids unquoted heredoc expansion
# - FIX: set_env_kv uses safe sed replacement escaping
# =============================================================================

# Require bash 4+ (assoc arrays)
if [[ -z "${BASH_VERSINFO:-}" || "${BASH_VERSINFO[0]}" -lt 4 ]]; then
  echo "Error: This script requires bash 4+." >&2
  echo "" >&2
  echo "On macOS:" >&2
  echo "  brew install bash" >&2
  echo "  /opt/homebrew/bin/bash ./prod_deploy.sh list" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USER="falab"
SSH_OPTS="-o BatchMode=yes -o PasswordAuthentication=no -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new"

CONF="$SCRIPT_DIR/backend_locations.conf"

BACKEND_LOCAL="$SCRIPT_DIR/website_backend"
FRONTEND_LOCAL="$SCRIPT_DIR/website_frontend"
FRONTEND_ENV_FILE="$FRONTEND_LOCAL/.env"
MIGRATIONS_LOCAL_DIR="$BACKEND_LOCAL/db_migrations"

BASE_DOMAIN="wistronlabs.com"

RED='\033[0;31m'; NC='\033[0m'
err(){ echo -e "${RED}Error:${NC} $*" >&2; }
die(){ err "$*"; exit 1; }

[[ -f "$CONF" ]] || die "Missing backend_locations.conf at $CONF"
[[ -d "$BACKEND_LOCAL" ]] || die "Missing website_backend dir at $BACKEND_LOCAL"
[[ -d "$FRONTEND_LOCAL" ]] || die "Missing website_frontend dir at $FRONTEND_LOCAL"

GIT_EMAIL="$(git -C "$SCRIPT_DIR" config user.email || true)"
[[ -n "${GIT_EMAIL:-}" ]] || die "git user.email not set in this repo. Set it: git config user.email you@company.com"

usage() {
  cat <<EOF
Usage:
  $0 help
  $0 list
  $0 all
  $0 <SITE> [MORE...]
  $0 --bootstrap-from <SITE> <SITE> [MORE...]

Notes:
- Only PROD targets (is_dev=0) are allowed.
- Frontend is built per site (env differs per site).
- Backend deploy is per site.

Examples:
  $0 list
  $0 TSS
  $0 TSS FRK
  $0 all
  $0 --bootstrap-from FRK TSS

Bootstrap:
- If backend dir is missing, DB will be bootstrapped from another PROD site via:
  pg_dump (source) piped into psql (destination).
- Default bootstrap source (if not specified) = first PROD site found in conf.
  If that equals the destination, the next PROD in conf is used.
EOF
  exit 1
}

# -----------------------------------------------------------------------------
# Load config
# -----------------------------------------------------------------------------
declare -A HOST DIR PROJ PORT FRONTEND IS_DEV
while IFS='|' read -r name host dir proj port frontend_url is_dev lockfile source_prod; do
  [[ -z "${name// }" ]] && continue
  [[ "$name" =~ ^# ]] && continue

  is_dev="${is_dev//$'\r'/}"; is_dev="${is_dev//[[:space:]]/}"

  HOST["$name"]="$host"
  DIR["$name"]="$dir"
  PROJ["$name"]="$proj"
  PORT["$name"]="$port"
  FRONTEND["$name"]="$frontend_url"
  IS_DEV["$name"]="$is_dev"
done < "$CONF"

is_known() { [[ -n "${HOST[$1]:-}" ]]; }
is_prod_target() { [[ "${IS_DEV[$1]:-}" == "0" ]]; }

print_prod_locations() {
  echo ""
  echo "Available PROD sites (is_dev=0):"
  for k in "${!HOST[@]}"; do
    [[ "${IS_DEV[$k]:-}" == "0" ]] || continue
    echo "  - $k"
    echo "      host: ${HOST[$k]}"
    echo "      dir:  ${DIR[$k]}"
    echo "      proj: ${PROJ[$k]}"
    echo "      port: ${PORT[$k]}"
    echo "      fe:   ${FRONTEND[$k]}"
    echo ""
  done | sed '/^$/N;/^\n$/D'
}

require_prod_targets() {
  for n in "$@"; do
    is_known "$n" || die "Unknown site '$n' (check backend_locations.conf)"
    is_prod_target "$n" || die "Refusing non-prod site '$n' in prod_deploy.sh"
    [[ -n "${DIR[$n]:-}" ]] || die "Config error: '$n' missing backend_dir"
    [[ -n "${PROJ[$n]:-}" ]] || die "Config error: '$n' missing compose_project"
    [[ -n "${HOST[$n]:-}" ]] || die "Config error: '$n' missing host"
    [[ -n "${FRONTEND[$n]:-}" ]] || die "Config error: '$n' missing frontend_url"
  done
}

# -----------------------------------------------------------------------------
# Git preflight checks (local)
# -----------------------------------------------------------------------------
verify_git_main_clean_synced() {
  echo "============================================================"
  echo "Verifying git branch and sync status..."
  echo "============================================================"

  local current_branch
  current_branch="$(git -C "$SCRIPT_DIR" rev-parse --abbrev-ref HEAD)"
  if [[ "$current_branch" != "main" ]]; then
    die "You must be on 'main' to run this deploy script (current: '$current_branch')."
  fi

  git -C "$SCRIPT_DIR" fetch origin --prune

  local local_head remote_head base_head
  local_head="$(git -C "$SCRIPT_DIR" rev-parse HEAD)"
  remote_head="$(git -C "$SCRIPT_DIR" rev-parse origin/main)"
  base_head="$(git -C "$SCRIPT_DIR" merge-base HEAD origin/main)"

  if [[ "$local_head" != "$remote_head" ]]; then
    if [[ "$local_head" = "$base_head" ]]; then
      die "Local main is behind origin/main. Run 'git pull' and try again."
    elif [[ "$remote_head" = "$base_head" ]]; then
      die "Local main is ahead of origin/main. Push your commits (or revert) before deploying."
    else
      die "Local main and origin/main have diverged. Resolve the divergence before deploying."
    fi
  fi

  echo "Branch check OK: on 'main' and in sync with origin/main."
  echo ""
  echo "============================================================"
  echo "Checking for unstaged or uncommitted changes in git..."
  echo "============================================================"

  if ! git -C "$SCRIPT_DIR" diff --quiet || ! git -C "$SCRIPT_DIR" diff --cached --quiet; then
    echo "ERROR: You have unstaged or uncommitted changes."
    echo ""
    git -C "$SCRIPT_DIR" status -s
    die "Please commit or stash your changes before running this script."
  fi

  echo "Working tree clean."
}

# -----------------------------------------------------------------------------
# Remote helpers
# -----------------------------------------------------------------------------
remote_run() {
  local host="$1"; shift
  ssh -T $SSH_OPTS "$USER@$host" "$@"
}

check_host_reachable() {
  local host="$1"
  ssh $SSH_OPTS "$USER@$host" "true" >/dev/null 2>&1
}

remote_check_docker_compose_runnable() {
  local host="$1"
  ssh -T $SSH_OPTS "$USER@$host" 'bash -s' <<'REMOTE'
set -euo pipefail
ok=0

if ! command -v docker >/dev/null 2>&1; then
  echo "MISSING: docker binary not found in PATH" >&2
  exit 2
fi

if docker info >/dev/null 2>&1; then
  ok=1
else
  if sudo -n docker info >/dev/null 2>&1; then
    ok=1
  fi
fi

if [[ "$ok" != "1" ]]; then
  echo "NOACCESS: docker daemon not accessible (need docker group or sudoers for docker)" >&2
  exit 3
fi

if docker compose version >/dev/null 2>&1; then
  exit 0
fi
if sudo -n docker compose version >/dev/null 2>&1; then
  exit 0
fi

echo "NOACCESS: docker compose not runnable (direct or via sudo -n)" >&2
exit 4
REMOTE
}

remote_check_var_www_html() {
  local host="$1"
  ssh -T $SSH_OPTS "$USER@$host" 'bash -s' <<'REMOTE'
set -euo pipefail
if [[ -d /var/www/html ]]; then
  exit 0
fi
echo "MISSING: /var/www/html does not exist" >&2
exit 2
REMOTE
}

remote_check_backend_bootstrap_prereqs() {
  local host="$1"
  local remote_dir="$2"

  ssh -T $SSH_OPTS "$USER@$host" "REMOTE_DIR='$remote_dir' bash -s" <<'REMOTE'
set -euo pipefail
parent="$(dirname "$REMOTE_DIR")"
if [[ -d "$parent" ]]; then
  :
else
  echo "MISSING: parent dir missing: $parent" >&2
  exit 2
fi
REMOTE

  remote_check_docker_compose_runnable "$host" >/dev/null
}

# -----------------------------------------------------------------------------
# Bootstrap-from selection
# -----------------------------------------------------------------------------
default_bootstrap_from_conf() {
  local first=""
  while IFS='|' read -r name host dir proj port frontend_url is_dev lockfile source_prod; do
    [[ -z "${name// }" ]] && continue
    [[ "$name" =~ ^# ]] && continue
    is_dev="${is_dev//$'\r'/}"; is_dev="${is_dev//[[:space:]]/}"
    if [[ "$is_dev" == "0" ]]; then
      first="$name"
      break
    fi
  done < "$CONF"
  [[ -n "$first" ]] || die "Could not find any PROD (is_dev=0) site in $CONF to use as bootstrap source"
  echo "$first"
}

pick_bootstrap_source_for_target() {
  local target="$1"
  local default
  default="$(default_bootstrap_from_conf)"

  if [[ "$default" != "$target" ]]; then
    echo "$default"
    return 0
  fi

  local found_default=0
  local candidate=""
  while IFS='|' read -r name host dir proj port frontend_url is_dev lockfile source_prod; do
    [[ -z "${name// }" ]] && continue
    [[ "$name" =~ ^# ]] && continue
    is_dev="${is_dev//$'\r'/}"; is_dev="${is_dev//[[:space:]]/}"
    if [[ "$is_dev" == "0" ]]; then
      if [[ "$found_default" == "1" ]]; then
        candidate="$name"
        break
      fi
      [[ "$name" == "$default" ]] && found_default=1
    fi
  done < "$CONF"

  [[ -n "$candidate" ]] || die "Bootstrap needed for '$target' but no alternative PROD site exists besides '$default'"
  echo "$candidate"
}

# -----------------------------------------------------------------------------
# Frontend deploy (local build, remote upload)
# -----------------------------------------------------------------------------
_sed_escape_repl() {
  # Escape \ and & and delimiter |
  printf '%s' "$1" | sed -e 's/[\/&|\\]/\\&/g'
}

set_env_kv() {
  local key="$1" val="$2" file="$3"
  local esc
  esc="$(_sed_escape_repl "$val")"

  if [[ -f "$file" ]] && grep -qE "^${key}=" "$file"; then
    local tmp
    tmp="$(mktemp)"
    sed -E "s|^${key}=.*|${key}=${esc}|" "$file" > "$tmp"
    mv "$tmp" "$file"
  else
    printf '%s=%s\n' "$key" "$val" >> "$file"
  fi
}

frontend_build_for_site() {
  local site="$1"
  local site_lc
  site_lc="$(echo "$site" | tr '[:upper:]' '[:lower:]')"

  local backend_url="https://backend.${site_lc}.${BASE_DOMAIN}/api/v1"
  local vite_url="${FRONTEND[$site]}"

  echo ""
  echo "============================================================"
  echo "FRONTEND BUILD (local)"
  echo "  Site           : $site"
  echo "  Write .env     : $FRONTEND_ENV_FILE"
  echo "  VITE_BACKEND   : $backend_url"
  echo "  VITE_URL       : $vite_url"
  echo "  VITE_LOCATION  : $site"
  echo "============================================================"

  touch "$FRONTEND_ENV_FILE"
  set_env_kv "VITE_BACKEND_URL" "$backend_url" "$FRONTEND_ENV_FILE"
  set_env_kv "VITE_URL" "$vite_url" "$FRONTEND_ENV_FILE"
  set_env_kv "VITE_LOCATION" "$site" "$FRONTEND_ENV_FILE"

  echo ""
  echo "Wrote:"
  grep -E '^(VITE_BACKEND_URL|VITE_URL|VITE_LOCATION)=' "$FRONTEND_ENV_FILE" || true

  echo ""
  echo "Installing deps + building..."
  pushd "$FRONTEND_LOCAL" >/dev/null
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
  npm run build
  popd >/dev/null

  [[ -d "$FRONTEND_LOCAL/dist" ]] || die "Frontend build failed: missing dist/ directory"
}

frontend_upload_to_site() {
  local site="$1"
  local host="${HOST[$site]}"

  echo ""
  echo "============================================================"
  echo "FRONTEND UPLOAD"
  echo "  Site : $site"
  echo "  Host : $USER@$host"
  echo "  Dest : /var/www/html"
  echo "============================================================"

  remote_check_var_www_html "$host" >/dev/null

  echo "Uploading dist/* ..."
  RSYNC_RSH="ssh $SSH_OPTS" rsync -av "$FRONTEND_LOCAL/dist/" "$USER@$host:/var/www/html/"

  echo "Frontend uploaded to $site."
}

# -----------------------------------------------------------------------------
# Backend: migrations + runtime config
# -----------------------------------------------------------------------------
sha256_file() {
  local f="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$f" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$f" | awk '{print $1}'
  else
    die "Missing sha256 tool: install coreutils (sha256sum) or use macOS shasum"
  fi
}

parse_version_from_filename() {
  local base="$1"
  if [[ "$base" =~ ^([0-9]+)-.+\.sql$ ]]; then
    local digits="${BASH_REMATCH[1]}"
    echo "$((10#$digits))"
  else
    return 1
  fi
}

remote_psql_db_tab() {
  local host="$1"
  local remote_dir="$2"
  local project="$3"
  local sql="$4"

  # Pass SQL into remote shell safely as an env var (quoted)
  ssh -T $SSH_OPTS "$USER@$host" \
    "REMOTE_DIR='$remote_dir' PROJECT='$project' SQL=$(printf %q "$sql") bash -s" <<'REMOTE'
set -euo pipefail
cd "$REMOTE_DIR"

DOCKER_BIN="docker"
if ! command -v docker >/dev/null 2>&1 && command -v /usr/bin/docker >/dev/null 2>&1; then DOCKER_BIN="/usr/bin/docker"; fi
SUDO=""
if ! "$DOCKER_BIN" info >/dev/null 2>&1; then
  if sudo -n "$DOCKER_BIN" info >/dev/null 2>&1; then SUDO="sudo -n"; else
    echo "Error: cannot run docker here" >&2; exit 1
  fi
fi
d(){ $SUDO "$DOCKER_BIN" "$@"; }
dc(){ $SUDO "$DOCKER_BIN" compose "$@"; }

dc -p "$PROJECT" up -d db >/dev/null 2>&1 || true
DB_CID="$(dc -p "$PROJECT" ps -q db | head -n1 || true)"
[ -n "$DB_CID" ] || { echo "Error: could not find db container" >&2; exit 1; }

for i in $(seq 1 90); do
  if d exec "$DB_CID" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
d exec "$DB_CID" pg_isready -U postgres >/dev/null 2>&1 || { echo "Error: DB not ready" >&2; exit 1; }

d exec -i "$DB_CID" psql -U postgres -d mydb -At -F $'\t' -v ON_ERROR_STOP=1 -c "$SQL"
REMOTE
}

prompt_secret() {
  local label="$1" __var="$2" val=""
  read -r -s -p "$label: " val
  echo ""
  [[ -n "$val" ]] || die "$label is required."
  printf -v "$__var" "%s" "$val"
}

gen_hex_32() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  elif command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

remote_prepare_dir() {
  local host="$1" remote_dir="$2"
  remote_run "$host" "mkdir -p '$remote_dir' && test -w '$remote_dir'"
}

remote_seed_runtime_config_if_missing() {
  local host="$1" remote_dir="$2" site="$3" fe_url="$4" app_port="$5"

  local need_secrets=0
  if ! ssh $SSH_OPTS "$USER@$host" "test -f '$remote_dir/env/secrets.env'"; then
    need_secrets=1
  fi

  local SMTP_PASS_LOCAL=""
  local POSTGRES_PASSWORD_LOCAL=""
  local JWT_SECRET_LOCAL=""
  local INTERNAL_API_KEY_LOCAL=""
  local WEBHOOK_TOKEN_LOCAL=""

  if [[ $need_secrets -eq 1 ]]; then
    echo ""
    echo "Runtime configuration not found on remote (env/secrets.env missing) for $site."
    echo "Seeding baseline .env and env/*.env (will not overwrite existing files)."
    echo ""
    prompt_secret "Enter SMTP_PASS (app password) for $site" SMTP_PASS_LOCAL

    POSTGRES_PASSWORD_LOCAL="$(gen_hex_32)"
    JWT_SECRET_LOCAL="$(gen_hex_32)"
    INTERNAL_API_KEY_LOCAL="$(gen_hex_32)"
    WEBHOOK_TOKEN_LOCAL="$(gen_hex_32)"
  fi

  ssh -T $SSH_OPTS "$USER@$host" \
    "REMOTE_DIR='$remote_dir' LOCATION='$site' FRONTEND_URL='$fe_url' APP_HOST_PORT='$app_port' \
     NEED_SECRETS='$need_secrets' SMTP_PASS='${SMTP_PASS_LOCAL}' POSTGRES_PASSWORD='${POSTGRES_PASSWORD_LOCAL}' \
     JWT_SECRET='${JWT_SECRET_LOCAL}' INTERNAL_API_KEY='${INTERNAL_API_KEY_LOCAL}' WEBHOOK_TOKEN='${WEBHOOK_TOKEN_LOCAL}' \
     bash -s" <<'REMOTE'
set -euo pipefail
die(){ echo "Error: $*" >&2; exit 1; }

REMOTE_DIR="${REMOTE_DIR:?}"
LOCATION="${LOCATION:?}"
FRONTEND_URL="${FRONTEND_URL:?}"
APP_HOST_PORT="${APP_HOST_PORT:?}"
NEED_SECRETS="${NEED_SECRETS:-0}"

mkdir -p "$REMOTE_DIR/env"
chmod 700 "$REMOTE_DIR/env" 2>/dev/null || true

if [[ ! -f "$REMOTE_DIR/.env" ]]; then
  cat > "$REMOTE_DIR/.env" <<EOF
APP_HOST_PORT=$APP_HOST_PORT
EOF
  chmod 600 "$REMOTE_DIR/.env" 2>/dev/null || true
fi

if [[ ! -f "$REMOTE_DIR/env/common.env" ]]; then
  cat > "$REMOTE_DIR/env/common.env" <<'EOF'
NODE_ENV=production
PORT=3000
POSTGRES_USER=postgres
POSTGRES_DB=mydb
EOF
  chmod 600 "$REMOTE_DIR/env/common.env" 2>/dev/null || true
fi

if [[ ! -f "$REMOTE_DIR/env/site.env" ]]; then
  cat > "$REMOTE_DIR/env/site.env" <<EOF
LOCATION=$LOCATION
FRONTEND_URL=$FRONTEND_URL
EOF
  chmod 600 "$REMOTE_DIR/env/site.env" 2>/dev/null || true
fi

if [[ "$NEED_SECRETS" == "1" && ! -f "$REMOTE_DIR/env/secrets.env" ]]; then
  SMTP_PASS="${SMTP_PASS:-}"
  POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"
  JWT_SECRET="${JWT_SECRET:-}"
  INTERNAL_API_KEY="${INTERNAL_API_KEY:-}"
  WEBHOOK_TOKEN="${WEBHOOK_TOKEN:-}"

  [[ -n "$SMTP_PASS" ]] || die "SMTP_PASS is required to create env/secrets.env"

  cat > "$REMOTE_DIR/env/secrets.env" <<EOF
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
DATABASE_URL=postgres://postgres:$POSTGRES_PASSWORD@db:5432/mydb

JWT_SECRET=$JWT_SECRET
INTERNAL_API_KEY=$INTERNAL_API_KEY
WEBHOOK_TOKEN=$WEBHOOK_TOKEN

SMTP_USER=wistron.tailscale@gmail.com
SMTP_PASS=$SMTP_PASS
EOF
  chmod 600 "$REMOTE_DIR/env/secrets.env" 2>/dev/null || true
fi
REMOTE
}

ensure_db_running_remote() {
  local host="$1" remote_dir="$2" project="$3"
  remote_run "$host" "cd '$remote_dir' && (docker compose -p '$project' up -d db >/dev/null 2>&1 || sudo -n docker compose -p '$project' up -d db >/dev/null 2>&1 || true)"
}

backend_apply_migrations_on_remote() {
  local host="$1" remote_dir="$2" project="$3"

  [[ -d "$MIGRATIONS_LOCAL_DIR" ]] || { echo ""; echo "Migrations: local directory not found ($MIGRATIONS_LOCAL_DIR). Skipping."; return 0; }

  shopt -s nullglob
  local files=("$MIGRATIONS_LOCAL_DIR"/*.sql)
  shopt -u nullglob

  if [[ ${#files[@]} -eq 0 ]]; then
    echo ""
    echo "Migrations: no local *.sql files found in $MIGRATIONS_LOCAL_DIR. Skipping."
    return 0
  fi

  declare -A LOCAL_SHA LOCAL_VER
  local tmp_list
  tmp_list="$(mktemp)"

  for f in "${files[@]}"; do
    local base_raw base ver sha
    base_raw="$(basename "$f")"

    base="$(printf '%s' "$base_raw" \
      | tr -d '\r\n\t' \
      | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
    base="$(printf '%s' "$base" | sed -E 's/[–—−]/-/g')"

    ver="$(parse_version_from_filename "$base")" || die "Bad migration filename (must be NNNN-*.sql): $base"
    sha="$(sha256_file "$f")"
    LOCAL_SHA["$base"]="$sha"
    LOCAL_VER["$base"]="$ver"
    printf "%010d\t%s\n" "$ver" "$base" >> "$tmp_list"
  done

  mapfile -t ORDERED_BASES < <(sort -t $'\t' -k1,1n -k2,2 "$tmp_list" | cut -f2-)
  rm -f "$tmp_list" >/dev/null 2>&1 || true

  echo ""
  echo "------------------------------------------------------------"
  echo "Migrations"
  echo "------------------------------------------------------------"
  echo "Initializing tracking table: public.schema_migrations"

  remote_psql_db_tab "$host" "$remote_dir" "$project" "
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  id         bigserial PRIMARY KEY,
  version    integer NOT NULL,
  filename   text    NOT NULL,
  sha256     text    NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schema_migrations_filename_uniq UNIQUE (filename),
  CONSTRAINT schema_migrations_version_uniq  UNIQUE (version)
);
CREATE INDEX IF NOT EXISTS schema_migrations_version_idx
  ON public.schema_migrations (version);
"

  echo "Reading applied migrations from DB..."
  local applied_lines
  applied_lines="$(remote_psql_db_tab "$host" "$remote_dir" "$project" \
    "SELECT filename, sha256 FROM public.schema_migrations ORDER BY version, filename;")"

  declare -A APPLIED_SHA
  while IFS=$'\t' read -r fn sh; do
    [[ -z "${fn:-}" ]] && continue
    APPLIED_SHA["$fn"]="$sh"
  done <<<"$applied_lines"

  echo "Validating applied migration SHA256 (DB vs local)..."
  for fn in "${!APPLIED_SHA[@]}"; do
    if [[ -n "${LOCAL_SHA[$fn]:-}" ]]; then
      if [[ "${APPLIED_SHA[$fn]}" != "${LOCAL_SHA[$fn]}" ]]; then
        die "Migration SHA mismatch: ${fn}  DB=${APPLIED_SHA[$fn]}  local=${LOCAL_SHA[$fn]}"
      fi
    fi
  done
  echo "OK: applied migration SHA256 values match local files."

  local missing=()
  for fn in "${ORDERED_BASES[@]}"; do
    [[ -z "${APPLIED_SHA[$fn]:-}" ]] && missing+=("$fn")
  done

  if [[ ${#missing[@]} -eq 0 ]]; then
    echo "No pending migrations."
    return 0
  fi

  echo ""
  echo "Pending migrations (${#missing[@]}):"
  for fn in "${missing[@]}"; do
    echo "  - ${LOCAL_VER[$fn]}  $fn"
  done

  echo ""
  echo "Applying pending migrations..."
  for fn in "${missing[@]}"; do
    local ver sha fn_sql_escaped sha_sql_escaped
    ver="${LOCAL_VER[$fn]}"
    sha="${LOCAL_SHA[$fn]}"

    fn_sql_escaped="$(printf "%s" "$fn" | sed "s/'/''/g")"
    sha_sql_escaped="$(printf "%s" "$sha" | sed "s/'/''/g")"

    echo ""
    echo "==> Applying: $fn (version=$ver)"

    ssh -T $SSH_OPTS "$USER@$host" \
      "REMOTE_DIR='$remote_dir' PROJECT='$project' MIG_FILE='$fn' bash -s" <<'REMOTE'
set -euo pipefail
REMOTE_DIR="${REMOTE_DIR:?}"
PROJECT="${PROJECT:?}"
MIG_FILE="${MIG_FILE:?}"
SQL_FILE="$REMOTE_DIR/db_migrations/$MIG_FILE"
die(){ echo "Error: $*" >&2; exit 1; }
[[ -f "$SQL_FILE" ]] || die "Missing migration on remote host: $SQL_FILE"

DOCKER_BIN="docker"
if ! command -v docker >/dev/null 2>&1 && command -v /usr/bin/docker >/dev/null 2>&1; then DOCKER_BIN="/usr/bin/docker"; fi
SUDO=""
if ! "$DOCKER_BIN" info >/dev/null 2>&1; then
  if sudo -n "$DOCKER_BIN" info >/dev/null 2>&1; then SUDO="sudo -n"; else
    die "Cannot run docker here: neither 'docker' nor 'sudo -n docker' works."
  fi
fi
d(){ $SUDO "$DOCKER_BIN" "$@"; }
dc(){ $SUDO "$DOCKER_BIN" compose "$@"; }

cd "$REMOTE_DIR" || die "Missing remote dir: $REMOTE_DIR"
dc -p "$PROJECT" up -d db >/dev/null 2>&1 || true
DB_CID="$(dc -p "$PROJECT" ps -q db | head -n1 || true)"
[ -n "$DB_CID" ] || die "Could not find db container for project '$PROJECT'"

for i in $(seq 1 90); do
  if d exec "$DB_CID" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
d exec "$DB_CID" pg_isready -U postgres >/dev/null 2>&1 || die "DB not ready"

d exec -i "$DB_CID" psql -X -U postgres -d mydb -v ON_ERROR_STOP=on -1 -f - < "$SQL_FILE"
REMOTE

    echo "==> Recording: $fn"
    remote_psql_db_tab "$host" "$remote_dir" "$project" \
      "INSERT INTO public.schema_migrations (version, filename, sha256)
       VALUES ($ver, '$fn_sql_escaped', '$sha_sql_escaped')
       ON CONFLICT (filename) DO UPDATE
         SET version = EXCLUDED.version
       WHERE public.schema_migrations.sha256 = EXCLUDED.sha256;"

    local db_sha
    db_sha="$(remote_psql_db_tab "$host" "$remote_dir" "$project" \
      "SELECT sha256 FROM public.schema_migrations WHERE filename='$fn_sql_escaped';" | head -n1 || true)"

    [[ -n "${db_sha:-}" ]] || die "Failed to record migration in DB: $fn"
    [[ "$db_sha" == "$sha" ]] || die "Migration record SHA mismatch: $fn  DB=$db_sha  local=$sha"

    echo "==> Complete: $fn"
  done

  echo ""
  echo "Migrations complete."
}

# -----------------------------------------------------------------------------
# Backend bootstrap: pg_dump from source -> psql into destination
# -----------------------------------------------------------------------------
bootstrap_db_from_site() {
  local src_site="$1"
  local dst_site="$2"

  local src_host="${HOST[$src_site]}"
  local dst_host="${HOST[$dst_site]}"
  local src_dir="${DIR[$src_site]}"
  local dst_dir="${DIR[$dst_site]}"
  local src_proj="${PROJ[$src_site]}"
  local dst_proj="${PROJ[$dst_site]}"

  echo ""
  echo "------------------------------------------------------------"
  echo "DB BOOTSTRAP"
  echo "  FROM: $src_site ($src_host, proj=$src_proj)"
  echo "    TO: $dst_site ($dst_host, proj=$dst_proj)"
  echo "Method: pg_dump | psql (stream)"
  echo "------------------------------------------------------------"
  echo ""

  ensure_db_running_remote "$src_host" "$src_dir" "$src_proj"
  ensure_db_running_remote "$dst_host" "$dst_dir" "$dst_proj"

  # Destination "receiver" script is sent via env var; stdin remains the pg_dump stream.
  local dst_script
  dst_script="$(cat <<'DSTSCRIPT'
set -euo pipefail

REMOTE_DIR="${REMOTE_DIR:?}"
PROJECT="${PROJECT:?}"

DOCKER_BIN="docker"
if ! command -v docker >/dev/null 2>&1 && command -v /usr/bin/docker >/dev/null 2>&1; then DOCKER_BIN="/usr/bin/docker"; fi
SUDO=""
if ! "$DOCKER_BIN" info >/dev/null 2>&1; then
  if sudo -n "$DOCKER_BIN" info >/dev/null 2>&1; then SUDO="sudo -n"; else
    echo "Error: cannot run docker on destination" >&2; exit 1
  fi
fi
d(){ $SUDO "$DOCKER_BIN" "$@"; }
dc(){ $SUDO "$DOCKER_BIN" compose "$@"; }

cd "$REMOTE_DIR"
dc -p "$PROJECT" up -d db >/dev/null 2>&1 || true
DB_CID="$(dc -p "$PROJECT" ps -q db | head -n1 || true)"
[ -n "$DB_CID" ] || { echo "Error: destination db container not found" >&2; exit 1; }

for i in $(seq 1 90); do
  if d exec "$DB_CID" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
d exec "$DB_CID" pg_isready -U postgres >/dev/null 2>&1 || { echo "Error: destination DB not ready" >&2; exit 1; }

# Reset public schema before restore
d exec -i "$DB_CID" psql -U postgres -d mydb -v ON_ERROR_STOP=1 <<'SQL'
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;
SQL

# IMPORTANT: stdin is the incoming pg_dump stream
d exec -i "$DB_CID" psql -U postgres -d mydb -v ON_ERROR_STOP=1
DSTSCRIPT
)"

  # Source sends dump to stdout, piped into destination which runs dst_script (read from env var).
  ssh -T $SSH_OPTS "$USER@$src_host" "bash -s" <<SRC \
    | ssh -T $SSH_OPTS "$USER@$dst_host" "REMOTE_DIR='$dst_dir' PROJECT='$dst_proj' DST_SCRIPT=$(printf %q "$dst_script") bash -lc '$DST_SCRIPT'"
set -euo pipefail
REMOTE_DIR='$src_dir'
PROJECT='$src_proj'

DOCKER_BIN="docker"
if ! command -v docker >/dev/null 2>&1 && command -v /usr/bin/docker >/dev/null 2>&1; then DOCKER_BIN="/usr/bin/docker"; fi
SUDO=""
if ! "$DOCKER_BIN" info >/dev/null 2>&1; then
  if sudo -n "$DOCKER_BIN" info >/dev/null 2>&1; then SUDO="sudo -n"; else
    echo "Error: cannot run docker on source" >&2; exit 1
  fi
fi
d(){ $SUDO "$DOCKER_BIN" "$@"; }
dc(){ $SUDO "$DOCKER_BIN" compose "$@"; }

cd "$REMOTE_DIR"
dc -p "$PROJECT" up -d db >/dev/null 2>&1 || true
DB_CID="$(dc -p "$PROJECT" ps -q db | head -n1 || true)"
[ -n "$DB_CID" ] || { echo "Error: source db container not found" >&2; exit 1; }

for i in $(seq 1 90); do
  if d exec "$DB_CID" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
d exec "$DB_CID" pg_isready -U postgres >/dev/null 2>&1 || { echo "Error: source DB not ready" >&2; exit 1; }

d exec "$DB_CID" pg_dump -U postgres -d mydb --no-owner --no-privileges
SRC

  echo ""
  echo "DB bootstrap stream complete: $src_site -> $dst_site"
  echo "WARNING: This is a bootstrap copy of PROD data."
  echo "         You must manually remove/replace data as needed to complete bootstrap."
}


# -----------------------------------------------------------------------------
# Backend deploy per site
# -----------------------------------------------------------------------------
backend_deploy_one() {
  local site="$1"
  local host="${HOST[$site]}"
  local remote_dir="${DIR[$site]}"
  local project="${PROJ[$site]}"
  local app_port="${PORT[$site]}"
  local fe_url="${FRONTEND[$site]}"

  local existed_before=1
  if ! ssh $SSH_OPTS "$USER@$host" "test -d '$remote_dir'"; then
    existed_before=0
  fi

  echo ""
  echo "============================================================"
  echo "BACKEND DEPLOY"
  echo "  Site        : $site"
  echo "  Remote      : $USER@$host:$remote_dir"
  echo "  Project     : $project"
  echo "  Git identity: $GIT_EMAIL"
  echo "============================================================"

  remote_check_backend_bootstrap_prereqs "$host" "$remote_dir"
  remote_prepare_dir "$host" "$remote_dir"
  remote_seed_runtime_config_if_missing "$host" "$remote_dir" "$site" "$fe_url" "$app_port"

  echo ""
  echo "------------------------------------------------------------"
  echo "Remote containers"
  echo "------------------------------------------------------------"
  if [[ "$existed_before" -eq 1 ]]; then
    echo "Stopping app container (DB remains running)..."
    remote_run "$host" "cd '$remote_dir' && (docker compose -p '$project' stop app >/dev/null 2>&1 || sudo -n docker compose -p '$project' stop app >/dev/null 2>&1 || true)"
  else
    echo "First deploy detected (backend dir did not exist)."
    echo "Stopping any stack (safety) before bootstrap..."
    remote_run "$host" "cd '$remote_dir' && (docker compose -p '$project' down >/dev/null 2>&1 || sudo -n docker compose -p '$project' down >/dev/null 2>&1 || true)"
  fi

  echo ""
  echo "------------------------------------------------------------"
  echo "Upload"
  echo "------------------------------------------------------------"
  echo "Uploading backend code (preserving remote .env and env/*)..."
  RSYNC_RSH="ssh $SSH_OPTS" rsync -av --delete \
    --exclude='.env' \
    --exclude='env/' \
    "$BACKEND_LOCAL/" "$USER@$host:$remote_dir/"

  ensure_db_running_remote "$host" "$remote_dir" "$project"

  if [[ "$existed_before" -eq 0 ]]; then
    local src=""
    if [[ -n "${BOOTSTRAP_FROM_OVERRIDE:-}" ]]; then
      src="$BOOTSTRAP_FROM_OVERRIDE"
    else
      src="$(pick_bootstrap_source_for_target "$site")"
    fi
    echo ""
    echo "Backend bootstrap detected: will bootstrap DB from $src -> $site"
    bootstrap_db_from_site "$src" "$site"
  fi

  echo ""
  echo "------------------------------------------------------------"
  echo "Build"
  echo "------------------------------------------------------------"
  echo "Building app image..."
  remote_run "$host" "cd '$remote_dir' && (docker compose -p '$project' build app || sudo -n docker compose -p '$project' build app)"

  backend_apply_migrations_on_remote "$host" "$remote_dir" "$project"

  echo ""
  echo "------------------------------------------------------------"
  echo "Start"
  echo "------------------------------------------------------------"
  echo "Starting app..."
  remote_run "$host" "cd '$remote_dir' && (docker compose -p '$project' up -d app || sudo -n docker compose -p '$project' up -d app)"

  echo "Done backend: $site"
}

# -----------------------------------------------------------------------------
# Preflight auth check (all targets)
# -----------------------------------------------------------------------------
preflight_auth_and_prereqs() {
  local targets=("$@")

  echo ""
  echo "============================================================"
  echo "Pre-flight Authorization & Host checks..."
  echo "============================================================"

  local failed=()
  local seen=""

  for site in "${targets[@]}"; do
    local host="${HOST[$site]}"
    if [[ " $seen " == *" $host "* ]]; then
      continue
    fi
    seen+=" $host"

    echo "Checking SSH auth for $USER@$host ..."
    if ! check_host_reachable "$host"; then
      err "Auth/Reachability failed for $USER@$host"
      failed+=("$site")
      continue
    fi

    echo "Checking /var/www/html exists on $host ..."
    if ! remote_check_var_www_html "$host" >/dev/null 2>&1; then
      err "/var/www/html missing on $host"
      failed+=("$site")
    fi

    echo "Checking docker & docker compose runnable on $host ..."
    if ! remote_check_docker_compose_runnable "$host" >/dev/null 2>&1; then
      err "docker/compose not runnable for $USER@$host (need docker group or sudoers NOPASSWD)"
      failed+=("$site")
    fi
  done

  if ((${#failed[@]} > 0)); then
    echo ""
    die "Pre-flight checks FAILED (fix hosts/users) before deploying."
  fi

  echo ""
  echo "All targets passed pre-flight checks."
}

# -----------------------------------------------------------------------------
# Parse args
# -----------------------------------------------------------------------------
BOOTSTRAP_FROM_OVERRIDE=""
args=("$@")
[[ ${#args[@]} -gt 0 ]] || usage

if [[ "${args[0]}" == "--bootstrap-from" ]]; then
  [[ -n "${args[1]:-}" ]] || die "--bootstrap-from requires a SITE"
  BOOTSTRAP_FROM_OVERRIDE="${args[1]}"
  args=("${args[@]:2}")
  [[ ${#args[@]} -gt 0 ]] || usage
fi

cmd="${args[0]:-}"
case "$cmd" in
  help|-h|--help) usage ;;
  list) print_prod_locations; exit 0 ;;
esac

targets=()
if [[ "$cmd" == "all" ]]; then
  for k in "${!HOST[@]}"; do
    [[ "${IS_DEV[$k]:-}" == "0" ]] && targets+=("$k")
  done
  IFS=$'\n' targets=($(printf "%s\n" "${targets[@]}" | sort)); unset IFS
else
  targets=("${args[@]}")
fi

[[ ${#targets[@]} -gt 0 ]] || usage
require_prod_targets "${targets[@]}"

if [[ -n "$BOOTSTRAP_FROM_OVERRIDE" ]]; then
  is_known "$BOOTSTRAP_FROM_OVERRIDE" || die "Unknown --bootstrap-from '$BOOTSTRAP_FROM_OVERRIDE'"
  is_prod_target "$BOOTSTRAP_FROM_OVERRIDE" || die "--bootstrap-from must be a PROD site (is_dev=0)"
fi

# -----------------------------------------------------------------------------
# Execute
# -----------------------------------------------------------------------------
verify_git_main_clean_synced
preflight_auth_and_prereqs "${targets[@]}"

print_prod_locations

for site in "${targets[@]}"; do
  frontend_build_for_site "$site"
  frontend_upload_to_site "$site"
  backend_deploy_one "$site"

  echo ""
  echo "============================================================"
  echo "SITE COMPLETE: $site"
  echo "============================================================"
done

echo ""
echo "ALL DONE."
if [[ -n "$BOOTSTRAP_FROM_OVERRIDE" ]]; then
  echo "NOTE: bootstrap source override used: $BOOTSTRAP_FROM_OVERRIDE"
fi