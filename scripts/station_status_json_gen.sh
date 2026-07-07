#!/usr/bin/env bash
# About:
#   Collects JSON status from each station session and PATCHes the latest state
#   back to the backend.
#   This script is backend-mode only and is disabled in field mode.
#
# Usage:
#   WISTRON_MODE=backend ./station_status_json_gen.sh
#


#requires jq and curl
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

require_field_mode_disabled "$(basename "$0")"
require_server_location
require_cmd curl
require_cmd jq

API_URL="https://backend.$SERVER_LOCATION.wistronlabs.com/api/v1/stations"
mapfile -t stations < <(fetch_station_list)

for st in "${stations[@]}"; do
    echo "Checking station $st…"

    # run check_station.sh and capture output
    output=$(./check_station.sh "stn_$st")

    # parse fields
    status=$(echo "$output" | jq -r '.status')
    message=$(echo "$output" | jq -r '.message')
    details=$(echo "$output" | jq -r '.details')

    echo "  status=$status, message=\"$message\", details=$details"

    payload=$(jq -nc --argjson status "$status" --arg message "$message" --argjson details "$details"\
      '{status: $status, message: $message, details: $details}')

    # PATCH to API
    curl -s -X PATCH "$API_URL/$st" \
        -H "Content-Type: application/json" \
        -d "$payload"
done

# Authors:
#   Giovanni Leon - giovanni_leon@wistron.com
