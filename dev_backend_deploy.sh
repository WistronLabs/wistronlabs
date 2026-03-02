#!/usr/bin/env bash
set -euo pipefail

# Require bash 4+ (macOS system bash is often 3.2)
if [[ -z "${BASH_VERSINFO:-}" || "${BASH_VERSINFO[0]}" -lt 4 ]]; then
  echo "Error: This script requires bash 4+ (associative arrays)." >&2
  echo "" >&2
  echo "On macOS, install newer bash and run with:" >&2
  echo "  brew install bash" >&2
  echo "  /opt/homebrew/bin/bash ./dev_backend_deploy.sh list" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USER="falab"
SSH_OPTS="-o BatchMode=yes -o PasswordAuthentication=no -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new"

CONF="$SCRIPT_DIR/backend_locations.conf"
BACKEND_LOCAL="$SCRIPT_DIR/website_backend"
MIGRATIONS_LOCAL_DIR="$BACKEND_LOCAL/db_migrations"

# API path assumptions:
# - GET  /api/v1/migrations -> [{version, filename, sha256, applied_at}, ...]
# - POST /api/v1/migrations -> {version, filename, sha256} (records applied migration)
MIGRATIONS_API_PATH="/api/v1/migrations"

RED='\033[0;31m'; NC='\033[0m'
err(){ echo -e "${RED}Error:${NC} $*" >&2; }
die(){ err "$*"; exit 1; }

[[ -f "$CONF" ]] || { err "Missing backend_locations.conf at $CONF"; exit 1; }

GIT_EMAIL="$(git -C "$SCRIPT_DIR" config user.email || true)"
[[ -n "${GIT_EMAIL:-}" ]] || { err "git user.email not set in this repo. Set it: git config user.email you@company.com"; exit 1; }

usage() {
  cat <<EOF
Usage:
  $0 list
  $0 all
  $0 <DEV_NAME> [MORE...]
  $0 reset <DEV_NAME|all>

Notes:
- Only backends with is_dev=1 are allowed here.
- Lock enforcement: if the dev lock file is missing, deploy/reset will auto-create it using your local git user.email.

Deploy:
  - Uploads backend code from the local repo
  - Preserves DEV runtime config: .env + env/* + lock file
  - Applies DB migrations from: $MIGRATIONS_LOCAL_DIR
      1) Read applied migrations from the DB tracking table
      2) Compute local sha256 for all local migration files
      3) If any applied filename has a sha mismatch -> abort
      4) Apply missing migrations in version order via psql in the db container
      5) Record each applied migration to the DB tracking table

Reset (simple, same-host only):
  - Copies PROD db-data volume -> DEV db-data volume
  - Preserves DEV runtime config: .env + env/* + lock file
  - Starts the full DEV stack
  - Does NOT apply migrations (reset reflects the current PROD DB snapshot)
EOF
  exit 1
}

cmd="${1:-}"

# Load config (supports optional 9th field: source_prod)
declare -A HOST DIR PROJ PORT FRONTEND IS_DEV LOCKFILE SOURCE_PROD
while IFS='|' read -r name host dir proj port frontend is_dev lockfile source_prod; do
  [[ -z "${name// }" ]] && continue
  [[ "$name" =~ ^# ]] && continue

  is_dev="${is_dev//$'\r'/}"; is_dev="${is_dev//[[:space:]]/}"
  source_prod="${source_prod//$'\r'/}"; source_prod="${source_prod//[[:space:]]/}"

  HOST["$name"]="$host"
  DIR["$name"]="$dir"
  PROJ["$name"]="$proj"
  PORT["$name"]="$port"
  FRONTEND["$name"]="$frontend"
  IS_DEV["$name"]="$is_dev"
  LOCKFILE["$name"]="$lockfile"
  SOURCE_PROD["$name"]="$source_prod"
done < "$CONF"

print_dev_locations() {
  echo ""
  echo "Available dev backends (is_dev=1):"
  for k in "${!HOST[@]}"; do
    if [[ "${IS_DEV[$k]}" == "1" ]]; then
      echo "  - $k"
      echo "      host: ${HOST[$k]}"
      echo "      dir:  ${DIR[$k]}"
      echo "      proj: ${PROJ[$k]}"
      echo "      port: ${PORT[$k]}"
      echo "      fe:   ${FRONTEND[$k]}"
      echo ""
    fi
  done | sed '/^$/N;/^\n$/D'
}

is_known() { [[ -n "${HOST[$1]:-}" ]]; }
is_dev_target() { [[ "${IS_DEV[$1]:-}" == "1" ]]; }

require_dev_targets() {
  for n in "$@"; do
    is_known "$n" || { err "Unknown backend '$n' (check backend_locations.conf)"; exit 1; }
    is_dev_target "$n" || { err "Refusing non-dev backend '$n' in dev_backend_deploy.sh"; exit 1; }
    [[ -n "${LOCKFILE[$n]:-}" ]] || { err "Config error: '$n' missing lock_file"; exit 1; }
  done
}

check_host_reachable() {
  local host="$1"
  ssh $SSH_OPTS "$USER@$host" "true" >/dev/null 2>&1
}

require_targets_reachable() {
  local seen=""
  for name in "$@"; do
    local host="${HOST[$name]}"
    if [[ " $seen " == *" $host "* ]]; then
      continue
    fi
    seen+=" $host"
    if ! check_host_reachable "$host"; then
      err "Dev host not reachable: $USER@$host"
      err "Check DNS/VPN/keys. This script requires non-interactive SSH (BatchMode)."
      exit 1
    fi
  done
}

ensure_dev_lock() {
  local host="$1" lockfile="$2" name="$3"
  if ! ssh $SSH_OPTS "$USER@$host" "test -f '$lockfile'"; then
    local now reason
    now="$(date -Iseconds)"
    reason="auto-lock by dev_backend_deploy"
    {
      echo "GIT_EMAIL=$GIT_EMAIL"
      echo "LOCKED_AT=$now"
      echo "REASON=$reason"
    } | ssh $SSH_OPTS "$USER@$host" "cat > '$lockfile' && chmod 600 '$lockfile'"
  fi
}

enforce_lock_or_exit() {
  local host="$1" lockfile="$2" name="$3"

  ensure_dev_lock "$host" "$lockfile" "$name"

  local lock_owner
  lock_owner="$(ssh $SSH_OPTS "$USER@$host" "grep -E '^GIT_EMAIL=' '$lockfile' 2>/dev/null | head -n1 | cut -d= -f2-" || true)"

  if [[ -z "${lock_owner:-}" ]]; then
    err "Dev backend '$name' lock exists but is malformed (missing GIT_EMAIL=)."
    err "Ask the owner to unlock/fix: ./dev_backend_lock.sh unlock $name"
    exit 1
  fi

  if [[ "$lock_owner" != "$GIT_EMAIL" ]]; then
    err "Dev backend '$name' is locked by: $lock_owner"
    err "Contact them to unlock: ./dev_backend_lock.sh unlock $name"
    exit 1
  fi

  echo ""
  echo "Lock: OK ($name)"
}

infer_source_prod() {
  local devname="$1"
  local explicit="${SOURCE_PROD[$devname]:-}"
  if [[ -n "$explicit" ]]; then
    echo "$explicit"
    return 0
  fi
  echo "${devname%_DEV}"
}

# Resolve targets
targets=()
want_all=0
reset_mode=0

case "$cmd" in
  "" ) usage ;;
  list ) print_dev_locations; exit 0 ;;
  all ) want_all=1 ;;
  reset ) reset_mode=1; shift || true ;;
  * ) targets=("$@") ;;
esac

if [[ $want_all -eq 1 ]]; then
  for k in "${!HOST[@]}"; do
    [[ "${IS_DEV[$k]}" == "1" ]] && targets+=("$k")
  done
  IFS=$'\n' targets=($(printf "%s\n" "${targets[@]}" | sort)); unset IFS
fi

if [[ $reset_mode -eq 1 ]]; then
  [[ -n "${1:-}" ]] || usage
  if [[ "${1:-}" == "all" ]]; then
    targets=()
    for k in "${!HOST[@]}"; do
      [[ "${IS_DEV[$k]}" == "1" ]] && targets+=("$k")
    done
    IFS=$'\n' targets=($(printf "%s\n" "${targets[@]}" | sort)); unset IFS
  else
    targets=("$1")
  fi
fi

[[ ${#targets[@]} -gt 0 ]] || usage
require_dev_targets "${targets[@]}"
require_targets_reachable "${targets[@]}"

print_dev_locations

###############################################################################
# Helpers (local)
###############################################################################
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

remote_psql_db_tab() {
  local host="$1"
  local remote_dir="$2"
  local project="$3"
  local sql="$4"

  ssh -T $SSH_OPTS "$USER@$host" "cd '$remote_dir' && \
    (docker compose -p '$project' up -d db >/dev/null 2>&1 || sudo -n docker compose -p '$project' up -d db >/dev/null 2>&1 || true); \
    DB_CID=\$( (docker compose -p '$project' ps -q db | head -n1) || true ); \
    if [[ -z \"\$DB_CID\" ]]; then DB_CID=\$( (sudo -n docker compose -p '$project' ps -q db | head -n1) || true ); fi; \
    if [[ -z \"\$DB_CID\" ]]; then echo 'Error: could not find db container' >&2; exit 1; fi; \
    (docker exec -i \"\$DB_CID\" psql -U postgres -d mydb -At -F \$'\t' -v ON_ERROR_STOP=1 -c \"$sql\") \
      || (sudo -n docker exec -i \"\$DB_CID\" psql -U postgres -d mydb -At -F \$'\t' -v ON_ERROR_STOP=1 -c \"$sql\")"
}

parse_version_from_filename() {
  # expects leading digits before '-' e.g. 0005-foo.sql
  local base="$1"
  if [[ "$base" =~ ^([0-9]+)-.+\.sql$ ]]; then
    local digits="${BASH_REMATCH[1]}"
    # force base-10 so 0001 isn't treated as octal
    echo "$((10#$digits))"
  else
    return 1
  fi
}

###############################################################################
# Remote helpers
###############################################################################
remote_run() {
  local host="$1"; shift
  ssh -T $SSH_OPTS "$USER@$host" "$@"
}

remote_bash() {
  local host="$1"; shift
  local env_prefix="$*"
  if [[ -n "$env_prefix" ]]; then
    ssh -T $SSH_OPTS "$USER@$host" "$env_prefix bash -s"
  else
    ssh -T $SSH_OPTS "$USER@$host" "bash -s"
  fi
}

###############################################################################
# Migrations (deploy-only)
###############################################################################
apply_migrations_on_remote() {
  local host="$1"
  local remote_dir="$2"
  local project="$3"
  local app_port="$4"

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
  rm -f "$tmp_list" >/dev/null 2>&1 || true
  tmp_list="$(mktemp)"

  for f in "${files[@]}"; do
    local base_raw base ver sha
    base_raw="$(basename "$f")"

    # Strip common hidden chars + trim leading/trailing whitespace
    base="$(printf '%s' "$base_raw" \
      | tr -d '\r\n\t' \
      | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"

    # Normalize common Unicode dashes to "-"
    base="$(printf '%s' "$base" | sed -E 's/[–—−]/-/g')"

    if [[ "$base" != "$base_raw" ]]; then
      echo ""
      echo "WARN: sanitized migration filename:"
      echo "  raw:  [$base_raw]"
      echo "  sane: [$base]"
      echo ""
    fi

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

    if ! ssh -T $SSH_OPTS "$USER@$host" \
      "REMOTE_DIR='$remote_dir' PROJECT='$project' MIG_FILE='$fn' bash -s" <<'REMOTE'
set -euo pipefail

REMOTE_DIR="${REMOTE_DIR:?}"
PROJECT="${PROJECT:?}"
MIG_FILE="${MIG_FILE:?}"
SQL_FILE="$REMOTE_DIR/db_migrations/$MIG_FILE"

die(){ echo "Error: $*" >&2; exit 1; }

[[ -f "$SQL_FILE" ]] || die "Missing migration on remote host: $SQL_FILE"

DOCKER_BIN="docker"
if ! command -v docker >/dev/null 2>&1 && command -v /usr/bin/docker >/dev/null 2>&1; then
  DOCKER_BIN="/usr/bin/docker"
fi

SUDO=""
if ! "$DOCKER_BIN" info >/dev/null 2>&1; then
  if sudo -n "$DOCKER_BIN" info >/dev/null 2>&1; then
    SUDO="sudo -n"
  else
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

cat "$SQL_FILE" | d exec -i "$DB_CID" psql -X -U postgres -d mydb -v ON_ERROR_STOP=on -1 -f -
REMOTE
    then
      die "Migration apply failed: $fn (not recorded)"
    fi

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

# ---------------------------------------------------------------------------
# Bootstrap helpers
# ---------------------------------------------------------------------------

prompt_secret() {
  # prompt_secret "Label" varname
  local label="$1" __var="$2" val=""
  read -r -s -p "$label: " val
  echo ""
  [[ -n "$val" ]] || die "$label is required."
  printf -v "$__var" "%s" "$val"
}

gen_hex_32() {
  # 32 bytes -> 64 hex chars
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  elif command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
  else
    # last resort
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

remote_prepare_dir() {
  local host="$1" remote_dir="$2"

  echo ""
  echo "------------------------------------------------------------"
  echo "Bootstrap"
  echo "------------------------------------------------------------"
  echo "Ensuring remote directory exists: $remote_dir"
  remote_run "$host" "mkdir -p '$remote_dir' && test -w '$remote_dir'"
  echo "OK: remote directory is present and writable."
}

remote_seed_runtime_config_if_missing() {
  local host="$1" remote_dir="$2" name="$3" fe_url="$4" app_port="$5"

  # Only prompt for SMTP_PASS if we must create secrets.env
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
    echo "Runtime configuration not found on remote (env/secrets.env missing)."
    echo "Seeding baseline .env and env/*.env (will not overwrite existing files)."
    echo ""

    # Only secret that must be provided manually:
    prompt_secret "Enter SMTP_PASS (app password)" SMTP_PASS_LOCAL

    # Secrets that can be generated on the fly:
    POSTGRES_PASSWORD_LOCAL="example"
    JWT_SECRET_LOCAL="$(gen_hex_32)"
    INTERNAL_API_KEY_LOCAL="$(gen_hex_32)"
    WEBHOOK_TOKEN_LOCAL="$(gen_hex_32)"
  fi

  # Seed files on remote *only if missing* (never overwrite).
  ssh -T $SSH_OPTS "$USER@$host" \
    "REMOTE_DIR='$remote_dir' LOCATION='$name' FRONTEND_URL='$fe_url' APP_HOST_PORT='$app_port' \
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

# .env
if [[ ! -f "$REMOTE_DIR/.env" ]]; then
  cat > "$REMOTE_DIR/.env" <<EOF
APP_HOST_PORT=$APP_HOST_PORT
EOF
  chmod 600 "$REMOTE_DIR/.env" 2>/dev/null || true
fi

# env/common.env
if [[ ! -f "$REMOTE_DIR/env/common.env" ]]; then
  cat > "$REMOTE_DIR/env/common.env" <<'EOF'
NODE_ENV=production
PORT=3000
POSTGRES_USER=postgres
POSTGRES_DB=mydb
EOF
  chmod 600 "$REMOTE_DIR/env/common.env" 2>/dev/null || true
fi

# env/site.env
if [[ ! -f "$REMOTE_DIR/env/site.env" ]]; then
  cat > "$REMOTE_DIR/env/site.env" <<EOF
LOCATION=$LOCATION
FRONTEND_URL=$FRONTEND_URL
EOF
  chmod 600 "$REMOTE_DIR/env/site.env" 2>/dev/null || true
fi

# env/secrets.env (only if missing)
if [[ "$NEED_SECRETS" == "1" && ! -f "$REMOTE_DIR/env/secrets.env" ]]; then
  SMTP_PASS="${SMTP_PASS:-}"
  POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"
  JWT_SECRET="${JWT_SECRET:-}"
  INTERNAL_API_KEY="${INTERNAL_API_KEY:-}"
  WEBHOOK_TOKEN="${WEBHOOK_TOKEN:-}"

  [[ -n "$SMTP_PASS" ]] || die "SMTP_PASS is required to create env/secrets.env"

  # Keep FRK_DEV format; values are generated except SMTP_PASS.
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

remote_copy_prod_db_volume_to_dev() {
  # Copy PROD volume -> DEV volume (same host). Safe to run on first deploy.
  local host="$1"
  local dev_proj="$2"
  local prod_proj="$3"

  ssh -T $SSH_OPTS "$USER@$host" \
    "DEV_PROJ='$dev_proj' PROD_PROJ='$prod_proj' bash -s" <<'REMOTE'
set -euo pipefail
die(){ echo "Error: $*" >&2; exit 1; }

DEV_PROJ="${DEV_PROJ:?}"
PROD_PROJ="${PROD_PROJ:?}"

DOCKER_BIN="docker"
if ! command -v docker >/dev/null 2>&1 && command -v /usr/bin/docker >/dev/null 2>&1; then
  DOCKER_BIN="/usr/bin/docker"
fi

SUDO=""
if ! "$DOCKER_BIN" info >/dev/null 2>&1; then
  if sudo -n "$DOCKER_BIN" info >/dev/null 2>&1; then
    SUDO="sudo -n"
  else
    die "Cannot run docker here: neither 'docker' nor 'sudo -n docker' works."
  fi
fi
d(){ $SUDO "$DOCKER_BIN" "$@"; }

DEV_VOL="${DEV_PROJ}_db-data"
PROD_VOL="${PROD_PROJ}_db-data"

# Ensure PROD volume exists
d volume inspect "$PROD_VOL" >/dev/null 2>&1 || die "Prod volume not found: $PROD_VOL"

# If DEV volume exists, remove it (fresh baseline)
if d volume inspect "$DEV_VOL" >/dev/null 2>&1; then
  d volume rm "$DEV_VOL" >/dev/null
fi

d volume create "$DEV_VOL" >/dev/null

d run --rm \
  -v "${PROD_VOL}:/from:ro" \
  -v "${DEV_VOL}:/to" \
  alpine:3.19 sh -lc '
    set -e
    rm -rf /to/* /to/.[!.]* /to/..?* 2>/dev/null || true
    cp -a /from/. /to/
  '
REMOTE
}


###############################################################################
# Deploy
###############################################################################
do_deploy_one() {
  local name="$1"
  local host="${HOST[$name]}"
  local remote_dir="${DIR[$name]}"
  local project="${PROJ[$name]}"
  local app_port="${PORT[$name]}"
  local fe_url="${FRONTEND[$name]}"
  local lockfile="${LOCKFILE[$name]}"
  local lock_base; lock_base="$(basename "$lockfile")"

  local existed_before=1
  if ! ssh $SSH_OPTS "$USER@$host" "test -d '$remote_dir'"; then
    existed_before=0
  fi


  echo ""
  echo "============================================================"
  echo "DEV BACKEND DEPLOY"
  echo "  Target     : $name"
  echo "  Remote     : $USER@$host:$remote_dir"
  echo "  Project    : $project"
  echo "  Git identity: $GIT_EMAIL"
  echo "============================================================"

 # Ensure remote_dir exists before lock creation (lockfile is inside remote_dir)
remote_prepare_dir "$host" "$remote_dir"

enforce_lock_or_exit "$host" "$lockfile" "$name"


  # Seed .env and env/*.env if missing (never overwrites)
  remote_seed_runtime_config_if_missing "$host" "$remote_dir" "$name" "$fe_url" "$app_port"


  echo ""
  echo "------------------------------------------------------------"
  echo "Config"
  echo "------------------------------------------------------------"
  echo "Generating local env/site.env..."
  mkdir -p "$BACKEND_LOCAL/env"
  cat > "$BACKEND_LOCAL/env/site.env" <<EOF
LOCATION=$name
FRONTEND_URL=$fe_url
APP_HOST_PORT=$app_port
EOF
  echo "OK: $BACKEND_LOCAL/env/site.env"

  echo ""
  echo "------------------------------------------------------------"
  echo "Remote containers"
  echo "------------------------------------------------------------"
  if [[ "$existed_before" -eq 1 ]]; then
    echo "Stopping dev app container (DB remains running)..."
    remote_run "$host" "cd '$remote_dir' && (docker compose -p '$project' stop app >/dev/null 2>&1 || sudo -n docker compose -p '$project' stop app >/dev/null 2>&1 || true)"
  else
    echo "First deploy detected (remote directory was not present). Skipping container stop."
  fi

  echo ""
  echo "------------------------------------------------------------"
  echo "Upload"
  echo "------------------------------------------------------------"
  echo "Uploading backend code (preserving: .env, env/*, $lock_base)..."
  RSYNC_RSH="ssh $SSH_OPTS" rsync -av --delete \
    --exclude='.env' \
    --exclude='env/' \
    --exclude="$lock_base" \
    "$BACKEND_LOCAL/" "$USER@$host:$remote_dir/"

    if [[ "$existed_before" -eq 0 ]]; then
    local prod
    prod="$(infer_source_prod "$name")"
    is_known "$prod" || die "Bootstrap DB copy failed: source prod '$prod' not found in config"

    local prod_host="${HOST[$prod]}"
    local prod_proj="${PROJ[$prod]}"

    [[ "$prod_host" == "$host" ]] || die "Bootstrap DB copy requires same-host prod/dev. prod_host=$prod_host dev_host=$host"

    echo ""
    echo "------------------------------------------------------------"
    echo "Bootstrap database"
    echo "------------------------------------------------------------"
    echo "Copying PROD DB volume -> DEV DB volume"
    echo "  PROD project: $prod_proj"
    echo "  DEV  project: $project"

    # IMPORTANT: ensure nothing is using the DEV volume before replacing it
    remote_run "$host" "cd '$remote_dir' && (docker compose -p '$project' down >/dev/null 2>&1 || sudo -n docker compose -p '$project' down >/dev/null 2>&1 || true)"

    remote_copy_prod_db_volume_to_dev "$host" "$project" "$prod_proj"
    echo "OK: DEV database volume initialized from PROD."
  fi


   echo ""
  echo "Ensuring DB is running (required for migrations)..."
  remote_run "$host" "cd '$remote_dir' && (docker compose -p '$project' up -d db >/dev/null 2>&1 || sudo -n docker compose -p '$project' up -d db >/dev/null 2>&1 || true)"


  echo ""
  echo "------------------------------------------------------------"
  echo "Build"
  echo "------------------------------------------------------------"
  echo "Building app image (app will not be started until migrations complete)..."
  remote_run "$host" "cd '$remote_dir' && (docker compose -p '$project' build app || sudo -n docker compose -p '$project' build app)"

  apply_migrations_on_remote "$host" "$remote_dir" "$project" "$app_port"

  echo ""
  echo "------------------------------------------------------------"
  echo "Start"
  echo "------------------------------------------------------------"
  echo "Starting app..."
  remote_run "$host" "cd '$remote_dir' && (docker compose -p '$project' up -d app || sudo -n docker compose -p '$project' up -d app)"

  echo ""
  echo "Done: $name"
}

###############################################################################
# Reset (simple same-host db volume copy; no password changes)
###############################################################################
do_reset_one() {
  local dev="$1"
  local dev_host="${HOST[$dev]}"
  local dev_dir="${DIR[$dev]}"
  local dev_proj="${PROJ[$dev]}"
  local dev_lock="${LOCKFILE[$dev]}"

  local prod
  prod="$(infer_source_prod "$dev")"
  is_known "$prod" || { err "Reset mapping failed: '$dev' source prod '$prod' not found in config"; exit 1; }

  local prod_host="${HOST[$prod]}"
  local prod_proj="${PROJ[$prod]}"

  if [[ "$dev_host" != "$prod_host" ]]; then
    err "Simple reset only supports same-host copy. '$prod_host' != '$dev_host'"
    exit 1
  fi

  echo ""
  echo "============================================================"
  echo "RESET DEV DATABASE VOLUME"
  echo "  Dev   : $dev (proj=$dev_proj)"
  echo "  Prod  : $prod (proj=$prod_proj)"
  echo "  Host  : $dev_host"
  echo "============================================================"
  echo ""
  echo "This operation will replace the DEV database volume with a copy of the PROD database volume."
  echo "Application/runtime configuration is preserved (.env, env/*, lock file)."
  echo ""

  read -r -p "Type RESET-$dev to continue: " confirm
  if [[ "$confirm" != "RESET-$dev" ]]; then
    err "Aborted."
    exit 1
  fi

  echo ""
  echo "------------------------------------------------------------"
  echo "Reset execution"
  echo "------------------------------------------------------------"
  echo "Git identity: $GIT_EMAIL"

  enforce_lock_or_exit "$dev_host" "$dev_lock" "$dev"

  remote_bash "$dev_host" \
    "DEV_DIR='$dev_dir' DEV_PROJ='$dev_proj' PROD_PROJ='$prod_proj'" <<'REMOTE'
set -euo pipefail
die(){ echo "Error: $*" >&2; exit 1; }

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

DEV_VOL="${DEV_PROJ}_db-data"
PROD_VOL="${PROD_PROJ}_db-data"

cd "$DEV_DIR" || die "Missing DEV dir: $DEV_DIR"

echo ""
echo "1) Stopping DEV stack..."
dc -p "$DEV_PROJ" down >/dev/null 2>&1 || true

echo ""
echo "2) Removing DEV database volume: $DEV_VOL"
d volume rm "$DEV_VOL" >/dev/null 2>&1 || true

echo ""
echo "3) Creating DEV database volume: $DEV_VOL"
d volume create "$DEV_VOL" >/dev/null

echo ""
echo "4) Copying PROD volume -> DEV volume..."
d run --rm \
  -v "${PROD_VOL}:/from:ro" \
  -v "${DEV_VOL}:/to" \
  alpine:3.19 sh -lc '
    set -e
    rm -rf /to/* /to/.[!.]* /to/..?* 2>/dev/null || true
    cp -a /from/. /to/
  '

echo ""
echo "5) Starting full DEV stack..."
dc -p "$DEV_PROJ" up -d --build

echo ""
echo "6) Stack status:"
dc -p "$DEV_PROJ" ps

echo ""
echo "DONE"
REMOTE

  echo ""
  echo "RESET complete: $dev DB volume copied from $prod."
}

###############################################################################
# Main
###############################################################################
for name in "${targets[@]}"; do
  if [[ $reset_mode -eq 1 ]]; then
    do_reset_one "$name"
  else
    do_deploy_one "$name"
  fi
done
