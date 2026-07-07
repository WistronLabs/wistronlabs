#!/bin/bash
# About:
#   Restarts a station tmux session after validating the station.
#   Backend mode validates stations against the backend. Field mode validates
#   them against FIELD_STATIONS_FILE.
#
# Usage:
#   WISTRON_MODE=backend ./restart_station.sh <session_number>
#   WISTRON_MODE=field FIELD_STATIONS_FILE=... ./restart_station.sh <session_number>
#   ./restart_station.sh -l
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SCRIPT_DIR/.lib"

# shellcheck disable=SC1091
source "$LIB_DIR/err.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/runtime_mode.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/require_server_location.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/require_internal_api_key.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/require_cmd.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/fetch_station_list.sh"

require_server_location
require_internal_api_key
require_cmd jq

mapfile -t STATIONS < <(fetch_station_list)

SCRIPT_NAME="$(basename "$0")"

print_help() {
  cat <<EOF
Usage:
  ./restart_station.sh <session_number>
  ./restart_station.sh -l

Mode:
  ${WISTRON_MODE:-backend}

Notes:
  - Backend mode reads the station list from the backend.
  - Field mode reads the station list from FIELD_STATIONS_FILE.
EOF
}

if [[ "${1:-}" == "-l" ]]; then
  if is_field_mode; then
    echo "Available field stations:"
  else
    echo "Available stations for $SERVER_LOCATION:"
  fi
  printf '%s\n' "${STATIONS[@]}" | nl -w2 -s') '
  echo
  echo "To join a station, run:"
  echo "  $SCRIPT_NAME <station_name>"
  exit 0
fi

# Ensure a session number was provided
if [[ -z "${1:-}" ]]; then
  print_help >&2
  echo "  session_number: ID of the station to join" >&2
  exit 1
fi

# Ensure the argument is a number
if ! [[ "$1" =~ ^[0-9]+$ ]]; then
  err "session_number must be a number" >&2
  exit 1
fi

session_number="$1"

# if a tmux session exists, kill it and restart, if it doesn't error out and list the existing sessions
# - has-session returns 0 if session exists
if tmux has-session -t "stn_$session_number" 2>/dev/null; then
  tmux kill-session -t "stn_$session_number"
  tmux new-session -s "stn_$session_number"
else
  echo "Error: this station does not exist, please pick from one of the below stations:"

  # Collect tmux sessions whose numeric suffix is in STATIONS[]
  valid_sessions=()

  # List tmux session names only; ignore errors if no sessions
  while IFS= read -r sess; do
    # Expect session names like stn_1, stn_2, etc.
    if [[ "$sess" =~ ^stn_([0-9]+)$ ]]; then
      num="${BASH_REMATCH[1]}"
      # Check if num is in STATIONS array
      for stn in "${STATIONS[@]}"; do
        if [[ "$stn" == "$num" ]]; then
          valid_sessions+=("$sess")
          break
        fi
      done
    fi
  done < <(tmux ls -F '#S' 2>/dev/null || true)

  if ((${#valid_sessions[@]} == 0)); then
    echo "  (No active tmux station sessions match API stations.)"
  else
    printf '%s\n' "${valid_sessions[@]}"
  fi
fi

# Authors:
#   Giovanni Leon - giovanni_leon@wistron.com
