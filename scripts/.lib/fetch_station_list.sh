# shellcheck shell=bash
# About:
#   Fetches station names from the backend and prints one station per line.
#
# Usage:
#   source ./scripts/.lib/fetch_station_list.sh
#   mapfile -t STATIONS < <(fetch_station_list)
#
# Notes:
#   Requires SERVER_LOCATION, curl, and jq.
#   Exits with status 1 if the backend is unavailable or no stations exist.

# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/runtime_mode.sh"
# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/backend_curl.sh"

fetch_station_list() {
  local api_url json

  if is_field_mode; then
    require_field_stations_file

    if ! command -v jq >/dev/null 2>&1; then
      echo "Error: jq is required to read the field stations file." >&2
      exit 1
    fi

    if ! jq -e '.stations | length > 0' "$FIELD_STATIONS_FILE" >/dev/null 2>&1; then
      echo "Error: no stations defined in $FIELD_STATIONS_FILE." >&2
      exit 1
    fi

    jq -r '.stations[] | select(.enabled != false) | .id' "$FIELD_STATIONS_FILE"
    return 0
  fi

  if [[ -z "${SERVER_LOCATION:-}" ]]; then
    echo "Error: environment variable SERVER_LOCATION is not set." >&2
    echo "       Please export SERVER_LOCATION in your shell, for example: export SERVER_LOCATION=frk" >&2
    exit 1
  fi

  api_url="${STATION_API_BASE_URL:-https://backend.$SERVER_LOCATION.wistronlabs.com/api/v1}"
  api_url="${api_url%/}/stations"

  if ! json="$(backend_curl -fsS --max-time 8 "$api_url")"; then
    echo "Error: unable to fetch stations from $api_url" >&2
    exit 1
  fi

  if ! printf '%s\n' "$json" | jq -e 'type == "array" and length > 0 and all(.[]; .station_name != null)' >/dev/null 2>&1; then
    echo "Error: invalid or empty station list returned by API." >&2
    exit 1
  fi

  printf '%s\n' "$json" | jq -r '.[].station_name'
}

# Authors:
#   Giovanni Leon - giovanni_leon@wistron.com
