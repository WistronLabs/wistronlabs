#!/bin/bash
# About:
#   Validates a station against the backend list and attaches to or creates the matching tmux session.
#
# Usage:
#   ./join_station.sh <session_number>
#   ./join_station.sh -l
#


SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SCRIPT_DIR/.lib"

# shellcheck disable=SC1091
source "$LIB_DIR/err.sh"
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

if [[ "${1:-}" == "-l" ]]; then
  echo "Available stations for $SERVER_LOCATION:"
  printf '%s\n' "${STATIONS[@]}"
  echo
  echo "To join a station, run:"
  echo "  $SCRIPT_NAME <station_number>"
  exit 0
fi

# Ensure a session number was provided
if [[ -z "${1:-}" ]]; then
  echo "Usage: $SCRIPT_NAME <session_number>" >&2
  echo "  session_number: ID of the station to join" >&2
  echo "  To list stations, run $SCRIPT_NAME -l" >&2
  exit 1
fi

# Ensure the argument is a number
if ! [[ "$1" =~ ^[0-9]+$ ]]; then
  err "session_number must be a number" >&2
  exit 1
fi

session_number="$1"
found=0

for station in "${STATIONS[@]}"; do
  if [[ "$station" == "$session_number" ]]; then
    found=1
    break
  fi
done

if [[ $found -eq 0 ]]; then
  err "stn_$session_number does not exist. Please choose from one of the below stations:"
  cols=6

  i=0
  for stn in "${STATIONS[@]}"; do
      printf "%-9s" "stn_$stn"
      ((i++))
      if (( i % cols == 0 )); then
          echo
      fi
  done
  # finish with newline if needed
  if (( i % cols != 0 )); then
      echo
  fi

  exit 1
fi

# Try to attach to an existing session; if it fails, create a new one
# - has-session returns 0 if session exists
if tmux has-session -t "stn_$session_number" 2>/dev/null; then
  tmux attach-session -t "stn_$session_number"
else
  tmux new-session -s "stn_$session_number"
fi

# Authors:
#   Giovanni Leon - giovanni_leon@wistron.com
