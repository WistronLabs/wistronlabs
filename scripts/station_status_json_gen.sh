#!/usr/bin/env bash
# About:
#   Collects JSON status from each station session and PATCHes the latest state
#   back to the backend.
#   This script is backend-mode only and is disabled in field mode.
#
# Usage:
#   WISTRON_MODE=backend ./station_status_json_gen.sh
#   STATION_API_BASE_URL=http://127.0.0.1:4000/api/v1 ./station_status_json_gen.sh
#   (loopback override only when the backend runs on this same host)
#   STATION_DEV_API_BASE_URL=http://127.0.0.1:4100/api/v1 ./station_status_json_gen.sh
#


# Requires jq and curl.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SCRIPT_DIR/.lib"

# shellcheck disable=SC1091
source "$LIB_DIR/runtime_mode.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/require_server_location.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/require_cmd.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/fetch_station_list.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/backend_curl.sh"

require_field_mode_disabled "$(basename "$0")"
require_server_location
require_cmd curl
require_cmd jq
require_internal_api_key

export STATION_API_BASE_URL="${STATION_API_BASE_URL:-https://backend.$SERVER_LOCATION.wistronlabs.com/api/v1}"
STATION_API_BASE_URL="${STATION_API_BASE_URL%/}"
case "$STATION_API_BASE_URL" in
  https://*|http://127.0.0.1:*|http://localhost:*) ;;
  *) echo "Error: STATION_API_BASE_URL must use HTTPS or local loopback HTTP." >&2; exit 1 ;;
esac
API_URL="$STATION_API_BASE_URL/stations"
STATION_DEV_API_BASE_URL="${STATION_DEV_API_BASE_URL:-https://devbackend.$SERVER_LOCATION.wistronlabs.com/api/v1}"
STATION_DEV_API_BASE_URL="${STATION_DEV_API_BASE_URL%/}"
case "$STATION_DEV_API_BASE_URL" in
  https://*|http://127.0.0.1:*|http://localhost:*) ;;
  *) echo "Error: STATION_DEV_API_BASE_URL must use HTTPS or local loopback HTTP." >&2; exit 1 ;;
esac
DEV_API_URL="$STATION_DEV_API_BASE_URL/stations"

# Development may have its own machine key. If not supplied, try the existing
# station-side key; a failed auth/read only disables the optional mirror.
dev_backend_curl() {
    local api_key="${DEV_INTERNAL_API_KEY:-$INTERNAL_API_KEY}"
    curl -H "Authorization: Bearer ${api_key}" "$@"
}

# Command substitution preserves the helper's failure status; process substitution does not.
if ! station_list="$(fetch_station_list)"; then
    exit 1
fi
mapfile -t stations <<< "$station_list"
failed=0
dev_available=0
if dev_stations_json=$(dev_backend_curl -fsS --connect-timeout 2 --max-time 5 "$DEV_API_URL" 2>/dev/null) &&
    printf '%s\n' "$dev_stations_json" | jq -e 'type == "array" and all(.[]; .station_name != null)' >/dev/null 2>&1; then
    dev_available=1
    echo "Development backend available; mirroring station statuses."
else
    echo "Development backend unavailable or unauthorized; skipping development updates." >&2
fi

for st in "${stations[@]}"; do
    echo "Checking station $st…"

    # check_station returns 1 when there is no tmux session, but still emits
    # a valid status JSON that must be sent to the backend.
    output=$("$SCRIPT_DIR/check_station.sh" "stn_$st") || true
    if ! payload=$(printf '%s\n' "$output" | jq -ce '
      if (.status | type) == "number" and (.message | type) == "string" and has("details")
      then {status, message, details}
      else error("invalid station status") end
    '); then
        echo "Error: invalid status output for station $st; skipping PATCH." >&2
        failed=1
        continue
    fi
    printf '  status=%s, message=%s\n' "$(jq -r '.status' <<< "$payload")" "$(jq -r '.message' <<< "$payload")"

    if ! backend_curl -fsS --max-time 10 -X PATCH "$API_URL/$st" \
        -H "Content-Type: application/json" \
        -d "$payload" >/dev/null; then
        echo "Error: failed to update station $st at $API_URL." >&2
        failed=1
    fi

    if [[ "$dev_available" -eq 1 ]] &&
        jq -e --arg station "$st" 'any(.[]; (.station_name | tostring) == $station)' <<< "$dev_stations_json" >/dev/null; then
        if ! dev_backend_curl -fsS --max-time 10 -X PATCH "$DEV_API_URL/$st" \
            -H "Content-Type: application/json" \
            -d "$payload" >/dev/null; then
            echo "Warning: failed to update development station $st at $DEV_API_URL." >&2
            dev_available=0
        fi
    fi
done
exit "$failed"

# Authors:
#   Giovanni Leon - giovanni_leon@wistron.com
