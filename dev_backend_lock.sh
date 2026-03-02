#!/usr/bin/env bash
set -euo pipefail

# Require bash 4+ (associative arrays)
if [[ -z "${BASH_VERSINFO:-}" || "${BASH_VERSINFO[0]}" -lt 4 ]]; then
  echo "Error: This script requires bash 4+." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF="$SCRIPT_DIR/backend_locations.conf"
USER="falab"
SSH_OPTS="-o BatchMode=yes -o PasswordAuthentication=no -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new"

RED='\033[0;31m'; NC='\033[0m'
err(){ echo -e "${RED}Error:${NC} $*" >&2; }

[[ -f "$CONF" ]] || { err "Missing backend_locations.conf at $CONF"; exit 1; }

usage() {
  cat <<EOF
Usage:
  $0 list
  $0 status <DEV_NAME|all>
  $0 lock   <DEV_NAME|all> [reason...]
  $0 unlock <DEV_NAME|all>

Notes:
- Only entries with is_dev=1 are allowed.
- This tool NEVER prints lock file contents. It shows only:
    LOCKED by <email>
    UNLOCKED
  and the lock path it checked.
EOF
  exit 1
}

cmd="${1:-}"
target="${2:-}"

# Load config (supports optional 9th field: source_prod)
declare -A HOST DIR PROJ PORT FRONTEND IS_DEV LOCKFILE SOURCE_PROD
while IFS='|' read -r name host dir proj port frontend is_dev lockfile source_prod; do
  [[ -z "${name// }" ]] && continue
  [[ "$name" =~ ^# ]] && continue

  # Strip CRLF and surrounding whitespace (critical!)
  name="${name//$'\r'/}";       name="${name#"${name%%[![:space:]]*}"}"; name="${name%"${name##*[![:space:]]}"}"
  host="${host//$'\r'/}";       host="${host#"${host%%[![:space:]]*}"}"; host="${host%"${host##*[![:space:]]}"}"
  dir="${dir//$'\r'/}";         dir="${dir#"${dir%%[![:space:]]*}"}";   dir="${dir%"${dir##*[![:space:]]}"}"
  proj="${proj//$'\r'/}";       proj="${proj#"${proj%%[![:space:]]*}"}"; proj="${proj%"${proj##*[![:space:]]}"}"
  port="${port//$'\r'/}";       port="${port#"${port%%[![:space:]]*}"}"; port="${port%"${port##*[![:space:]]}"}"
  frontend="${frontend//$'\r'/}"; frontend="${frontend#"${frontend%%[![:space:]]*}"}"; frontend="${frontend%"${frontend##*[![:space:]]}"}"
  is_dev="${is_dev//$'\r'/}";   is_dev="${is_dev//[[:space:]]/}"
  lockfile="${lockfile//$'\r'/}"; lockfile="${lockfile#"${lockfile%%[![:space:]]*}"}"; lockfile="${lockfile%"${lockfile##*[![:space:]]}"}"
  source_prod="${source_prod//$'\r'/}"; source_prod="${source_prod#"${source_prod%%[![:space:]]*}"}"; source_prod="${source_prod%"${source_prod##*[![:space:]]}"}"

  HOST["$name"]="$host"
  DIR["$name"]="$dir"
  PROJ["$name"]="$proj"
  PORT["$name"]="$port"
  FRONTEND["$name"]="$frontend"
  IS_DEV["$name"]="$is_dev"
  LOCKFILE["$name"]="$lockfile"
  SOURCE_PROD["$name"]="$source_prod"
done < "$CONF"

list_dev() {
  echo "Available dev backends (is_dev=1):"
  for k in "${!HOST[@]}"; do
    [[ "${IS_DEV[$k]}" == "1" ]] || continue
    echo "  - $k"
    echo "      host: ${HOST[$k]}"
    echo "      dir:  ${DIR[$k]}"
    echo "      proj: ${PROJ[$k]}"
    echo "      port: ${PORT[$k]}"
    echo "      fe:   ${FRONTEND[$k]}"
    echo "      lock: ${LOCKFILE[$k]}"
    echo ""
  done | sed '/^$/N;/^\n$/D'
}

is_known() { [[ -n "${HOST[$1]:-}" ]]; }
is_dev_target() { [[ "${IS_DEV[$1]:-}" == "1" ]]; }

require_dev_target() {
  local n="$1"
  [[ -n "${n:-}" ]] || usage
  is_known "$n" || { err "Unknown backend '$n'"; exit 1; }
  is_dev_target "$n" || { err "'$n' is not marked is_dev=1"; exit 1; }
  [[ -n "${LOCKFILE[$n]:-}" ]] || { err "'$n' has no lock_file configured"; exit 1; }
}

get_git_email() {
  local email
  email="$(git -C "$SCRIPT_DIR" config user.email || true)"
  [[ -n "${email:-}" ]] || { err "git user.email not set in this repo"; exit 1; }
  echo "$email"
}

# Print status WITHOUT printing the file contents
show_status_one() {
  local n="$1"
  local host="${HOST[$n]}"
  local lock="${LOCKFILE[$n]}"

  # output: "LOCKED|email" or "UNLOCKED|"
  local out
  out="$(ssh $SSH_OPTS "$USER@$host" "if [ -f '$lock' ]; then
      owner=\$(grep -E '^GIT_EMAIL=' '$lock' 2>/dev/null | head -n1 | cut -d= -f2-)
      echo \"LOCKED|\$owner\"
    else
      echo \"UNLOCKED|\"
    fi" 2>/dev/null || echo "ERROR|")"

  local state owner
  state="${out%%|*}"
  owner="${out#*|}"

  printf "%-12s  " "$n"
  if [[ "$state" == "LOCKED" ]]; then
    [[ -n "$owner" ]] || owner="(unknown)"
    printf "LOCKED by %s  " "$owner"
  elif [[ "$state" == "UNLOCKED" ]]; then
    printf "UNLOCKED        "
  else
    printf "ERROR (ssh)     "
  fi
  printf "lock=%s@%s:%s\n" "$USER" "$host" "$lock"
}

lock_one() {
  local n="$1"; shift
  local reason="${*:-}"
  local host="${HOST[$n]}"
  local lock="${LOCKFILE[$n]}"
  local email now
  email="$(get_git_email)"
  now="$(date -Iseconds)"

  # Refuse if locked by someone else
  local existing_owner
  existing_owner="$(ssh $SSH_OPTS "$USER@$host" "if [ -f '$lock' ]; then grep -E '^GIT_EMAIL=' '$lock' 2>/dev/null | head -n1 | cut -d= -f2-; fi" || true)"
  if [[ -n "${existing_owner:-}" && "$existing_owner" != "$email" ]]; then
    err "$n already locked by $existing_owner (you are $email). Refusing."
    return 1
  fi

  {
    echo "GIT_EMAIL=$email"
    echo "LOCKED_AT=$now"
    echo "REASON=$reason"
  } | ssh $SSH_OPTS "$USER@$host" "cat > '$lock' && chmod 600 '$lock'"

  echo "Locked $n as $email"
}

unlock_one() {
  local n="$1"
  local host="${HOST[$n]}"
  local lock="${LOCKFILE[$n]}"
  local email existing_owner
  email="$(get_git_email)"

  ssh $SSH_OPTS "$USER@$host" "test -f '$lock'" >/dev/null 2>&1 || { err "$n is not locked (no lock file)"; return 1; }

  existing_owner="$(ssh $SSH_OPTS "$USER@$host" "grep -E '^GIT_EMAIL=' '$lock' 2>/dev/null | head -n1 | cut -d= -f2-" || true)"
  if [[ -n "${existing_owner:-}" && "$existing_owner" != "$email" ]]; then
    err "$n locked by $existing_owner (you are $email). Refusing to unlock."
    return 1
  fi

  ssh $SSH_OPTS "$USER@$host" "rm -f '$lock'"
  echo "Unlocked $n"
}

# Expand targets for "all"
resolve_targets() {
  local arg="${1:-}"
  local -a t=()
  if [[ "$arg" == "all" ]]; then
    for k in "${!HOST[@]}"; do
      [[ "${IS_DEV[$k]}" == "1" ]] && t+=("$k")
    done
    IFS=$'\n' t=($(printf "%s\n" "${t[@]}" | sort)); unset IFS
  else
    t+=("$arg")
  fi
  printf "%s\n" "${t[@]}"
}

case "$cmd" in
  list)
    list_dev
    ;;
  status)
    [[ -n "${target:-}" ]] || usage
    mapfile -t targets < <(resolve_targets "$target")
    [[ ${#targets[@]} -gt 0 ]] || usage
    for n in "${targets[@]}"; do require_dev_target "$n"; done
    echo "Dev lock status:"
    for n in "${targets[@]}"; do show_status_one "$n"; done
    ;;
  lock)
    [[ -n "${target:-}" ]] || usage
    shift 2 || true
    mapfile -t targets < <(resolve_targets "$target")
    for n in "${targets[@]}"; do require_dev_target "$n"; done
    for n in "${targets[@]}"; do lock_one "$n" "$@"; done
    ;;
  unlock)
    [[ -n "${target:-}" ]] || usage
    mapfile -t targets < <(resolve_targets "$target")
    for n in "${targets[@]}"; do require_dev_target "$n"; done
    for n in "${targets[@]}"; do unlock_one "$n"; done
    ;;
  *)
    usage
    ;;
esac
