#!/usr/bin/env bash
set -euo pipefail

# Require bash 4+ (macOS system bash is often 3.2)
if [[ -z "${BASH_VERSINFO:-}" || "${BASH_VERSINFO[0]}" -lt 4 ]]; then
  echo "Error: This script requires bash 4+ (associative arrays)." >&2
  echo "" >&2
  echo "On macOS, install newer bash and run with:" >&2
  echo "  brew install bash" >&2
  echo "  /opt/homebrew/bin/bash ./dev_script_deploy.sh list" >&2
  exit 1
fi

# About:
#   Deploys the local scripts workspace to a branch-specific remote directory.
#
# Usage:
#   ./dev_script_deploy.sh list
#   ./dev_script_deploy.sh all
#   ./dev_script_deploy.sh <DEV_NAME> [MORE...]
#
# Notes:
#   Uses dev targets from backend_locations.conf where is_dev=1, then copies
#   the full ./scripts tree, including ./scripts/.lib, into
#   /opt/dev_scripts/<branch_name>/ on the selected remote host(s).
#   Uses rsync with checksums so only changed or missing files are uploaded.

REMOTE_USER="falab"
REMOTE_ROOT="/opt/dev_scripts"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF="$SCRIPT_DIR/backend_locations.conf"
LOCAL_SCRIPTS_DIR="$SCRIPT_DIR/scripts"

SSH_OPTS="${SSH_OPTS:--o BatchMode=yes -o ConnectTimeout=5}"

usage() {
  cat <<EOF
Usage:
  $0 list
  $0 all
  $0 <DEV_NAME> [MORE...]

Notes:
  - Only targets with is_dev=1 from backend_locations.conf are allowed.
  - Scripts deploy to /opt/dev_scripts/<current_branch>/ on each selected host.
  - Uses rsync checksums, so unchanged files are skipped.
EOF
  exit 1
}

if [[ ! -f "$CONF" ]]; then
  echo "Error: backend locations config '$CONF' not found." >&2
  exit 1
fi

if [[ ! -d "$LOCAL_SCRIPTS_DIR" ]]; then
  echo "Error: local scripts directory '$LOCAL_SCRIPTS_DIR' not found." >&2
  exit 1
fi

if ! command -v rsync >/dev/null 2>&1; then
  echo "Error: rsync is required but was not found in PATH." >&2
  exit 1
fi

declare -A HOST IS_DEV
while IFS='|' read -r name host _dir _proj _port _frontend is_dev _lockfile _source_prod; do
  [[ -z "${name// }" ]] && continue
  [[ "$name" =~ ^# ]] && continue

  is_dev="${is_dev//$'\r'/}"
  is_dev="${is_dev//[[:space:]]/}"

  HOST["$name"]="$host"
  IS_DEV["$name"]="$is_dev"
done < "$CONF"

print_dev_locations() {
  echo ""
  echo "Available dev script deploy targets (is_dev=1):"
  for k in "${!HOST[@]}"; do
    if [[ "${IS_DEV[$k]:-}" == "1" ]]; then
      echo "  - $k"
      echo "      host: ${HOST[$k]}"
      echo ""
    fi
  done | sed '/^$/N;/^\n$/D'
}

is_known() { [[ -n "${HOST[$1]:-}" ]]; }
is_dev_target() { [[ "${IS_DEV[$1]:-}" == "1" ]]; }

require_dev_targets() {
  for n in "$@"; do
    is_known "$n" || { echo "Error: unknown target '$n' (check backend_locations.conf)." >&2; exit 1; }
    is_dev_target "$n" || { echo "Error: refusing non-dev target '$n' in dev_script_deploy.sh." >&2; exit 1; }
  done
}

cmd="${1:-}"
targets=()
want_all=0

case "$cmd" in
  "" ) usage ;;
  list ) print_dev_locations; exit 0 ;;
  all ) want_all=1 ;;
  * ) targets=("$@") ;;
esac

if [[ $want_all -eq 1 ]]; then
  for k in "${!HOST[@]}"; do
    [[ "${IS_DEV[$k]:-}" == "1" ]] && targets+=("$k")
  done
  IFS=$'\n' targets=($(printf "%s\n" "${targets[@]}" | sort))
  unset IFS
fi

[[ ${#targets[@]} -gt 0 ]] || usage
require_dev_targets "${targets[@]}"

BRANCH_NAME="$(git rev-parse --abbrev-ref HEAD)"
if [[ -z "$BRANCH_NAME" || "$BRANCH_NAME" == "HEAD" ]]; then
  echo "Error: unable to determine the current git branch." >&2
  exit 1
fi

if [[ "$BRANCH_NAME" == "main" ]]; then
  echo "Error: refusing to deploy scripts from the 'main' branch." >&2
  echo "       Please switch to a feature or test branch and try again." >&2
  exit 1
fi

print_dev_locations
echo ""
echo "Using branch: $BRANCH_NAME"

for target in "${targets[@]}"; do
  REMOTE_HOST="${HOST[$target]}"
  REMOTE_DIR="$REMOTE_ROOT/$BRANCH_NAME"

  echo ""
  echo "==> Deploying to: $target ($REMOTE_HOST)"
  echo "==> Ensuring remote dir $REMOTE_DIR exists on $REMOTE_USER@$REMOTE_HOST ..."
  ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" "mkdir -p '$REMOTE_DIR'"

  echo "==> Syncing changed contents of ./scripts to $REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/ ..."
  rsync -azc -e "ssh $SSH_OPTS" "$LOCAL_SCRIPTS_DIR/" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/"

  echo "==> Setting +x on remote shell files in $REMOTE_DIR ..."
  ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" "find '$REMOTE_DIR' -maxdepth 1 -type f -name '*.sh' -exec chmod +x {} +"
done

echo "==> Done."
