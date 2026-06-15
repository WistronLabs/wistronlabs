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

fetch_station_list() {
  local api_url json

  if [[ -z "${SERVER_LOCATION:-}" ]]; then
    echo "Error: environment variable SERVER_LOCATION is not set." >&2
    echo "       Please export SERVER_LOCATION in your shell, for example: export SERVER_LOCATION=frk" >&2
    exit 1
  fi

  api_url="https://backend.$SERVER_LOCATION.wistronlabs.com/api/v1/stations"

  if ! json="$(curl -fsS --max-time 8 "$api_url")"; then
    echo "Error: unable to fetch stations from $api_url" >&2
    exit 1
  fi

  if ! printf '%s\n' "$json" | jq -e 'length > 0' >/dev/null 2>&1; then
    echo "Error: no stations returned by API." >&2
    exit 1
  fi

  printf '%s\n' "$json" | jq -r '.[].station_name'
}

# Authors:
#   Giovanni Leon - giovanni_leon@wistron.com
